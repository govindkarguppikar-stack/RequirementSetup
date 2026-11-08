"""
Requirements Gathering — MongoDB-backed lookups (read-only).

The connection string is entered in the UI. If "remember" is on it is saved in the
OS credential store (Windows Credential Manager via `keyring`) — never in a plain
file or the browser — and the server reconnects with it automatically after a
refresh or restart.
Collections used:
  Rubix               : tenant_sites, curriculum_caas, locations
  ComplianceAsService : requirements, requirement_groups
  ExxatNetwork        : master_disciplines, master_programs
"""
import json
import os
import re
import threading
import time

from bson import ObjectId, json_util
from bson.errors import InvalidId
from flask import Blueprint, Response, jsonify, request
from pymongo import MongoClient

from naming import safe_filename
from report import SHEET_KEYS, SHEET_LABELS, build_workbook

bp = Blueprint("gather", __name__)

DB_RUBIX = "Rubix"
DB_CAAS = "ComplianceAsService"
DB_NETWORK = "ExxatNetwork"

REQUIRED_COLLECTIONS = {
    DB_RUBIX: ["tenant_sites", "curriculum_caas", "locations"],
    DB_CAAS: ["requirements", "requirement_groups"],
    DB_NETWORK: ["master_disciplines", "master_programs"],
}

# (field on the document, label shown in the UI)
PHASES = [
    ("caasReqGroup", "Onboarding"),
    ("onbReqGroup", "Ongoing"),
    ("ofbReqGroup", "Offboarding"),
]

_client = None  # set by /api/db/connect or auto-reconnect, never serialised or logged

# ---- saved connection (OS credential store) ----
KEYRING_SERVICE = "requirement-studio"
KEYRING_USER = "mongo-uri"
_connect_lock = threading.Lock()
_auto_failed_at = 0.0   # throttle: don't retry a failing saved connection on every request
_auto_error = ""


def _managed_uri():
    """Hosted mode: the server owner sets MONGODB_URI (a read-only user) and the UI can't change it."""
    return (os.environ.get("MONGODB_URI") or "").strip()


def _saved_uri():
    if _managed_uri():
        return _managed_uri()
    try:
        import keyring
        return keyring.get_password(KEYRING_SERVICE, KEYRING_USER)
    except Exception:
        return None


def _save_uri(uri):
    """Returns an error message, or '' on success."""
    try:
        import keyring
        keyring.set_password(KEYRING_SERVICE, KEYRING_USER, uri)
        return ""
    except Exception as e:
        return f"Connected, but could not save the connection ({type(e).__name__}: {e})."


def _forget_uri():
    try:
        import keyring
        keyring.delete_password(KEYRING_SERVICE, KEYRING_USER)
    except Exception:
        pass  # nothing saved, or no credential store available


def _mask_uri(uri):
    """mongodb+srv://user:secret@host/db -> mongodb+srv://user:***@host/db"""
    return re.sub(r"(://[^:/@\s]+:)[^@\s]+@", r"\1***@", uri or "")


def _short_error(e):
    """pymongo timeout errors dump the whole topology; keep the first sentence."""
    text = f"{type(e).__name__}: {e}"
    return text.split(", Timeout:")[0].split(" (configured")[0][:240]


def _open_client(uri, timeout_ms):
    client = MongoClient(uri, serverSelectionTimeoutMS=timeout_ms, appname="requirement-builder")
    client.admin.command("ping")
    return client


def _ensure_client():
    """The live client; reconnects from the saved connection when there isn't one."""
    global _client, _auto_failed_at, _auto_error
    if _client is not None:
        return _client
    if time.time() - _auto_failed_at < 30:
        return None
    saved = _saved_uri()
    if not saved:
        return None
    with _connect_lock:
        if _client is not None:
            return _client
        try:
            _client = _open_client(saved, 5000)
            _auto_error = ""
        except Exception as e:
            _auto_failed_at = time.time()
            _auto_error = f"Saved connection could not connect: {_short_error(e)}"
    return _client


