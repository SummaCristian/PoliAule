"""
Scrapes PoliMi's graduation sessions (sessioni di laurea) and writes
data/graduation-sessions.json.

The dates live in a PDF ("Periodi di lezione e sessioni di laurea - YYYY/YYYY")
linked from the "Calendari e scadenze" page. Both can change without notice:
the PDF's file name changes with every revision (…_v1.1.pdf), the table may
move to another page, and its columns may be reordered or reworded. So
nothing here relies on file names, page numbers or column positions:

- Links: every PDF link on the page whose title/text/file name mentions the
  graduation sessions; failing that, every PDF linked from the page, kept only
  if its text has a "Sessioni di laurea" table.
- PDF: every page mentioning "sessioni di laurea" is read. Rows come from the
  table's cells (pdfplumber), classified by content (the date cell, the level
  cell, the campus cell), with a plain-text line parser as a fallback for a
  table drawn without cell borders.
- Campuses: the campus cell ("Milano + discussione Design") is split on "+"
  and each part resolved against data/classrooms.json's primary campuses (see
  campus_groups()), so a new campus there is picked up without touching this.
- Validation: each date's weekday must match the one printed next to it, dates
  must fall in the document's academic year, and each document needs at least
  MIN_ROWS rows with a recognised level and campus. A campus part that resolves
  to nothing fails too, rather than silently dropping a campus's celebration.
  Anything off exits non-zero and leaves the last good
  data/graduation-sessions.json alone.

Sessions of an academic year the page no longer links (the old PDF swapped for
next year's while its July sessions are still ahead) are carried over from the
previous output file until their date has passed.
"""

import io
import json
import os
import re
import sys
import time
import unicodedata
from datetime import date, datetime
from pathlib import Path
from urllib.parse import urljoin

import httpx
import pdfplumber
from bs4 import BeautifulSoup

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SOURCE_URL = "https://www.polimi.it/studenti/calendari-e-scadenze"
OUTPUT_FILE = Path(__file__).parent.parent / "data" / "graduation-sessions.json"
CLASSROOMS_FILE = Path(__file__).parent.parent / "data" / "classrooms.json"

REQUEST_TIMEOUT = 30  # seconds
REQUEST_DELAY = 0.5   # seconds between PDF downloads, as in the other scrapers

# Polimi's WAF blocks the default httpx UA; a browser-like UA lets requests
# from CI runners through.
REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
}

# At most this many PDFs are downloaded per run when no link names the
# graduation sessions and every PDF on the page has to be probed.
MAX_PROBED_PDFS = 6

# Minimum sanity threshold per document: an academic year has ~6 sessions of
# 2-3 days each (18 rows in 2026/2027).
MIN_ROWS = 6

_MONTHS = [
    "gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno",
    "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre",
]
_MONTH_NAMES = "|".join(_MONTHS)
# Weekdays as date.weekday() numbers them; the accent is optional because
# PDFs sometimes come out with "Mercoledi" or a decomposed "ì".
_WEEKDAYS = ["luned", "marted", "mercoled", "gioved", "venerd", "sabato", "domenica"]

# "Martedì 29 settembre 2026", "Giovedì 1° ottobre 2026", "07 aprile 2027".
# The weekday and the year are optional; a missing year is taken from the
# academic year.
DATE_RE = re.compile(
    r"(?:\b(?P<weekday>luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica)\s+)?"
    rf"\b(?P<day>\d{{1,2}})\s*[°º]?\s+(?P<month>{_MONTH_NAMES})(?:\s+(?P<year>\d{{4}}))?\b",
    re.IGNORECASE,
)

# The session column's label, "Settembre 2026".
SESSION_LABEL_RE = re.compile(rf"^(?:{_MONTH_NAMES})\s+\d{{4}}$", re.IGNORECASE)

# "A. A. 2026/2027", "a.a. 2026-27", "2026/2027".
ACADEMIC_YEAR_RE = re.compile(r"\b(20\d{2})\s*[/-]\s*(20\d{2}|\d{2})\b")

