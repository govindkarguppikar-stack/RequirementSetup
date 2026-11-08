"""
Login + request hardening for hosted use.

Fail-closed: unless AUTH_DISABLED=1 (set automatically only for `python app.py` on
127.0.0.1), every page and API call requires a signed-in session, and if the auth
settings are missing the app refuses to serve anything instead of running open.

Environment variables
  SECRET_KEY          required  long random string used to sign the session cookie
  APP_PASSWORD_HASH   required* hash from werkzeug (see README)   *or APP_PASSWORD (plain, less safe)
  APP_USERNAME        optional  default "admin"
  SESSION_COOKIE_SECURE  default 1 (cookie only sent over HTTPS); set 0 to test over plain http
  TRUST_PROXY         set 1 when behind a reverse proxy / PaaS so client IP, host and https are read correctly
"""
import hmac
import os
import secrets
import time
from datetime import timedelta
from urllib.parse import urlparse

from flask import jsonify, redirect, render_template, request, session, url_for
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.security import check_password_hash

SESSION_HOURS = 8
MAX_FAILS = 5            # failed sign-ins per IP ...
LOCKOUT_SECONDS = 300    # ... before that IP is locked out for this long
_fails = {}              # ip -> {"count": int, "until": float}


def auth_disabled():
    return os.environ.get("AUTH_DISABLED") == "1"


def _configured():
    return bool(os.environ.get("SECRET_KEY")) and bool(
        os.environ.get("APP_PASSWORD_HASH") or os.environ.get("APP_PASSWORD"))


def _credentials_ok(username, password):
    user_ok = hmac.compare_digest(username.encode(), os.environ.get("APP_USERNAME", "admin").encode())
    pw_hash = os.environ.get("APP_PASSWORD_HASH")
    if pw_hash:
        pw_ok = check_password_hash(pw_hash, password)
    else:
        pw_ok = hmac.compare_digest(password.encode(), os.environ.get("APP_PASSWORD", "").encode())
    return user_ok and pw_ok


def _locked_out(ip):
    entry = _fails.get(ip)
    return bool(entry and entry["until"] > time.time())


def _record_failure(ip):
    entry = _fails.setdefault(ip, {"count": 0, "until": 0.0})
    if entry["until"] and entry["until"] <= time.time():
        entry["count"], entry["until"] = 0, 0.0
    entry["count"] += 1
    if entry["count"] >= MAX_FAILS:
        entry["until"] = time.time() + LOCKOUT_SECONDS


def _safe_next(target):
    """Only allow redirects to a path on this site."""
    if target and target.startswith("/") and not target.startswith("//") and "\\" not in target:
        return target
    return "/"


def init_auth(app):
    # SECRET_KEY signs the session cookie. Without one (local dev only) a random per-process key is used.
    app.secret_key = os.environ.get("SECRET_KEY") or secrets.token_hex(32)
    app.config.update(
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "1") == "1",
        PERMANENT_SESSION_LIFETIME=timedelta(hours=SESSION_HOURS),
        MAX_CONTENT_LENGTH=4 * 1024 * 1024,   # builder state / uploads are small
    )
    if os.environ.get("TRUST_PROXY") == "1":
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

    @app.context_processor
    def _inject():
        return {"auth_on": not auth_disabled(), "auth_user": session.get("user")}

    @app.before_request
    def _gate():
        if request.path.startswith("/static/") or auth_disabled():
            return None
        if not _configured():
            return ("Authentication is not configured on this server. Set SECRET_KEY and "
                    "APP_PASSWORD_HASH (see README).", 503)
        if request.path == "/login":
            return None
        if session.get("user"):
            # Extra CSRF guard on top of SameSite cookies: state-changing requests must come from this site.
            if request.method not in ("GET", "HEAD", "OPTIONS"):
                origin = request.headers.get("Origin")
                if origin and urlparse(origin).netloc != request.host:
                    return jsonify({"error": "Cross-site request blocked."}), 403
            return None
        if request.path.startswith("/api/"):
            return jsonify({"error": "Please sign in.", "login": True}), 401
        return redirect(url_for("login", next=request.full_path.rstrip("?")))

    @app.after_request
    def _headers(resp):
        resp.headers.setdefault("X-Content-Type-Options", "nosniff")
        resp.headers.setdefault("X-Frame-Options", "DENY")
        resp.headers.setdefault("Referrer-Policy", "no-referrer")
        if request.is_secure:
            resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000")
        if not request.path.startswith("/static/"):
            resp.headers.setdefault("Cache-Control", "no-store")
        return resp

    @app.route("/login", methods=["GET", "POST"])
    def login():
        if auth_disabled() or session.get("user"):
            return redirect("/")
        error = ""
        if request.method == "POST":
            ip = request.remote_addr or "?"
            if _locked_out(ip):
                error = "Too many failed attempts. Try again in a few minutes."
            elif _credentials_ok(request.form.get("username", ""), request.form.get("password", "")):
                _fails.pop(ip, None)
                session.clear()
                session.permanent = True
                session["user"] = request.form.get("username", "")
                return redirect(_safe_next(request.args.get("next")))
            else:
                _record_failure(ip)
                error = "Incorrect username or password."
        return render_template("login.html", error=error), (401 if error else 200)

    @app.route("/logout", methods=["POST"])
    def logout():
        session.clear()
        return redirect(url_for("login"))