def _collection_checks(client):
    checks = []
    for db_name, colls in REQUIRED_COLLECTIONS.items():
        try:
            existing = set(client[db_name].list_collection_names())
            err = None
        except Exception as e:  # e.g. no permission to list
            existing, err = set(), f"{type(e).__name__}: {e}"
        checks.append({
            "database": db_name,
            "error": err,
            "collections": [{"name": c, "found": c in existing} for c in colls],
        })
    return checks


class NotConnected(Exception):
    pass


def _db(name):
    client = _ensure_client()
    if client is None:
        raise NotConnected()
    return client[name]


@bp.errorhandler(NotConnected)
def _not_connected(_e):
    return jsonify({"error": "Not connected to a database. Use the Database tab first."}), 400


@bp.errorhandler(Exception)
def _any_error(e):
    # str(e) from pymongo can include host names but not the password.
    return jsonify({"error": f"{type(e).__name__}: {e}"}), 500


# ============================================================
# Connection
# ============================================================
@bp.route("/api/db/status")
def db_status():
    client = _ensure_client()
    managed = bool(_managed_uri())
    saved = _saved_uri()
    out = {
        "connected": client is not None, "managed": managed,
        "saved": bool(saved) and not managed, "masked": _mask_uri(saved) if saved else "",
    }
    if client is not None:
        out["checks"] = _collection_checks(client)
    elif saved and _auto_error:
        out["error"] = _auto_error
    return jsonify(out)


@bp.route("/api/db/connect", methods=["POST"])
def db_connect():
    global _client, _auto_failed_at, _auto_error
    if _managed_uri():
        return jsonify({"error": "The database connection is managed by the server and can't be changed here."}), 403
    body = request.get_json(force=True, silent=True) or {}
    # An empty box with a saved connection means "reconnect with the saved one".
    uri = (body.get("uri") or "").strip() or (_saved_uri() or "")
    remember = body.get("remember", True)
    if not uri:
        return jsonify({"error": "Enter a MongoDB connection string."}), 400
    try:
        client = _open_client(uri, 8000)
    except Exception as e:
        return jsonify({"error": f"Could not connect: {_short_error(e)}"}), 400

    with _connect_lock:
        if _client is not None:
            _client.close()
        _client = client
        _auto_failed_at, _auto_error = 0.0, ""

    warning = ""
    if remember:
        warning = _save_uri(uri)
    else:
        _forget_uri()
    saved = _saved_uri()
    return jsonify({
        "connected": True, "checks": _collection_checks(client), "warning": warning,
        "saved": bool(saved), "masked": _mask_uri(saved) if saved else "",
    })


@bp.route("/api/db/disconnect", methods=["POST"])
def db_disconnect():
    """Disconnects and forgets the saved connection."""
    global _client, _auto_error
    if _managed_uri():
        return jsonify({"error": "The database connection is managed by the server and can't be changed here."}), 403
    if _client is not None:
        _client.close()
        _client = None
    _forget_uri()
    _auto_error = ""
    return jsonify({"connected": False, "saved": False})


# ============================================================
# Search
# ============================================================
def _oid(value):
    try:
        return ObjectId(str(value))
    except (InvalidId, TypeError):
        return None


@bp.route("/api/gather/search", methods=["POST"])
def search_sites():
    q = ((request.get_json(force=True, silent=True) or {}).get("q") or "").strip()
    if not q:
        return jsonify({"error": "Enter a site name or ID."}), 400
    sites = _db(DB_RUBIX)["tenant_sites"]
    conds = [{"name": {"$regex": re.escape(q), "$options": "i"}}]
    oid = _oid(q)
    if oid is not None and len(q) == 24:
        conds.append({"_id": oid})
    docs = sites.find({"$or": conds}, {"name": 1}).limit(25)
    return jsonify({"results": [{"id": str(d["_id"]), "name": d.get("name") or ""} for d in docs]})


