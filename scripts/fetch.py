import argparse
import json
import re
import time
import httpx
from datetime import date, timedelta, datetime
from pathlib import Path
from typing import cast

from fetch_occupation_names import fetch_occupation_names

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

CLASSROOMS_FILE = Path(__file__).parent.parent / "data" / "classrooms.json"
OPENING_HOURS_FILE = Path(__file__).parent.parent / "data" / "opening-hours.json"
OUTPUT_DIR = Path(__file__).parent.parent / "occupancy"
BASE_URL = "https://onlineservices.polimi.it/maps_rest/rest/ricerca/aula/occupazione"

# Retry settings
MAX_RETRIES = 3
RETRY_DELAY = 2  # seconds between retries

# Fetch settings
NEXT_DAYS_WINDOW = 7  # Number of days to fetch starting from today
DELAY_BETWEEN_CALLS = 0.5  # seconds to wait between API calls

# Emergency fallback used only if data/opening-hours.json doesn't exist yet
# (e.g. before scripts/fetch_opening_hours.py has ever run). Mirrors the
# app's old hardcoded assumption: every building open every day except Sunday.
FALLBACK_HOLIDAY_PERIODS: list[tuple[date, date]] = [
    (date(2025, 12, 24), date(2026, 1, 6)),  # Christmas Break
    (date(2025, 8, 1), date(2025, 8, 10)),  # Summer Break
]
FALLBACK_DEFAULT_HOURS = {"mon_fri": ["00:00", "23:59"], "sat": ["00:00", "23:59"], "sun": None}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


_HTML_TAG_RE = re.compile(r'<[^>]*>')

def strip_tags(value: object) -> object:
    """
    Recursively walk a parsed JSON value and strip HTML tags from every string.

    We serve the occupancy JSON files as a public API consumed by third parties.
    If the upstream Polimi API were ever compromised, it could embed HTML/script
    tags in field values (classroom names, building names, etc.). Third-party
    consumers who render those strings without escaping would be vulnerable to
    XSS. Stripping tags here, at the ingestion boundary, neutralises the
    payload before it reaches anyone downstream, without breaking our own
    frontend (which still applies escapeHtml() at render time).

    Only angle-bracket tags are stripped; the rest of the string is preserved,
    so legitimate data is unaffected (building names never contain '<' or '>').
    """
    if isinstance(value, str):
        return _HTML_TAG_RE.sub('', value)
    if isinstance(value, list):
        return [strip_tags(item) for item in value]
    if isinstance(value, dict):
        return {k: strip_tags(v) for k, v in value.items()}
    return value


# Matches the leading building-number token of a classrooms.json building
# name, e.g. "21" -> "21", "16B" -> "16B", "32.1" -> "32" (sub-room suffixes
# after a '.' are dropped since scripts/fetch_opening_hours.py keys its
# `buildings` dict by the bare "Edificio N" number, not the sub-room code).
_BUILDING_ID_RE = re.compile(r"([a-z]*\d+[a-z]?)", re.IGNORECASE)


def load_opening_hours() -> dict:
    """Load data/opening-hours.json, or an emergency fallback if it doesn't exist yet."""
    if OPENING_HOURS_FILE.exists():
        with open(OPENING_HOURS_FILE, encoding="utf-8") as f:
            return json.load(f)
    print(f"  Warning: {OPENING_HOURS_FILE} not found, using hardcoded fallback hours.")
    return {
        "holiday_periods": [
            {"start": start.isoformat(), "end": end.isoformat()}
            for start, end in FALLBACK_HOLIDAY_PERIODS
        ],
        "buildings": {},
        "campus_defaults": {},
        "default_hours": FALLBACK_DEFAULT_HOURS,
    }


def _building_hours_key(building: dict) -> str:
    """Extract the identifier used to key opening_hours['buildings'] from a classrooms.json building entry."""
    name = str(building.get("name", ""))
    match = _BUILDING_ID_RE.match(name)
    return (match.group(1) if match else name).upper()


def resolve_building_hours(building: dict, campus_id: str, opening_hours: dict) -> dict:
    """Resolve a building's opening hours: explicit match > campus default > global default."""
    key = _building_hours_key(building)
    if key in opening_hours["buildings"]:
        return opening_hours["buildings"][key]
    if campus_id in opening_hours["campus_defaults"]:
        return opening_hours["campus_defaults"][campus_id]
    return opening_hours["default_hours"]


