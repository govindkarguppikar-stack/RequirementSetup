# Requirement Studio (Flask)

A web app for building `typeUD` / TB / influenza requirement JSON files and for looking up what
requirements a site, its locations, disciplines and programs have in MongoDB.

- **Requirement Builder** — step-by-step form with a live JSON preview, multiple tabs, import, and download.
  Doc type `ud`, `tb` or `influenza` decides the behaviour builder. Files download named after the requirement.
- **Database** — enter a MongoDB connection string (optionally saved in the OS credential store).
- **Requirements Gathering** — search a site by name or ID and see its Site / Location / Discipline / Program
  requirement groups; copy a requirement ID or open it straight in the builder; download an Excel report
  (any mix of the four sheets).

## Setup

```bash
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

## Run (local)

```bash
python app.py                   # http://127.0.0.1:5000
```

Set `FLASK_DEBUG=1` for auto-reload while developing. Optional: `HOST`, `PORT`.

## Run (production / public internet)

Local runs (`python app.py` on 127.0.0.1) need no login. **Anything else is fail-closed**: the app
requires a sign-in and refuses to serve at all if the settings below are missing.

1. **Create the password hash**
   ```bash
   python -c "from werkzeug.security import generate_password_hash as g; print(g('your-password'))"
   ```
2. **Set environment variables** on the host (see `.env.example`; never commit real values):

   | Variable | Required | Purpose |
   |---|---|---|
   | `SECRET_KEY` | yes | long random string that signs the session cookie |
   | `APP_PASSWORD_HASH` | yes | hash from step 1 |
   | `APP_USERNAME` | no | default `admin` |
   | `MONGODB_URI` | recommended | a **read-only** MongoDB user. When set, the server owns the DB connection and the Database tab is locked to it |
   | `TRUST_PROXY=1` | when behind a proxy/PaaS | read the real client IP, host and https |

3. **Serve it with a production server and HTTPS** (the session cookie is HTTPS-only by default):
   ```bash
   gunicorn --bind 0.0.0.0:8000 --workers 1 --threads 8 app:app      # Linux / macOS
   waitress-serve --port=8000 app:app                                 # Windows
   # or:  docker build -t requirement-studio . && docker run -p 8000:8000 --env-file .env requirement-studio
   ```
   Put it behind HTTPS (your host's TLS, or nginx/Caddy). Never run with `FLASK_DEBUG=1` on a server.

Security notes: sign-in is rate-limited per IP (5 failures → 5-minute lockout), sessions last 8 hours,
state-changing requests must come from the same site, and responses are `no-store`. There is a single
shared account; for per-user access put the app behind your SSO / identity-aware proxy. Use a read-only DB
user and restrict the database's network access to the host.

## Project layout

| File | Purpose |
|---|---|
| `app.py` | Routes and the requirement-JSON building rules |
| `gather.py` | MongoDB connection, site search, requirement lookups, report download |
| `report.py` | Excel workbook builder |
| `naming.py` | Safe download file names |
| `templates/index.html` | Page shell |
| `static/app.js` | Builder UI and state |
| `static/gather.js` | Database and Requirements Gathering UI |
| `static/style.css` | Styles |

## Endpoints

| Route | Method | Purpose |
|---|---|---|
| `/` | GET | UI |
| `/api/build`, `/api/download`, `/api/download-all` | POST | Build / download requirement JSON |
| `/api/db/status`, `/api/db/connect`, `/api/db/disconnect` | GET/POST | MongoDB connection |
| `/api/gather/search`, `/api/gather/site/<id>` | POST/GET | Site search and requirements |
| `/api/gather/requirement/<id>` | GET | One requirement (for "Load from DB") |
| `/api/gather/report/<id>?sheets=site,locations,disciplines,programs` | GET | Excel report |
