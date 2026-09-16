"""
Requirement Builder — Flask app
--------------------------------
Serves the form UI and builds the requirement JSON server-side (Python).
Run with:  python app.py
Then open: http://127.0.0.1:5000
"""
import copy
import io
import json
import re
import zipfile

from flask import Flask, Response, jsonify, render_template, request

app = Flask(__name__)


# ============================================================
# Default state (mirrors the shape sent by the frontend)
# ============================================================
def default_state():
    return {
        "basic": {
            "name": "", "shortname": "", "version": 0,
            "categorySelect": "Attestation", "categoryCustom": "",
            "active": True, "required": True,
        },
        "guidelines": {
            "studentHTML": "", "instructorHTML": "", "reviewerHTML": "",
            "templates": {"collectionId": "", "files": []},
            "samples": {"collectionId": "", "useFiles": False, "files": []},
        },
        "behavior": {
            "standard": {
                "requiredTop": False, "enabledTop": True, "label": "", "formId": "", "instructorFormId": "",
                "text": {"required": True, "enabled": True, "label": "Notes"},
                "src": {"required": False, "enabled": False, "label": "Upload Files"},
                "resultDate": {"required": True, "enabled": True, "label": "Start Date"},
                "expiryType": "none", "expiryDays": 365,
                "expiryLogic": {"required": False, "enabled": False, "label": "Expiration Date"},
                "fixedDate": {"day": 1, "month": 1, "year": 2027},
            },
            "tb": {
                "useCustomsKey": False,
                "bloodTest": {
                    "enabled": False, "label": "Blood Test Details", "formId": "tbBloodTest",
                    "expiryType": "period", "expiryDays": 10,
                    "fixedDate": {"day": 1, "month": 1, "year": 2027},
                    "expiryLogic": {"required": False, "enabled": True, "label": "Expiration Date"},
                    "resultDate": {"required": True, "enabled": True, "label": "Result Date"},
                    "src": {"required": True, "enabled": True, "label": "Upload"},
                    "text": {"required": False, "enabled": True, "label": "Notes"},
                    "testType": {"required": True, "enabled": True, "label": "Test Type"},
                },
                "chestXray": {
                    "enabled": False, "label": "Chest X-Ray Details", "formId": "tbChestXRay",
                    "expiryType": "period", "expiryDays": 20,
                    "fixedDate": {"day": 1, "month": 1, "year": 2027},
                    "expiryLogic": {"required": False, "enabled": True, "label": "Expiration Date"},
                    "resultDate": {"required": True, "enabled": True, "label": "Chest X-Ray date"},
                    "src": {"required": True, "enabled": True, "label": "Upload"},
                    "text": {"required": False, "enabled": True, "label": "Notes"},
                },
                "symptomScrn": {
                    "enabled": False, "label": "TB Symptom Screening", "formId": "tbSymptomScrn",
                    "expiryType": "userEntered", "expiryDays": 0,
                    "fixedDate": {"day": 1, "month": 1, "year": 2027},
                    "expiryLogic": {"required": True, "enabled": True, "label": "Expiration Date"},
                    "resultDate": {"required": True, "enabled": True, "label": "Date questionnaire completed"},
                    "src": {"required": True, "enabled": True, "label": "Upload Files"},
                    "text": {"required": True, "enabled": True, "label": "Notes"},
                },
                "vaccine": {
                    "enabled": False, "label": "Skin Test Details", "formId": "tbVaccine",
                    "expiryType": "period", "expiryDays": 15,
                    "fixedDate": {"day": 1, "month": 1, "year": 2027},
                    "expiryLogic": {"required": False, "enabled": True, "label": "Expiration Date"},
                    "src": {"required": True, "enabled": True, "label": "Upload"},
                    "text": {"required": False, "enabled": True, "label": "Notes"},
                    "doses": [
                        {"date": {"required": True, "enabled": True, "label": "Step 1 Test Date"},
                         "induration": {"required": True, "enabled": True, "label": "Step 1 Induration (mm)"}},
                        {"date": {"required": False, "enabled": True, "label": "Step 2 Test Date"},
                         "induration": {"required": False, "enabled": True, "label": "Step 2 Induration (mm)"}},
                        {"date": {"required": False, "enabled": False, "label": "Step 3 Test Date"},
                         "induration": {"required": False, "enabled": False, "label": "Step 3 Induration"}},
                    ],
                },
            },
        },
        "tags": {
            "preset": "ongoing", "activity": "",
            "dueOn": {"days": 14, "direction": "before", "type": "before or after", "phase": "start"},
            "usePublishOn": False,
            "publishOn": {"days": 7, "direction": "before", "type": "before or after", "phase": "start"},
            "userTypes": [],
        },
        "workflow": {"keep": True},
        "carryForward": {"required": False, "type": "indefinite", "days": 0},
    }