def is_closed_on_weekday(hours: dict, weekday: int) -> bool:
    """weekday follows date.weekday(): 0 = Monday ... 6 = Sunday."""
    if weekday == 5:
        return hours["sat"] is None
    if weekday == 6:
        return hours["sun"] is None
    return hours["mon_fri"] is None


def is_holiday(d: date, opening_hours: dict) -> bool:
    """Return True if the date falls within any of the defined holiday periods."""
    return any(
        date.fromisoformat(p["start"]) <= d <= date.fromisoformat(p["end"])
        for p in opening_hours["holiday_periods"]
    )


def all_buildings_closed(campuses: list[dict], opening_hours: dict, weekday: int) -> bool:
    """Return True if every building across every campus is closed on the given weekday."""
    for campus in campuses:
        campus_id = cast(str, campus.get("id"))
        for building in campus["buildings"]:
            hours = resolve_building_hours(building, campus_id, opening_hours)
            if not is_closed_on_weekday(hours, weekday):
                return False
    return True


def fetch_days(campuses: list[dict], opening_hours: dict) -> list[date]:
    """Return the next 7 days starting today, excluding holidays and days every building is closed.

    A day is only skipped entirely when *every* building is closed, not just
    because it's Sunday. BL27 is open every day of the week, so a blanket
    day-of-week skip would silently miss real occupancy data.
    """
    today = date.today()
    days = []
    i = 0
    while len(days) < NEXT_DAYS_WINDOW:
        d = today + timedelta(days=i)
        if is_holiday(d, opening_hours):
            break  # If we hit a holiday, we stop fetching further days, as they are likely to be holidays too.
        if not all_buildings_closed(campuses, opening_hours, d.weekday()):
            days.append(d)
        i += 1
    return days


def fetch_occupancy(client: httpx.Client, room_id: int, d: date) -> list[dict] | None:
    """Fetch occupancy for a single room on a single date. Returns None on failure."""
    url = f"{BASE_URL}/{room_id}/{d.strftime('%Y%m%d')}"  # date in YYYYMMDD format, e.g. 20260313 (March 13th, 2026)

    # Retry logic: try up to MAX_RETRIES times with a delay in between
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.get(url, timeout=10)
            response.raise_for_status()
            return cast("list[dict]", strip_tags(response.json()))
        except (httpx.HTTPError, httpx.TimeoutException) as e:
            print(
                f"    Attempt {attempt}/{MAX_RETRIES} failed for room {room_id} on {d}: {e}"
            )
            if attempt < MAX_RETRIES:
                # Wait before retrying
                time.sleep(RETRY_DELAY)
    print(f"    Skipping room {room_id} on {d} after {MAX_RETRIES} failed attempts.")
    return None  # Failed to fetch even after MAX_RETRIES attempts


def _pick(src: dict, *keys: str) -> dict:
    """Return a dict with only the given keys that are present and non-None in src."""
    return {k: src[k] for k in keys if src.get(k) is not None}


def build_name_lookup(campuses: list[dict], client: httpx.Client, d: date, no_delay: bool) -> dict:
    """Scrape onlineservices.polimi.it's occupation-names page for every campus (one
    request each, not per-room) and return {idaula: {(inizio, fine): {"name", "idrichiesta"}}}.

    Best-effort: a campus that fails to scrape (network error, a campus this
    endpoint doesn't cover at all e.g. Mantova, or the page layout changing in a
    way the parser doesn't expect) is skipped with a warning. Catches broadly
    (not just httpx.HTTPError/ScrapeError) since this scraper is built against
    unversioned HTML that Polimi could change at any time; no-name occupations
    are preferable to crashing the whole fetch run over it.
    """
    lookup: dict[int, dict[tuple[str, str], dict]] = {}
    for campus in campuses:
        csic = campus.get("id")
        if not csic:
            continue
        try:
            per_room = fetch_occupation_names(client, csic, d)
        except Exception as e:
            print(f"  Warning: name scrape failed for {csic}: {e}")
            continue
        for idaula, occupations in per_room.items():
            lookup[idaula] = {(o["start"], o["end"]): o for o in occupations}
        if not no_delay:
            time.sleep(DELAY_BETWEEN_CALLS)
    return lookup