# ============================================================
# Group / requirement resolution
# ============================================================
def collect_group_refs(doc):
    """
    For each phase field on `doc`, walk it recursively and return
    {phase_field: [(role, groupId), ...]} — role is the path to the list,
    e.g. "students", "faculties", "empExempt › students".
    """
    out = {}
    for field, _label in PHASES:
        refs = []

        def walk(node, path):
            if isinstance(node, dict):
                for k, v in node.items():
                    walk(v, path + [k])
            elif isinstance(node, list):
                for item in node:
                    if isinstance(item, dict) and item.get("groupId") is not None:
                        refs.append((" › ".join(path), item["groupId"]))

        walk(doc.get(field) or {}, [])
        seen, deduped = set(), []
        for role, gid in refs:
            if (role, gid) not in seen:
                seen.add((role, gid))
                deduped.append((role, gid))
        out[field] = deduped
    return out


class Resolver:
    """Batch-loads requirement groups and requirements, then renders phases."""

    def __init__(self):
        self.groups = {}
        self.reqs = {}

    def load(self, docs):
        gids = {gid for d in docs for refs in collect_group_refs(d).values() for _r, gid in refs}
        if gids:
            for g in _db(DB_CAAS)["requirement_groups"].find(
                    {"_id": {"$in": list(gids)}},
                    {"name": 1, "requirementIds": 1, "active": 1, "_deleted": 1}):
                self.groups[g["_id"]] = g
        rids = {r for g in self.groups.values() for r in (g.get("requirementIds") or [])}
        if rids:
            for r in _db(DB_CAAS)["requirements"].find(
                    {"_id": {"$in": list(rids)}},
                    {"name": 1, "active": 1, "_deleted": 1, "docType": 1, "category": 1,
                     "required": 1, "shortName": 1, "version": 1}):
                self.reqs[r["_id"]] = r

    def phases(self, doc):
        refs = collect_group_refs(doc)
        result = []
        for field, label in PHASES:
            groups = []
            for role, gid in refs[field]:
                g = self.groups.get(gid)
                reqs = []
                if g:
                    for rid in g.get("requirementIds") or []:
                        r = self.reqs.get(rid)
                        reqs.append({
                            "id": str(rid),
                            "name": (r or {}).get("name") or "(requirement not found)",
                            "found": r is not None,
                            "inactive": bool(r) and (r.get("active") is False or bool(r.get("_deleted"))),
                            "shortName": (r or {}).get("shortName") or "",
                            "docType": (r or {}).get("docType") or "",
                            "category": (r or {}).get("category") or "",
                            "required": (r or {}).get("required"),
                        })
                groups.append({
                    "role": role,
                    "groupId": str(gid),
                    "name": (g or {}).get("name") or "(group not found)",
                    "found": g is not None,
                    "inactive": bool(g) and (g.get("active") is False or bool(g.get("_deleted"))),
                    "requirements": reqs,
                })
            result.append({"field": field, "label": label, "groups": groups})
        return result


@bp.route("/api/gather/requirement/<req_id>")
def get_requirement(req_id):
    oid = _oid(req_id.strip())
    if oid is None:
        return jsonify({"error": "That is not a valid requirement ID (expected 24 hex characters)."}), 400
    doc = _db(DB_CAAS)["requirements"].find_one({"_id": oid})
    if not doc:
        return jsonify({"error": "No requirement found with that ID."}), 404
    # BSON -> plain JSON (ObjectId/dates become {"$oid"}/{"$date"}, numbers stay numbers)
    return jsonify(json.loads(json_util.dumps(doc, json_options=json_util.RELAXED_JSON_OPTIONS)))


def _tenant_match(site_oid):
    # tenantId is an ObjectId in most collections but a string in some.
    return {"$in": [site_oid, str(site_oid)]}