def deep_merge(base, override):
    """Recursively merge `override` on top of `base`, filling any missing keys."""
    if not isinstance(base, dict) or not isinstance(override, dict):
        return override if override is not None else base
    result = copy.deepcopy(base)
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    return result


# ============================================================
# JSON-building logic (Python port of the client-side builder)
# ============================================================
def get_category(state):
    basic = state["basic"]
    if basic.get("categorySelect") == "Other":
        return (basic.get("categoryCustom") or "").strip()
    return basic.get("categorySelect", "")


def is_tb(state):
    return get_category(state).strip().lower() == "tb"


def expiry_date_for(cfg):
    etype = cfg.get("expiryType", "none")
    if etype == "period":
        return {"period": {"days": int(cfg.get("expiryDays") or 0)}}
    if etype == "userEntered":
        return {"fixed-date": {"by-user": True}}
    if etype == "fixedDate":
        fd = cfg.get("fixedDate") or {}
        return {"fixed-date": {
            "day": int(fd.get("day") or 1),
            "month": int(fd.get("month") or 1),
            "year": int(fd.get("year") or 2027),
        }}
    return {"fixed-date": {"by-user": False}}


def field_out(cfg):
    """required/enabled/label/value=null — used inside the standard 'custom' object."""
    return {
        "required": bool(cfg.get("required")),
        "enabled": bool(cfg.get("enabled")),
        "label": cfg.get("label") or "",
        "value": None,
    }


def field_out_no_value(cfg):
    """enabled/label/required, no 'value' key — used inside TB sub-sections."""
    return {
        "enabled": bool(cfg.get("enabled")),
        "label": cfg.get("label") or "",
        "required": bool(cfg.get("required")),
    }


def clean_files(files):
    out = []
    for f in files or []:
        file_id = (f.get("fileId") or "")
        file_name = (f.get("fileName") or "")
        if file_id or file_name:
            out.append({"fileId": file_id, "fileName": file_name})
    return out


def build_standard_custom(state, audience=None):
    s = state["behavior"]["standard"]
    form_id = s.get("instructorFormId") if audience == "clinicalinstructor" else s.get("formId")
    custom = {
        "required": bool(s.get("requiredTop")),
        "enabled": bool(s.get("enabledTop")),
        "label": s.get("label") or state["basic"].get("name") or "",
        "faas": {"formId": form_id or ""},
        "text": field_out(s["text"]),
        "src": field_out(s["src"]),
    }
    custom["expiryDate"] = expiry_date_for(s)

    etype = s.get("expiryType")
    if etype == "period":
        # Fixed days from result date -> resultDate becomes mandatory, expiryLogic unused
        expiry_logic = {**s["expiryLogic"], "required": False, "enabled": False}
        result_date = {**s["resultDate"], "required": True, "enabled": True}
    elif etype == "userEntered":
        # Date inserted by user -> expiryLogic becomes mandatory
        expiry_logic = {**s["expiryLogic"], "required": True, "enabled": True}
        result_date = s["resultDate"]
    else:
        # predefined fixed date / no expiry
        expiry_logic = {**s["expiryLogic"], "required": False, "enabled": False}
        result_date = s["resultDate"]

    custom["expiryLogic"] = field_out(expiry_logic)
    custom["resultDate"] = field_out(result_date)
    return custom


