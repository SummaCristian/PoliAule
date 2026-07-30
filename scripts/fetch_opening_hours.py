import json
import re
import sys
from datetime import date, datetime
from pathlib import Path

import httpx
from bs4 import BeautifulSoup

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SOURCE_URL = "https://www.polimi.it/campus-e-servizi/spazi-e-aule-studio/orari-di-apertura-edifici"
OUTPUT_FILE = Path(__file__).parent.parent / "data" / "opening-hours.json"

REQUEST_TIMEOUT = 20  # seconds

# Fallback used for buildings with no data on the source page at all
# (e.g. Cremona, Lecco, Mantova campuses aren't covered by the page).
DEFAULT_HOURS = {"mon_fri": ["07:15", "20:15"], "sat": None, "sun": None}

# Maps the campus label used on the source page's "Tutti"/"Tutti gli altri
# spazi" catch-all rows to the campus id(s) used in data/classrooms.json.
PAGE_CAMPUS_LABEL_TO_IDS = {
    "Leonardo": ["MIA01"],
    "Bovisa": ["MIB01", "MIB02"],
    "La Masa": ["MIB01"],
}

# Descriptor substrings that mark a row as not representing regular
# classroom/building opening hours (libraries, sports facilities, generic
# vehicle/pedestrian access, special-purpose common spaces).
IGNORED_DESCRIPTOR_SUBSTRINGS = [
    "biblioteca",
    "archivi storici",
    "campo giuriati",
    "accesso carrario",
    "accesso pedonale",
    "patio",
    "agor",  # matches "Agorà"/"Agora"
]

BUILDING_ID_RE = re.compile(r"edificio\s+([a-z0-9]+)", re.IGNORECASE)
TIME_RANGE_RE = re.compile(r"^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$")

MONTHS_IT = {
    "gennaio": 1, "febbraio": 2, "marzo": 3, "aprile": 4,
    "maggio": 5, "giugno": 6, "luglio": 7, "agosto": 8,
    "settembre": 9, "ottobre": 10, "novembre": 11, "dicembre": 12,
}
_MONTH_NAMES = "|".join(MONTHS_IT)

CLOSURE_RANGE_CROSS_RE = re.compile(
    rf"dal (\d{{1,2}}) ({_MONTH_NAMES}) (\d{{4}}) al (\d{{1,2}}) ({_MONTH_NAMES}) (\d{{4}})",
    re.IGNORECASE,
)
CLOSURE_RANGE_SAME_MONTH_RE = re.compile(
    rf"dal (\d{{1,2}}) al (\d{{1,2}}) ({_MONTH_NAMES}) (\d{{4}})", re.IGNORECASE
)
CLOSURE_SINGLE_DAY_RE = re.compile(
    rf"\bil (\d{{1,2}}) ({_MONTH_NAMES}) (\d{{4}})\b", re.IGNORECASE
)

# Minimum sanity thresholds: below these, treat the parse as unreliable
# and refuse to overwrite the last known-good data/opening-hours.json.
MIN_BUILDINGS = 6
MIN_CAMPUS_DEFAULTS = 1
MIN_HOLIDAY_PERIODS = 1


class ScrapeError(Exception):
    pass


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------


def parse_hours_cell(text: str) -> list[str] | None:
    """Parse a single Mon-Fri/Sat/Sun cell into ['HH:MM', 'HH:MM'], or None if closed/unknown."""
    text = text.strip().lower()
    if not text or text == "chiuso":
        return None
    if text == "h24":
        return ["00:00", "23:59"]
    m = TIME_RANGE_RE.match(text)
    if not m:
        return None  # e.g. "consulta gli orari" — no usable data
    h1, m1, h2, m2 = m.groups()
    return [f"{int(h1):02d}:{m1}", f"{int(h2):02d}:{m2}"]


def is_ignored_descriptor(descriptor: str) -> bool:
    lowered = descriptor.lower()
    return any(s in lowered for s in IGNORED_DESCRIPTOR_SUBSTRINGS)


def parse_hours_table(table, buildings: dict, campus_defaults: dict) -> None:
    """Parse one campus hours table, filling `buildings` and `campus_defaults` in place."""
    rows = table.find_all("tr")[1:]  # skip header row
    for tr in rows:
        cells = [c.get_text(" ", strip=True) for c in tr.find_all(["td", "th"])]
        if len(cells) < 5:
            continue
        campus_label, descriptor, mon_fri_raw, sat_raw, sun_raw = cells[:5]

        if descriptor.strip() in ("Tutti", "Tutti gli altri spazi"):
            hours = parse_hours_cell(mon_fri_raw)
            if hours is None:
                continue
            campus_defaults[campus_label.strip()] = {
                "mon_fri": hours,
                "sat": parse_hours_cell(sat_raw),
                "sun": parse_hours_cell(sun_raw),
            }
            continue

        if is_ignored_descriptor(descriptor):
            continue

        match = BUILDING_ID_RE.search(descriptor)
        if not match:
            continue

        mon_fri = parse_hours_cell(mon_fri_raw)
        if mon_fri is None:
            continue  # not a real time range (e.g. "H24"/"consulta gli orari") — not classroom hours

        building_id = match.group(1).upper()
        buildings[building_id] = {
            "mon_fri": mon_fri,
            "sat": parse_hours_cell(sat_raw),
            "sun": parse_hours_cell(sun_raw),
        }