def build_site_payload(site_oid):
    """Everything shown on the Requirements Gathering page, or None if the site doesn't exist."""
    rubix = _db(DB_RUBIX)
    site = rubix["tenant_sites"].find_one({"_id": site_oid})
    if not site:
        return None

    locations = list(rubix["locations"].find({"tenantId": _tenant_match(site_oid)}).sort("name", 1))
    curricula = list(rubix["curriculum_caas"].find({
        "tenantId": _tenant_match(site_oid),
        "tags.type": {"$regex": r"^(disi?cipline|program)$", "$options": "i"},
    }))
    disc_docs = [c for c in curricula if str((c.get("tags") or {}).get("type", "")).lower().startswith("dis")]
    prog_docs = [c for c in curricula if str((c.get("tags") or {}).get("type", "")).lower() == "program"]

    # Names from the master collections
    net = _db(DB_NETWORK)
    programs = {p["_id"]: p for p in net["master_programs"].find(
        {"_id": {"$in": [c.get("curriculumId") for c in prog_docs if c.get("curriculumId")]}})}
    disc_ids = {c.get("curriculumId") for c in disc_docs if c.get("curriculumId")}
    disc_ids |= {p.get("disciplineId") for p in programs.values() if p.get("disciplineId")}
    disciplines = {d["_id"]: d for d in net["master_disciplines"].find({"_id": {"$in": list(disc_ids)}})} if disc_ids else {}

    resolver = Resolver()
    resolver.load([site] + locations + curricula)

    def curriculum_entry(c, kind):
        cid = c.get("curriculumId")
        extra = ""
        parent_info = {"id": "", "name": ""}
        if kind == "Program":
            p = programs.get(cid)
            name = (p or {}).get("name")
            parent = disciplines.get((p or {}).get("disciplineId"))
            if parent:
                extra = "Discipline: " + (parent.get("name") or "")
                parent_info = {"id": str(parent["_id"]), "name": parent.get("name") or ""}
        else:
            name = (disciplines.get(cid) or {}).get("name")
        return {
            "id": str(c["_id"]),
            "curriculumId": str(cid) if cid else "",
            "parent": parent_info,
            "name": name or f"(name not found for curriculumId {cid})",
            "extra": extra,
            "inactive": c.get("active") is False or bool(c.get("_deleted")),
            "phases": resolver.phases(c),
        }

    return {
        "site": {"id": str(site["_id"]), "name": site.get("name") or ""},
        "siteLevel": resolver.phases(site),
        "locations": [{
            "id": str(l["_id"]),
            "name": l.get("name") or "",
            "extra": "",
            "inactive": l.get("active") is False or bool(l.get("_deleted")),
            "phases": resolver.phases(l),
        } for l in locations],
        "disciplines": [curriculum_entry(c, "Discipline") for c in disc_docs],
        "programs": [curriculum_entry(c, "Program") for c in prog_docs],
    }


@bp.route("/api/gather/site/<site_id>")
def site_requirements(site_id):
    site_oid = _oid(site_id)
    if site_oid is None:
        return jsonify({"error": "Invalid site ID."}), 400
    payload = build_site_payload(site_oid)
    if payload is None:
        return jsonify({"error": "Site not found."}), 404
    return jsonify(payload)


@bp.route("/api/gather/report/<site_id>")
def download_report(site_id):
    site_oid = _oid(site_id)
    if site_oid is None:
        return jsonify({"error": "Invalid site ID."}), 400
    payload = build_site_payload(site_oid)
    if payload is None:
        return jsonify({"error": "Site not found."}), 404
    # ?sheets=site,locations,disciplines,programs — omitted means all four.
    raw = (request.args.get("sheets") or "").strip()
    chosen = [s for s in (x.strip().lower() for x in raw.split(",")) if s in SHEET_KEYS] if raw else None
    if raw and not chosen:
        return jsonify({"error": "Choose at least one report: site, locations, disciplines or programs."}), 400
    data = build_workbook(payload, chosen)
    # e.g. "H2 Health - All Levels - Requirements Report.xlsx" or "H2 Health - Site + Program - Requirements Report.xlsx"
    if not chosen or len(chosen) == len(SHEET_KEYS):
        report_type = "All Levels"
    else:
        report_type = " + ".join(SHEET_LABELS[k] for k in SHEET_KEYS if k in chosen)
    site_name = safe_filename(payload["site"]["name"], fallback="Site")
    filename = safe_filename(f"{site_name} - {report_type} - Requirements Report", fallback="Requirements Report") + ".xlsx"
    resp = Response(
        data, mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    resp.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return resp