def build_tb_section(cfg, has_result_date=False, has_test_type=False, has_doses=False):
    out = {
        "enabled": True,
        "expiryDate": expiry_date_for(cfg),
        "expiryLogic": field_out_no_value(cfg["expiryLogic"]),
        "faas": {"formId": cfg.get("formId") or ""},
        "label": cfg.get("label") or "",
    }
    if has_result_date:
        out["resultDate"] = field_out_no_value(cfg["resultDate"])
    out["src"] = field_out_no_value(cfg["src"])
    if has_test_type:
        out["testType"] = field_out_no_value(cfg["testType"])
    out["text"] = field_out_no_value(cfg["text"])
    if has_doses:
        out["doses"] = [
            {"date": field_out_no_value(d["date"]), "induration": field_out_no_value(d["induration"])}
            for d in cfg.get("doses", [])
        ]
    return out


def build_tb_custom(state):
    t = state["behavior"]["tb"]
    out = {}
    if t["bloodTest"].get("enabled"):
        out["bloodTest"] = build_tb_section(t["bloodTest"], has_result_date=True, has_test_type=True)
    if t["chestXray"].get("enabled"):
        out["chestXray"] = build_tb_section(t["chestXray"], has_result_date=True)
    if t["symptomScrn"].get("enabled"):
        out["symptomScrn"] = build_tb_section(t["symptomScrn"], has_result_date=True)
    if t["vaccine"].get("enabled"):
        out["vaccine"] = build_tb_section(t["vaccine"], has_doses=True)
    return out


def build_tags(state):
    t = state["tags"]
    ordered = {}
    if t.get("activity"):
        ordered["activity"] = t["activity"]

    due = t["dueOn"]
    ordered["dueOn"] = {
        "dateCondition": {
            "days": int(due.get("days") or 0),
            "direction": due.get("direction"),
            "type": due.get("type"),
        },
        "phase": due.get("phase"),
    }

    if t.get("usePublishOn"):
        pub = t["publishOn"]
        ordered["publishOn"] = {
            "dateCondition": {
                "days": int(pub.get("days") or 0),
                "direction": pub.get("direction"),
                "type": pub.get("type"),
            },
            "phase": pub.get("phase"),
        }

    if t.get("userTypes"):
        ordered["userTypes"] = t["userTypes"]

    return ordered


def build_requirement_json(state, audience=None):
    """
    audience: None/'student' -> primary guideline text is saved under the
    "student" key, taken from studentHTML. 'clinicalinstructor' -> saved
    under "clinicalInstructor" instead, taken from instructorHTML when that
    has been filled in (only shown in the UI once both audiences are
    selected) and falling back to studentHTML otherwise, so a single-audience
    clinicalinstructor selection keeps using the one shared editor as before.
    The "reviewer" key is a separate field and is always included regardless
    of audience. FAAS form ID also switches between the student/default form
    ID and the clinical-instructor-specific one.
    """
    g = state["guidelines"]
    student_html = g.get("studentHTML") or ""
    instructor_html = g.get("instructorHTML") or ""
    reviewer_html = g.get("reviewerHTML") or ""
    if audience == "clinicalinstructor":
        primary_key = "clinicalInstructor"
        primary_html = instructor_html if instructor_html.strip() else student_html
    else:
        primary_key = "student"
        primary_html = student_html

    guidelines_obj = {
        primary_key: [primary_html] if primary_html.strip() else [],
        "reviewer": [reviewer_html] if reviewer_html.strip() else [],
        "templates": {
            "collectionId": g["templates"].get("collectionId") or "",
            "files": clean_files(g["templates"].get("files")),
        },
        "samples": {
            "collectionId": g["samples"].get("collectionId") or "",
            "files": clean_files(g["samples"].get("files")) if g["samples"].get("useFiles") else None,
        },
    }

    obj = {
        "guidelines": guidelines_obj,
        "active": bool(state["basic"].get("active")),
        "tags": build_tags(state),
        "schema": "typeUD",
        "docType": "ud",
        "shortname": state["basic"].get("shortname") or "",
        "name": state["basic"].get("name") or "",
        "version": int(state["basic"].get("version") or 0),
        "category": get_category(state),
        "required": bool(state["basic"].get("required")),
        "dueDate": None,
    }

    # For TB requirements, an opt-in toggle moves bloodTest/chestXray/symptomScrn/vaccine
    # out of "custom" into a sibling "customs" key instead. Off (default): unchanged
    # behavior — everything nested under "custom", same as non-TB requirements.
    if is_tb(state):
        tb_payload = build_tb_custom(state)
        if state["behavior"]["tb"].get("useCustomsKey"):
            obj["customs"] = tb_payload
        else:
            obj["custom"] = tb_payload
    else:
        obj["custom"] = build_standard_custom(state, audience)

    if state["workflow"].get("keep"):
        obj["workflow"] = {"auto": True, "on": {"PendingReview": [None, "Approved"]}}

    cf = state["carryForward"]
    obj["carryForwardConfig"] = {
        "disabled": not bool(cf.get("required")),
        "type": cf.get("type"),
        "days": int(cf.get("days") or 0) if cf.get("type") == "days" else 0,
    }

    return obj


