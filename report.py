"""
Excel report for Requirements Gathering.

One workbook, four sheets (Site, Locations, Disciplines, Programs). Every row is
one requirement inside one group inside one phase, so the sheets can be
filtered/pivoted in Excel. Each sheet starts with a title block (report name,
site name + ID, generation time, totals) above the table.
"""
from datetime import datetime
from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

ACCENT = "4F46E5"
INK = "151A2D"
SOFT = "4B536B"
LINE = "E0E3EE"

PHASE_COLORS = {"Onboarding": "059669", "Ongoing": "2563EB", "Offboarding": "EA580C"}

# Columns shared by every sheet: (header, width)
TAIL_COLS = [
    ("Phase", 14), ("Audience / Role", 24), ("Group ID", 27), ("Group Name", 48), ("Group Status", 14),
    ("Requirement ID", 27), ("Requirement Name", 52), ("Short Name", 16), ("Doc Type", 12),
    ("Category", 24), ("Required", 10), ("Requirement Status", 18),
]

SHEETS = [
    # key, sheet title, report title, tab colour, lead columns (header, width)
    ("site", "Site", "Site Level Requirements", "4F46E5", []),
    ("locations", "Locations", "Location Level Requirements", "0284C7",
     [("Location ID", 27), ("Location Name", 38)]),
    ("disciplines", "Disciplines", "Discipline Level Requirements", "7C3AED",
     [("Curriculum Record ID", 27), ("Discipline ID", 27), ("Discipline Name", 34)]),
    ("programs", "Programs", "Program Level Requirements", "D97706",
     [("Curriculum Record ID", 27), ("Program ID", 27), ("Program Name", 34),
      ("Discipline ID", 27), ("Discipline Name", 30)]),
]

THIN = Side(style="thin", color=LINE)
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def _status(obj):
    if obj.get("found") is False:
        return "Not found"
    return "Inactive / Deleted" if obj.get("inactive") else "Active"


def _yes_no(value):
    if value is None:
        return ""
    return "Yes" if value else "No"


def _entity_lead(key, entity):
    """Leading (entity-specific) cells for a row, matching the sheet's lead columns."""
    if key == "locations":
        return [entity["id"], entity["name"]]
    if key == "disciplines":
        return [entity["id"], entity.get("curriculumId", ""), entity["name"]]
    if key == "programs":
        parent = entity.get("parent") or {}
        return [entity["id"], entity.get("curriculumId", ""), entity["name"], parent.get("id", ""), parent.get("name", "")]
    return []


def _rows_for(key, site, entities):
    """Yield (row values, phase label) for every requirement (or empty group) of every entity."""
    for entity in entities:
        lead = [site["id"], site["name"]] + _entity_lead(key, entity)
        for phase in entity["phases"]:
            for group in phase["groups"]:
                base = lead + [phase["label"], group["role"], group["groupId"], group["name"], _status(group)]
                if not group["requirements"]:
                    yield base + ["", "", "", "", "", "", "No requirements in this group"], phase["label"]
                for req in group["requirements"]:
                    yield base + [
                        req["id"], req["name"], req.get("shortName", ""), req.get("docType", ""),
                        req.get("category", ""), _yes_no(req.get("required")), _status(req),
                    ], phase["label"]