def build_output(
    campuses: list[dict], client: httpx.Client, d: date, no_delay: bool, name_lookup: dict
) -> dict:
    """Build the output JSON file, mirroring the classrooms structure, plus occupancy in each classroom."""
    result = []
    for campus in campuses:
        campus_out = {**_pick(campus, "name", "id", "lat", "long"), "buildings": []}
        for building in campus["buildings"]:
            building_out = {
                **_pick(building, "name", "altName", "lat", "long", "idEdificio", "address"),
                "classrooms": [],
            }
            for classroom in building["classrooms"]:
                print(f"  Fetching room {classroom['name']} (id={classroom['id']})...")
                occupancy = fetch_occupancy(client, classroom["id"], d)  # API Call

                # Enrich each slot with the course name/idrichiesta scraped above, when available.
                room_names = name_lookup.get(classroom["id"], {})
                for slot in occupancy or []:
                    match = room_names.get((slot.get("inizio"), slot.get("fine")))
                    if match:
                        if match["name"]:
                            slot["name"] = match["name"]
                        if match["idrichiesta"]:
                            slot["idrichiesta"] = match["idrichiesta"]

                building_out["classrooms"].append(
                    {
                        **_pick(classroom, "name", "id", "features",
                                "idfoto", "seats", "accessible_seats", "workstations"),
                        "occupancy": occupancy if occupancy is not None else [],
                    }
                )

                # Wait before the next API call to avoid overwhelming the server
                if not no_delay:
                    time.sleep(DELAY_BETWEEN_CALLS)

            campus_out["buildings"].append(building_out)
        result.append(campus_out)

    # Wrap everything into a larger JSON object with some metadata
    return {
        "generated_at": datetime.now().isoformat(),
        "date": d.strftime("%Y%m%d"),
        "campuses": result,
    }


def cleanup_old_files():
    """Delete occupation files whose date is before today."""
    today = date.today()
    for f in OUTPUT_DIR.glob("occupation_*.json"):
        # Parse the date from the filename, e.g. occupation_20260313.json -> 20260313
        try:
            date_str = f.stem.replace("occupation_", "")  # e.g. "20260313"
            file_date = datetime.strptime(date_str, "%Y%m%d").date()
        except ValueError:
            continue  # Skip files that don't match the expected format
        if file_date < today:
            f.unlink()
            print(f"  Deleted stale file: {f.name}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-delay", action="store_true", help="Skip delay between API calls")
    args = parser.parse_args()
    
    # Load classrooms
    with open(CLASSROOMS_FILE, encoding="utf-8") as f:
        campuses = json.load(f)

    # Load opening hours (scraped periodically by scripts/fetch_opening_hours.py)
    opening_hours = load_opening_hours()

    # Determine days to fetch
    days = fetch_days(campuses, opening_hours)

    # If all next days are holidays or skipped weekdays, there's nothing to fetch, so we can exit early.
    if not days:
        print(
            "No days to fetch (all within holiday periods or skipped weekdays). Exiting."
        )
        return

    print(f"Fetching occupancy for {len(days)} day(s): {[d.isoformat() for d in days]}")

    # Ensure output directory exists
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Delete occupation files from previous days
    print("\nCleaning up stale files...")
    cleanup_old_files()

    with httpx.Client() as client:
        for d in days:
            print(f"\n--- {d.isoformat()} ---")

            # Scrape course names for the day first (cheap, one request per campus)
            print("  Scraping occupation names...")
            name_lookup = build_name_lookup(campuses, client, d, args.no_delay)

            # Build output for this day
            output = build_output(campuses, client, d, args.no_delay, name_lookup)

            # Create output file and write JSON
            out_path = OUTPUT_DIR / f"occupation_{d.strftime('%Y%m%d')}.json"
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(output, f, ensure_ascii=False, indent=2)
            print(f"  Written to {out_path}")

    # Write the list of available dates
    list_path = OUTPUT_DIR / "list.json"
    with open(list_path, "w", encoding="utf-8") as f:
        json.dump({
            "generated_at": datetime.now().isoformat(),
            "dates": [d.strftime("%Y%m%d") for d in days],
        }, f, ensure_ascii=False, indent=2)
    print(f"\nWritten date list to {list_path}")

    print("\nDone.")


if __name__ == "__main__":
    main()
