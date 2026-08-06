"""
Scrapes onlineservices.polimi.it's per-day occupancy page to recover the
*names* of the courses/events occupying each classroom.

scripts/fetch.py's REST API (maps_rest/rest/ricerca/aula/occupazione) only
returns start/end times per slot, no course name. This page is server-side
rendered HTML with no backing JSON API, so we parse the table directly.

Page layout (as of writing): one <table class="scrollTable"> per campus,
made of repeating sections per building/floor. Each section has a header
row naming the building/floor, then one <tr class="normalRow"> per
classroom. Within a classroom row, every <td> after the "data"/"dove" pair
is a fixed-width grid cell, 15 minutes each, starting at 08:00, regardless
of whether it's class="slot" (occupied) or class="empty"/"empty_prima"
(free). Verified against the REST API's slot times for room 34
(idaula=34) on 2026-04-29: both agree to the minute.

The <a href="Aula.do?...&idaula=NNN"> in the "dove" cell carries the same
numeric id used as classroom "id" in data/classrooms.json, so results here
can be joined onto that file directly.

The "csic" query param is usually the same as classrooms.json's campus "id"
too, except Mantova (see CSIC_OVERRIDES below).
"""

import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path

import httpx
from bs4 import BeautifulSoup

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

CLASSROOMS_FILE = Path(__file__).parent.parent / "data" / "classrooms.json"
BASE_URL = "https://onlineservices.polimi.it/spazi/spazi/controller/OccupazioniGiornoEsatto.do"

# data/classrooms.json's campus "id" is normally also the "csic" query param this
# page expects, but Mantova is the one exception: classrooms.json uses "MNG01"
# while the site's own site-selector dropdown (spazi___..._sede) uses "MNI" for
# Mantova. "MNG01" 404s with "Non e' stata specificata nessuna ubicazione!".
CSIC_OVERRIDES = {
    "MNG01": "MNI",
}

REQUEST_TIMEOUT = 20  # seconds

MINUTES_PER_UNIT = 15
GRID_START_MINUTES = 8 * 60  # 08:00, verified against the REST API (see module docstring)

IDAULA_RE = re.compile(r"idaula=(\d+)")
IDRICHIESTA_RE = re.compile(r"idrichiesta=(\d+)")
DETTAGLI_PREFIX_RE = re.compile(r"^Vedi dettagli:\s*")
_HTML_TAG_RE = re.compile(r"<[^>]*>")

# Course names are formatted as "COURSE NAME CODE - PROF1, PROF2", but the
# dash before the professor(s) is inconsistently present, and integrated
# courses ("corsi integrati") have extra " - " separators inside the course
# name itself. The code is the only reliable anchor to split on.
COURSE_CODE_RE = re.compile(r"\d{5,6}")

# Some multi-section courses put a "Sez. A" (or "Sez. A I5 (1087)") token right
# after the code, comma-separated alongside the professors with no marker of
# its own, e.g. "057919 Sez. A,FAZZI ALBERTO,BORTOT DAVIDE". Pull it out
# rather than let it get parsed as a professor's name.
SECTION_RE = re.compile(r"^sez\.?\s*\S", re.IGNORECASE)

# During exam sessions, Polimi appends a trailing "(ESAME)", "(ORALI)", or
# "(ULTIMA PROVA IN ITINERE)" straight onto the last professor's name with no
# separator, e.g. "GATTO ALBERTO (ESAME)". Pull it out and use it to flag the
# whole entry as an exam rather than a lesson, instead of polluting the name.
EXAM_SUFFIX_RE = re.compile(r"\s*\(([^)]*)\)\s*$")
EXAM_KEYWORD_RE = re.compile(r"esame|orali?|prova in itinere", re.IGNORECASE)

# Below this many parsed classroom rows, treat the page as unrecognized
# (layout change, error page, empty campus) rather than trusting a near-empty result.
MIN_CLASSROOM_ROWS = 1


class ScrapeError(Exception):
    pass


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------


def _minutes_to_hhmm(minutes: int) -> str:
    h, m = divmod(minutes, 60)
    return f"{h:02d}:{m:02d}"


def parse_occupation_name(name: str) -> dict:
    """Split a scraped occupation name into course/code/professors.

    About 9% of names have no course code at all (events, tutoring sessions,
    maintenance blocks, ...); those are returned as category "OTHER" with the
    untouched string kept under "raw" rather than forced into a course/professor
    shape that doesn't apply. During exam periods, category is "EXAM" instead
    of "COURSE" for the same course/code/professors shape (see EXAM_KEYWORD_RE).
    """
    match = COURSE_CODE_RE.search(name)
    if not match:
        return {"category": "OTHER", "raw": name}

    course = name[:match.start()].strip()
    rest = name[match.end():].strip().lstrip("-").strip()
    tokens = [p.strip() for p in rest.split(",") if p.strip()]

    section = None
    if tokens and SECTION_RE.match(tokens[0]):
        section = tokens.pop(0)

    category = "COURSE"
    if tokens:
        exam_match = EXAM_SUFFIX_RE.search(tokens[-1])
        if exam_match and EXAM_KEYWORD_RE.search(exam_match.group(1)):
            tokens[-1] = EXAM_SUFFIX_RE.sub("", tokens[-1]).strip()
            category = "EXAM"

    result = {
        "category": category,
        "course": course,
        "code": int(match.group()),
        "professors": tokens,
    }
    if section:
        result["section"] = section
    return result