def parse_closure_sentence(sentence: str) -> list[dict]:
    """Parse the "l'Ateneo chiuderà... anche: ..." sentence into holiday_periods."""
    periods = []
    consumed_spans = []

    for m in CLOSURE_RANGE_CROSS_RE.finditer(sentence):
        d1, mo1, y1, d2, mo2, y2 = m.groups()
        start = date(int(y1), MONTHS_IT[mo1.lower()], int(d1))
        end = date(int(y2), MONTHS_IT[mo2.lower()], int(d2))
        periods.append({"start": start.isoformat(), "end": end.isoformat()})
        consumed_spans.append(m.span())

    def overlaps_consumed(span):
        return any(a <= span[0] < b or a < span[1] <= b for a, b in consumed_spans)

    for m in CLOSURE_RANGE_SAME_MONTH_RE.finditer(sentence):
        if overlaps_consumed(m.span()):
            continue
        d1, d2, mo, y = m.groups()
        month = MONTHS_IT[mo.lower()]
        start = date(int(y), month, int(d1))
        end = date(int(y), month, int(d2))
        periods.append({"start": start.isoformat(), "end": end.isoformat()})
        consumed_spans.append(m.span())

    for m in CLOSURE_SINGLE_DAY_RE.finditer(sentence):
        if overlaps_consumed(m.span()):
            continue
        d, mo, y = m.groups()
        day = date(int(y), MONTHS_IT[mo.lower()], int(d))
        periods.append({"start": day.isoformat(), "end": day.isoformat()})
        consumed_spans.append(m.span())

    return periods


def parse_page(html: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")

    buildings: dict = {}
    campus_defaults_by_label: dict = {}

    tables = soup.find_all("table")
    for table in tables:
        header_cells = [c.get_text(" ", strip=True) for c in table.find_all("tr")[0].find_all(["td", "th"])]
        if header_cells[:2] == ["Campus", "Edifici / spazi"] or header_cells[:2] == ["Campus", "Edifici/spazi"]:
            parse_hours_table(table, buildings, campus_defaults_by_label)

    campus_defaults: dict = {}
    for label, hours in campus_defaults_by_label.items():
        for campus_id in PAGE_CAMPUS_LABEL_TO_IDS.get(label, []):
            campus_defaults[campus_id] = hours

    text = soup.get_text(" ", strip=True)
    start = text.find("l'Ateneo chiuderà")
    if start == -1:
        raise ScrapeError("Could not find the closure announcement sentence on the page")
    end = text.find(".", start)
    sentence = text[start:end if end != -1 else start + 500]
    holiday_periods = parse_closure_sentence(sentence)

    return {
        "buildings": buildings,
        "campus_defaults": campus_defaults,
        "holiday_periods": holiday_periods,
    }


def validate(parsed: dict) -> None:
    if len(parsed["buildings"]) < MIN_BUILDINGS:
        raise ScrapeError(
            f"Only parsed {len(parsed['buildings'])} buildings, expected at least {MIN_BUILDINGS}. "
            "Page layout may have changed."
        )
    if len(parsed["campus_defaults"]) < MIN_CAMPUS_DEFAULTS:
        raise ScrapeError("Could not parse any campus-wide default hours ('Tutti' rows).")
    if len(parsed["holiday_periods"]) < MIN_HOLIDAY_PERIODS:
        raise ScrapeError("Could not parse any holiday closure periods.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    try:
        response = httpx.get(SOURCE_URL, timeout=REQUEST_TIMEOUT, follow_redirects=True)
        response.raise_for_status()
    except httpx.HTTPError as e:
        print(f"Failed to fetch {SOURCE_URL}: {e}", file=sys.stderr)
        return 1

    try:
        parsed = parse_page(response.text)
        validate(parsed)
    except ScrapeError as e:
        print(f"Scrape validation failed, leaving existing data/opening-hours.json untouched: {e}", file=sys.stderr)
        return 1

    output = {
        "generated_at": datetime.now().isoformat(),
        "source_url": SOURCE_URL,
        "holiday_periods": parsed["holiday_periods"],
        "buildings": parsed["buildings"],
        "campus_defaults": parsed["campus_defaults"],
        "default_hours": DEFAULT_HOURS,
    }

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"Written {len(parsed['buildings'])} buildings, "
          f"{len(parsed['campus_defaults'])} campus defaults, "
          f"{len(parsed['holiday_periods'])} holiday periods to {OUTPUT_FILE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