# Degree levels, matched in order on the level text. Ciclo unico first so
# "Laurea Magistrale a ciclo unico" doesn't also count as plain magistrale.
LEVEL_PATTERNS = [
    ("ciclo_unico", re.compile(r"\bLM\s*C\.?\s*U\b\.?|(?:laurea\s+)?magistrale\s+a\s+ciclo\s+unico|ciclo\s+unico", re.IGNORECASE)),
    ("magistrale", re.compile(r"\bmagistrale\b|\bLM\b", re.IGNORECASE)),
    ("triennale", re.compile(r"\btriennale\b|\bprimo\s+livello\b", re.IGNORECASE)),
    ("dottorato", re.compile(r"\bdottorato\b", re.IGNORECASE)),
]

# The level at the start of a text line, for the text fallback where cells
# aren't separated: "Laurea Magistrale + LM C.U. Poli Territoriali".
_LEVEL_ATOM = (
    r"(?:laurea\s+)?(?:magistrale\s+a\s+ciclo\s+unico|triennale|magistrale)"
    r"|LM\s*C\.?\s*U\b\.?|dottorato(?:\s+di\s+ricerca)?"
)
LEVEL_PREFIX_RE = re.compile(rf"^(?:{_LEVEL_ATOM})(?:\s*\+\s*(?:{_LEVEL_ATOM}))*", re.IGNORECASE)

# Campus cell parts. "Milano" is every primary campus in Milan, Bovisa
# included; "Poli Territoriali" every primary campus outside it (secondary
# ones like Como are offices, nothing to celebrate); the Design School's days
# ("discussione Design", "Proclamazione Design") only Bovisa's campuses, which
# it shares with some engineering programmes.
MILANO_RE = re.compile(r"\bmilano\b", re.IGNORECASE)
POLI_TERRITORIALI_RE = re.compile(r"\b(?:poli|sedi|campus)\s+(?:territoriali|regionali)\b", re.IGNORECASE)
DESIGN_RE = re.compile(r"\bdesign\b", re.IGNORECASE)
DESIGN_EVENT_RES = [
    ("proclamazione", re.compile(r"\bproclamazion", re.IGNORECASE)),
    ("discussione", re.compile(r"\bdiscussion", re.IGNORECASE)),
]
DESIGN_GROUP = "Bovisa"  # classrooms.json `group` of the Design School's campuses

# Header and footer lines the text fallback must not mistake for a wrapped
# campus cell.
NON_CONTENT_LINE_RE = re.compile(
    r"^(?:sessioni\s+di\s+laurea|sessione\b.*\blivello\b.*|pag\.?\s*\d+\s*(?:di|/)\s*\d+)$",
    re.IGNORECASE,
)


class ScrapeError(Exception):
    pass


def write_github_output(status: str, message: str):
    """Append a `status` and multi-line `message` output for the GitHub Actions step, if running in CI."""
    output_path = os.environ.get("GITHUB_OUTPUT")
    if not output_path:
        return
    delimiter = "FETCH_MESSAGE_EOF"
    with open(output_path, "a", encoding="utf-8") as f:
        f.write(f"status={status}\n")
        f.write(f"message<<{delimiter}\n{message}\n{delimiter}\n")


# ---------------------------------------------------------------------------
# Text helpers
# ---------------------------------------------------------------------------


def clean(text: str | None) -> str:
    """NFC-normalise and collapse whitespace (cells wrap with \\n)."""
    if not text:
        return ""
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", text)).strip()


def parse_levels(text: str) -> list[str]:
    """The degree levels named in a level cell, e.g. ["magistrale", "ciclo_unico"]."""
    levels = []
    remaining = text
    for key, pattern in LEVEL_PATTERNS:
        if pattern.search(remaining):
            levels.append(key)
            remaining = pattern.sub(" ", remaining)
    return levels


