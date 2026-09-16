# Requirement Builder (Flask)

A local web app for building `typeUD` requirement JSON files. The form and
live preview run in the browser; the actual JSON is assembled by the Python
backend in `app.py`.

## Setup

```bash
python3 -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

## Run

```bash
python app.py
```

Then open **http://127.0.0.1:5000** in your browser.

## How it works

- `app.py` — Flask routes plus the JSON-building logic (`build_requirement_json`
  and friends). This is a direct Python port of the rules you specified:
  required-implies-enabled linkage, the four expiry-logic types, the TB
  multi-panel `custom` structure, workflow on/off, and carry-forward.
- `templates/index.html` — the page shell.
- `static/style.css` — styling.
- `static/app.js` — the form UI and state management. On every change it
  POSTs the current state to `/api/build` and renders whatever JSON comes
  back. The Download button POSTs to `/api/download`, which returns the
  file with a `Content-Disposition` header so the browser saves it directly.

## Endpoints

| Route            | Method | Purpose                                          |
|-------------------|--------|---------------------------------------------------|
| `/`               | GET    | Serves the form UI                                |
| `/api/build`      | POST   | Body: current form state (JSON). Returns the built requirement JSON. |
| `/api/download`   | POST   | Same body. Returns the JSON as a downloadable file. |

## Editing the rules

All of the actual JSON-shaping logic lives in `app.py`, in plain Python
functions (`build_standard_custom`, `build_tb_custom`, `build_tags`, etc.) —
no templating tricks. If a rule needs to change, that's the file to edit.