def variants_for_download(state):
    """
    Normally one requirement JSON is produced. If both audience checkboxes
    (student + clinicalinstructor) are selected under tags.userTypes, produce
    one variant per audience instead, each scoped to a single userType, with
    its own guideline key (student / clinicalInstructor) and its own FAAS
    form ID — the "reviewer" guideline text and the rest of the requirement
    stay identical across variants.
    """
    user_types = state["tags"].get("userTypes") or []
    if len(user_types) >= 2:
        variants = []
        for ut in user_types:
            variant_state = copy.deepcopy(state)
            variant_state["tags"]["userTypes"] = [ut]
            variants.append((ut, build_requirement_json(variant_state, audience=ut)))
        return variants
    audience = user_types[0] if user_types else None
    return [(audience, build_requirement_json(state, audience=audience))]


def slugify(value):
    value = (value or "requirement").lower()
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value or "requirement"


# ============================================================
# Routes
# ============================================================
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/build", methods=["POST"])
def api_build():
    incoming = request.get_json(force=True, silent=True) or {}
    state = deep_merge(default_state(), incoming)
    user_types = state["tags"].get("userTypes") or []
    # Preview reflects a single audience's output when exactly one is picked
    # (matching what a single-audience download would produce); with zero or
    # both selected it falls back to the "student" shape.
    audience = user_types[0] if len(user_types) == 1 else None
    result = build_requirement_json(state, audience=audience)
    return jsonify(result)


@app.route("/api/download", methods=["POST"])
def api_download():
    incoming = request.get_json(force=True, silent=True) or {}
    state = deep_merge(default_state(), incoming)
    variants = variants_for_download(state)

    basic = state.get("basic", {})
    base_name = slugify(basic.get("shortname") or basic.get("name"))

    if len(variants) == 1:
        text = json.dumps(variants[0][1], indent=2)
        filename = base_name + ".json"
        resp = Response(text, mimetype="application/json")
        resp.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
        return resp

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for user_type, obj in variants:
            zf.writestr(f"{base_name}-{user_type}.json", json.dumps(obj, indent=2))
    buf.seek(0)

    resp = Response(buf.read(), mimetype="application/zip")
    resp.headers["Content-Disposition"] = f'attachment; filename="{base_name}.zip"'
    return resp


@app.route("/api/download-all", methods=["POST"])
def api_download_all():
    incoming = request.get_json(force=True, silent=True) or {}
    tab_states = incoming.get("tabs") or []
    if not isinstance(tab_states, list) or not tab_states:
        return jsonify({"error": "No tabs to download"}), 400

    used_names = {}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for raw_state in tab_states:
            state = deep_merge(default_state(), raw_state or {})
            basic = state.get("basic", {})
            base_name = slugify(basic.get("shortname") or basic.get("name"))
            variants = variants_for_download(state)
            multi = len(variants) > 1
            for user_type, obj in variants:
                name = f"{base_name}-{user_type}" if multi and user_type else base_name
                seen = used_names.get(name, 0)
                used_names[name] = seen + 1
                if seen:
                    name = f"{name}-{seen + 1}"
                zf.writestr(f"{name}.json", json.dumps(obj, indent=2))
    buf.seek(0)

    resp = Response(buf.read(), mimetype="application/zip")
    resp.headers["Content-Disposition"] = 'attachment; filename="requirements.zip"'
    return resp


if __name__ == "__main__":
    app.run(debug=True, port=5000)