def _write_sheet(wb, spec, payload, generated):
    key, title, report_title, tab_color, lead_cols = spec
    site = payload["site"]
    ws = wb.create_sheet(title)
    ws.sheet_properties.tabColor = tab_color

    columns = [("Site ID", 27), ("Site Name", 34)] + lead_cols + TAIL_COLS
    ncols = len(columns)
    last = get_column_letter(ncols)
    phase_col = 2 + len(lead_cols) + 1  # 1-based index of the "Phase" column

    entities = [{"id": "", "name": "", "phases": payload["siteLevel"]}] if key == "site" else payload[key]
    rows = list(_rows_for(key, site, entities))
    group_ids = {r[0][phase_col + 1] for r in rows}
    req_ids = {r[0][phase_col + 4] for r in rows if r[0][phase_col + 4]}

    # ---- title block ----
    ws.merge_cells(f"A1:{last}1")
    ws["A1"] = f"Requirements Report — {report_title}"
    ws["A1"].font = Font(name="Calibri", size=16, bold=True, color="FFFFFF")
    ws["A1"].fill = PatternFill("solid", fgColor=ACCENT)
    ws["A1"].alignment = Alignment(vertical="center", indent=1)
    ws.row_dimensions[1].height = 30

    ws.merge_cells(f"A2:{last}2")
    ws["A2"] = f"Site: {site['name']}     |     Site ID: {site['id']}     |     Generated: {generated}"
    ws["A2"].font = Font(name="Calibri", size=11, color=INK, bold=True)
    ws["A2"].alignment = Alignment(vertical="center", indent=1)

    ws.merge_cells(f"A3:{last}3")
    if key == "site":
        counts = ""
    else:
        counts = f"{len(entities)} {title.lower()}     |     "
    ws["A3"] = f"{counts}{len(group_ids)} groups     |     {len(req_ids)} unique requirements     |     {len(rows)} rows"
    ws["A3"].font = Font(name="Calibri", size=10, color=SOFT)
    ws["A3"].alignment = Alignment(vertical="center", indent=1)

    # ---- table header ----
    header_row = 5
    for i, (name, width) in enumerate(columns, start=1):
        c = ws.cell(row=header_row, column=i, value=name)
        c.font = Font(name="Calibri", size=11, bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor=INK)
        c.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)
        c.border = BORDER
        ws.column_dimensions[get_column_letter(i)].width = width
    ws.row_dimensions[header_row].height = 24

    # ---- body ----
    if not rows:
        ws.merge_cells(start_row=7, start_column=1, end_row=7, end_column=ncols)
        ws.cell(row=7, column=1, value=f"No {title.lower()} requirements found for this site.").font = Font(italic=True, color=SOFT)
    mono = Font(name="Consolas", size=9, color=SOFT)
    base_font = Font(name="Calibri", size=10, color=INK)
    for r_idx, (values, phase) in enumerate(rows, start=header_row + 1):
        for c_idx, value in enumerate(values, start=1):
            cell = ws.cell(row=r_idx, column=c_idx, value=value)
            cell.border = BORDER
            cell.alignment = Alignment(vertical="top", wrap_text=True)
            header = columns[c_idx - 1][0]
            if header.endswith("ID"):
                cell.font = mono
            elif header == "Phase":
                color = PHASE_COLORS.get(phase, INK)
                cell.font = Font(name="Calibri", size=10, bold=True, color=color)
                cell.fill = PatternFill("solid", fgColor=_tint(color))
            elif header.endswith("Status") and value and value != "Active":
                cell.font = Font(name="Calibri", size=10, bold=True, color="B45309")
            else:
                cell.font = base_font

    # ---- usability ----
    ws.freeze_panes = ws.cell(row=header_row + 1, column=1)
    if rows:
        ws.auto_filter.ref = f"A{header_row}:{last}{header_row + len(rows)}"
    ws.sheet_view.showGridLines = False
    ws.page_setup.orientation = "landscape"
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.print_title_rows = f"{header_row}:{header_row}"


def _tint(hex_color):
    """Light tint of a hex colour (for the Phase cell background)."""
    r, g, b = (int(hex_color[i:i + 2], 16) for i in (0, 2, 4))
    mix = lambda v: int(v + (255 - v) * 0.85)
    return f"{mix(r):02X}{mix(g):02X}{mix(b):02X}"


SHEET_KEYS = [spec[0] for spec in SHEETS]
# Singular labels used in download file names
SHEET_LABELS = {"site": "Site", "locations": "Location", "disciplines": "Discipline", "programs": "Program"}


def build_workbook(payload, sheets=None):
    """`sheets`: optional subset of SHEET_KEYS (site/locations/disciplines/programs); default is all four."""
    wanted = [k for k in SHEET_KEYS if sheets is None or k in sheets] or SHEET_KEYS
    wb = Workbook()
    wb.remove(wb.active)
    generated = datetime.now().strftime("%d %b %Y, %H:%M")
    for spec in SHEETS:
        if spec[0] in wanted:
            _write_sheet(wb, spec, payload, generated)
    wb.properties.title = f"Requirements Report - {payload['site']['name']}"
    wb.properties.creator = "Requirement Builder"
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()