def parse_academic_year(text: str) -> tuple[int, int] | None:
    """(2026, 2027) from the first "2026/2027"-like span whose years are consecutive."""
    for m in ACADEMIC_YEAR_RE.finditer(text):
        start = int(m.group(1))
        end = m.group(2)
        end = int(end) if len(end) == 4 else (start // 100) * 100 + int(end)
        if end == start + 1:
            return start, end
    return None


def resolve_date(m: re.Match, academic_year: tuple[int, int] | None) -> date:
    """A DATE_RE match as a date, checking its printed weekday."""
    month = _MONTHS.index(m.group("month").lower()) + 1
    if m.group("year"):
        year = int(m.group("year"))
    elif academic_year:
        # An academic year runs from September to the next summer.
        year = academic_year[0] if month >= 8 else academic_year[1]
    else:
        raise ScrapeError(f"Date '{m.group(0)}' has no year and the academic year is unknown.")

    try:
        d = date(year, month, int(m.group("day")))
    except ValueError as e:
        raise ScrapeError(f"Invalid date '{m.group(0)}': {e}")

    weekday = m.group("weekday")
    if weekday:
        expected = _WEEKDAYS[d.weekday()]
        if not weekday.lower().startswith(expected):
            raise ScrapeError(
                f"'{m.group(0)}' is printed as a {weekday} but {d.isoformat()} is a {expected}*. "
                "The date was likely misread."
            )
    return d


def campus_groups() -> dict[str, list[str]]:
    """Campus ids per campus-cell group, from data/classrooms.json's primary campuses.

    Keys: "milano", "poli_territoriali", "design", plus every city outside
    Milan in lower case, should the PDF ever name one ("Lecco"); a secondary
    campus's city maps to no campus, so naming it is recognised but celebrates
    nothing.
    """
    try:
        with open(CLASSROOMS_FILE, encoding="utf-8") as f:
            campuses = json.load(f)
    except (OSError, ValueError) as e:
        raise ScrapeError(f"Could not read {CLASSROOMS_FILE}: {e}")

    groups = {"milano": [], "poli_territoriali": [], "design": []}
    for campus in campuses:
        city = campus.get("city", "")
        if city != "Milano":
            groups.setdefault(city.lower(), [])
        if campus.get("secondary"):
            continue
        groups["milano" if city == "Milano" else "poli_territoriali"].append(campus["id"])
        if campus.get("group") == DESIGN_GROUP:
            groups["design"].append(campus["id"])
        if city != "Milano":
            groups[city.lower()].append(campus["id"])
    if not all(groups[k] for k in ("milano", "poli_territoriali", "design")):
        raise ScrapeError(f"{CLASSROOMS_FILE.name} has no primary campus for some group: {groups}")
    return groups


def parse_campuses(text: str, groups: dict[str, list[str]]) -> list[dict]:
    """The campus cell as its "+"-separated parts, each with the campuses it covers.

    "Poli Territoriali + Proclamazione Design" ->
    [{"group": "poli_territoriali", "event": None, "campuses": [...]},
     {"group": "design", "event": "proclamazione", "campuses": ["MIB02", "MIB01"]}]
    """
    parts = []
    for part in filter(None, (clean(p) for p in text.split("+"))):
        event = None
        if DESIGN_RE.search(part):
            group = "design"
            event = next((key for key, r in DESIGN_EVENT_RES if r.search(part)), None)
        elif POLI_TERRITORIALI_RE.search(part):
            group = "poli_territoriali"
        elif MILANO_RE.search(part):
            group = "milano"
        else:
            group = next((city for city in groups if re.search(rf"\b{re.escape(city)}\b", part, re.IGNORECASE)), None)
            if group is None:
                raise ScrapeError(f"Unrecognised campus '{part}' in '{text}'.")
        parts.append({"group": group, "event": event, "campuses": groups[group]})
    return parts


# ---------------------------------------------------------------------------
# PDF parsing
# ---------------------------------------------------------------------------


def rows_from_tables(tables: list[list[list[str | None]]]) -> list[dict]:
    """Raw rows from pdfplumber tables, cells classified by what they contain.

    Merged cells (the session label spanning its days) come back as None in
    every row but the first, so the session label is filled down.
    """
    rows = []
    for table in tables:
        session = None
        for cells in table:
            cells = [clean(c) for c in cells]
            date_idx = next((i for i, c in enumerate(cells) if DATE_RE.search(c)), None)
            if date_idx is None:
                continue

            date_cell = cells[date_idx]
            date_match = DATE_RE.search(date_cell)
            # Text sharing the date's cell (two columns merged into one) is
            # treated like the rest of the row.
            leftover = clean(date_cell[:date_match.start()] + " " + date_cell[date_match.end():])

            others = [c for i, c in enumerate(cells) if i != date_idx and c]
            for c in others:
                if SESSION_LABEL_RE.match(c):
                    session = c
            others = [c for c in others if not SESSION_LABEL_RE.match(c)]
            if leftover:
                others.insert(0, leftover)

            level_cells = [c for c in others if parse_levels(c) and LEVEL_PREFIX_RE.match(c)]
            if len(level_cells) == 1 and LEVEL_PREFIX_RE.match(level_cells[0]).end() == len(level_cells[0]):
                level_text = level_cells[0]
                campus_text = clean(" ".join(c for c in others if c is not level_text))
            else:
                # No clean level cell: split the joined text like a text line.
                level_text, campus_text = split_level_campus(" ".join(others))

            rows.append({
                "date_match": date_match,
                "session": session,
                "level_text": level_text,
                "campus_text": campus_text,
            })
    return rows


def split_level_campus(text: str) -> tuple[str, str]:
    """"Laurea Triennale Milano + discussione Design" -> ("Laurea Triennale", "Milano + discussione Design")."""
    text = clean(text)
    m = LEVEL_PREFIX_RE.match(text)
    if not m:
        return "", text
    return clean(m.group(0)), clean(text[m.end():])


def rows_from_text(text: str) -> list[dict]:
    """Raw rows from the page's text lines, for a table pdfplumber can't see.

    A line without a date that isn't a heading, footer or session label is a
    wrapped campus cell and is appended to the row above (cells are top
    aligned, so a wrap always follows its row's first line).
    """
    rows = []
    for raw_line in text.splitlines():
        line = clean(raw_line)
        if not line:
            continue
        m = DATE_RE.search(line)
        if m:
            before = clean(line[:m.start()])
            level_text, campus_text = split_level_campus(line[m.end():])
            rows.append({
                "date_match": m,
                "session": before if SESSION_LABEL_RE.match(before) else None,
                "level_text": level_text,
                "campus_text": campus_text,
            })
        elif rows and not SESSION_LABEL_RE.match(line) and not NON_CONTENT_LINE_RE.match(line):
            rows[-1]["campus_text"] = clean(rows[-1]["campus_text"] + " " + line)
    return rows


def parse_pdf(content: bytes, link_title: str = "") -> dict | None:
    """The graduation sessions in one PDF, or None if it has no such table.

    Raises ScrapeError if it has the table but its rows don't validate.
    """
    try:
        pdf = pdfplumber.open(io.BytesIO(content))
    except Exception as e:  # pdfminer raises a zoo of exception types
        raise ScrapeError(f"Could not open PDF: {e}")

    with pdf:
        pages = [(page, page.extract_text() or "") for page in pdf.pages]

        full_text = "\n".join(t for _, t in pages)
        academic_year = parse_academic_year(full_text[:500]) or parse_academic_year(link_title)

        raw_rows = []
        for page, text in pages:
            if not re.search(r"sessioni\s+di\s+laurea", text, re.IGNORECASE):
                continue
            page_rows = rows_from_tables(page.extract_tables())
            if not page_rows:
                page_rows = rows_from_text(text)
            raw_rows.extend(page_rows)

    if not raw_rows:
        return None

    groups = campus_groups()
    sessions = []
    for row in raw_rows:
        d = resolve_date(row["date_match"], academic_year)
        parts = parse_campuses(row["campus_text"], groups)
        sessions.append({
            "date": d,
            "session": row["session"],
            "levels": parse_levels(row["level_text"]),
            "campuses": sorted({c for p in parts for c in p["campuses"]}),
            "campus_parts": parts,
            "level_text": row["level_text"],
            "campus_text": row["campus_text"],
        })

    if not academic_year:
        # Every date carried its year: the academic year starts in the
        # autumn of the earliest one.
        first = min(s["date"] for s in sessions)
        start = first.year if first.month >= 8 else first.year - 1
        academic_year = (start, start + 1)

    validate_document(sessions, academic_year)
    return {"academic_year": f"{academic_year[0]}/{academic_year[1]}", "sessions": sessions}


def validate_document(sessions: list[dict], academic_year: tuple[int, int]) -> None:
    """Reject an implausible parse rather than overwrite the last known-good file."""
    label = f"{academic_year[0]}/{academic_year[1]}"
    if len(sessions) < MIN_ROWS:
        raise ScrapeError(
            f"{label}: only parsed {len(sessions)} graduation days, expected at least {MIN_ROWS}. "
            "The PDF's layout may have changed."
        )
    first_ok, last_ok = date(academic_year[0], 8, 1), date(academic_year[1], 12, 31)
    for s in sessions:
        where = f"{label} {s['date'].isoformat()}"
        if not first_ok <= s["date"] <= last_ok:
            raise ScrapeError(f"{where}: outside academic year {label}.")
        if not s["levels"]:
            raise ScrapeError(f"{where}: no known degree level in '{s['level_text']}'.")
        if not s["campus_parts"]:
            raise ScrapeError(f"{where}: empty campus/courses cell.")
    all_levels = {lv for s in sessions for lv in s["levels"]}
    if not {"triennale", "magistrale"} <= all_levels:
        raise ScrapeError(f"{label}: expected both triennale and magistrale sessions, got {sorted(all_levels)}.")


# ---------------------------------------------------------------------------
# Page parsing
# ---------------------------------------------------------------------------


def find_pdf_links(html: str) -> tuple[list[dict], bool]:
    """PDF links on the page, best candidates first.

    Returns (links, named): named is True when the links are the ones whose
    title/text/file name mentions the graduation sessions, False when it's
    every PDF on the page, to be probed.
    """
    soup = BeautifulSoup(html, "html.parser")
    links, seen = [], set()
    for a in soup.find_all("a", href=True):
        href = urljoin(SOURCE_URL, a["href"])
        if not re.search(r"\.pdf(?:$|[?#])", href, re.IGNORECASE) or href in seen:
            continue
        seen.add(href)
        # The card's heading sits next to the link, not inside it.
        card = a.find_parent(["li", "div"])
        heading = card.find(re.compile(r"^h[1-6]$")) if card else None
        title = clean(a.get("title")) or clean(heading.get_text(" ") if heading else "")
        # Matched against, along with the URL; "Scarica" button text included.
        text = clean(" ".join([title, a.get_text(" ")]))
        links.append({"url": href, "title": title, "text": text})

    def names_sessions(link):
        haystack = (link["text"] + " " + link["url"]).lower().replace("_", " ").replace("-", " ")
        return bool(re.search(r"sessioni\s+(?:di\s+)?laurea|sessioni\s+laurea", haystack))

    named = [l for l in links if names_sessions(l)]
    if named:
        return named, True
    # Probe the ones most likely to hold the table first.
    links.sort(key=lambda l: "laurea" not in (l["text"] + l["url"]).lower())
    return links[:MAX_PROBED_PDFS], False


def scrape(client: httpx.Client) -> tuple[list[dict], list[str]]:
    """(documents, warnings) from the live page and its PDFs."""
    response = client.get(SOURCE_URL)
    response.raise_for_status()

    links, named = find_pdf_links(response.text)
    if not links:
        raise ScrapeError(f"No PDF links found on {SOURCE_URL}. The page layout may have changed.")

    documents, warnings = [], []
    for i, link in enumerate(links):
        if i:
            time.sleep(REQUEST_DELAY)
        try:
            pdf_response = client.get(link["url"])
            pdf_response.raise_for_status()
            doc = parse_pdf(pdf_response.content, link["title"])
        except (httpx.HTTPError, ScrapeError) as e:
            if named:
                # A link that says it's the sessions PDF but doesn't parse is
                # a layout change worth failing on.
                raise ScrapeError(f"{link['title'] or link['url']}: {e}")
            warnings.append(f"Skipped {link['url']}: {e}")
            continue
        if doc is None:
            if named:
                raise ScrapeError(
                    f"{link['title'] or link['url']} has no 'Sessioni di laurea' table. "
                    "The PDF's layout may have changed."
                )
            continue
        doc["url"] = link["url"]
        doc["title"] = link["title"]
        documents.append(doc)

    if not documents:
        raise ScrapeError(
            f"None of the {len(links)} PDFs linked from {SOURCE_URL} has a 'Sessioni di laurea' table."
        )
    if not named:
        warnings.append("No link names the graduation sessions any more; found them by probing every PDF.")
    return documents, warnings


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------


def carried_over_sessions(scraped_years: set[str], today: date) -> list[dict]:
    """Upcoming sessions from the previous output whose academic year the page no longer links."""
    try:
        with open(OUTPUT_FILE, encoding="utf-8") as f:
            previous = json.load(f)
    except (OSError, ValueError):
        return []
    return [
        s for s in previous.get("sessions", [])
        if s.get("academic_year") not in scraped_years and s.get("date", "") >= today.isoformat()
    ]


def build_output(documents: list[dict], today: date) -> dict:
    sessions = []
    for doc in documents:
        for s in doc["sessions"]:
            sessions.append({
                "date": s["date"].isoformat(),
                "academic_year": doc["academic_year"],
                "session": s["session"],
                "levels": s["levels"],
                "campuses": s["campuses"],
                "campus_parts": s["campus_parts"],
                "level_text": s["level_text"],
                "campus_text": s["campus_text"],
            })
    scraped_years = {doc["academic_year"] for doc in documents}
    sessions += carried_over_sessions(scraped_years, today)

    # The same academic year can be linked twice (desktop/mobile variants).
    unique = {(s["date"], s["level_text"], s["campus_text"]): s for s in sessions}
    sessions = sorted(unique.values(), key=lambda s: (s["date"], s["level_text"]))

    return {
        "generated_at": datetime.now().isoformat(),
        "source_url": SOURCE_URL,
        "documents": [
            {"academic_year": d["academic_year"], "title": d["title"], "url": d["url"]}
            for d in documents
        ],
        "sessions": sessions,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    """Fetch, parse, validate, and write data/graduation-sessions.json.

    Any failure (network error, unparseable PDF, failed validation) exits
    non-zero without touching the existing output file.
    """
    try:
        with httpx.Client(timeout=REQUEST_TIMEOUT, follow_redirects=True, headers=REQUEST_HEADERS) as client:
            documents, warnings = scrape(client)
    except (httpx.HTTPError, ScrapeError) as e:
        message = f"Graduation sessions scrape failed, leaving existing {OUTPUT_FILE.name} untouched: {e}"
        print(message, file=sys.stderr)
        write_github_output("failed", message)
        return 1

    output = build_output(documents, date.today())
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    years = ", ".join(d["academic_year"] for d in documents)
    message = f"Written {len(output['sessions'])} graduation days ({years}) to {OUTPUT_FILE}"
    for w in warnings:
        print(f"Warning: {w}", file=sys.stderr)
    if warnings:
        message += "\n" + "\n".join(warnings)
    print(message)
    write_github_output("warning" if warnings else "ok", message)
    return 0


if __name__ == "__main__":
    sys.exit(main())