def _strip_tags(value: str) -> str:
    """Neutralize any embedded HTML in scraped text before it's stored, same as
    scripts/fetch.py's strip_tags() does for the REST API's responses."""
    return _HTML_TAG_RE.sub("", value)


def parse_classroom_row(row) -> tuple[int, list[dict]] | None:
    """Parse one <tr class="normalRow"> into (idaula, [occupation, ...])."""
    dove_link = row.find("td", class_="dove")
    if dove_link is None:
        return None
    link = dove_link.find("a", href=True)
    if link is None:
        return None
    id_match = IDAULA_RE.search(link["href"])
    if not id_match:
        return None
    idaula = int(id_match.group(1))

    occupations = []
    offset = 0
    for td in row.find_all("td"):
        classes = td.get("class") or []
        if "data" in classes or "dove" in classes:
            continue
        colspan = int(td.get("colspan", 1))
        if "slot" in classes:
            slot_link = td.find("a")
            title = slot_link.get("title", "").strip() if slot_link else ""
            name = (
                _strip_tags(DETTAGLI_PREFIX_RE.sub("", title))
                if title.startswith("Vedi dettagli:")
                else None
            )
            href = slot_link.get("href", "") if slot_link else ""
            richiesta_match = IDRICHIESTA_RE.search(href)
            occupations.append({
                "start": _minutes_to_hhmm(GRID_START_MINUTES + offset * MINUTES_PER_UNIT),
                "end": _minutes_to_hhmm(GRID_START_MINUTES + (offset + colspan) * MINUTES_PER_UNIT),
                "name": name,
                "idrichiesta": int(richiesta_match.group(1)) if richiesta_match else None,
            })
        offset += colspan

    return idaula, occupations


def parse_occupation_page(html: str) -> dict[int, list[dict]]:
    """Parse the full page into {idaula: [occupation, ...]}."""
    soup = BeautifulSoup(html, "html.parser")

    error_box = soup.find("div", class_="ErrorMessage")
    if error_box is not None:
        fragment = error_box.find("div", class_="jaf-message-fragment")
        message = fragment.get_text(strip=True) if fragment else "Unknown error"
        raise ScrapeError(message)

    result: dict[int, list[dict]] = {}
    for row in soup.find_all("tr", class_="normalRow"):
        parsed = parse_classroom_row(row)
        if parsed is None:
            continue
        idaula, occupations = parsed
        result[idaula] = occupations

    if len(result) < MIN_CLASSROOM_ROWS:
        raise ScrapeError(
            f"Parsed only {len(result)} classroom row(s); page layout may have changed."
        )
    return result


# ---------------------------------------------------------------------------
# Fetching
# ---------------------------------------------------------------------------


def fetch_occupation_names(client: httpx.Client, csic: str, d: date) -> dict[int, list[dict]]:
    """Fetch and parse the occupation-names page for one campus (csic) and date."""
    params = {
        "csic": CSIC_OVERRIDES.get(csic, csic),
        "categoria": "tutte",
        "tipologia": "tutte",
        "giorno_day": str(d.day),
        "giorno_month": str(d.month),
        "giorno_year": str(d.year),
        "jaf_giorno_date_format": "dd/MM/yyyy",
        "evn_visualizza": "",
    }
    response = client.get(BASE_URL, params=params, timeout=REQUEST_TIMEOUT)
    response.raise_for_status()
    return parse_occupation_page(response.text)


def all_campus_ids() -> list[str]:
    with open(CLASSROOMS_FILE, encoding="utf-8") as f:
        campuses = json.load(f)
    return [c["id"] for c in campuses if c.get("id")]


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--date", required=True, help="Date to fetch, YYYY-MM-DD")
    parser.add_argument(
        "--campus", action="append", dest="campuses",
        help="Campus id (csic), e.g. MIA01. Repeatable. Defaults to every campus in classrooms.json.",
    )
    args = parser.parse_args()

    d = date.fromisoformat(args.date)
    campuses = args.campuses or all_campus_ids()

    result: dict[str, dict[int, list[dict]]] = {}
    with httpx.Client() as client:
        for csic in campuses:
            print(f"Fetching {csic} on {d.isoformat()}...")
            try:
                result[csic] = fetch_occupation_names(client, csic, d)
            except (httpx.HTTPError, ScrapeError) as e:
                print(f"  Failed: {e}", file=sys.stderr)
                continue
            n_rooms = len(result[csic])
            n_slots = sum(len(v) for v in result[csic].values())
            print(f"  Parsed {n_rooms} classroom(s), {n_slots} occupied slot(s).")

    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
