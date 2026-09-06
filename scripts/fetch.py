import argparse
import json
import os
import re
import time
import traceback
import httpx
from datetime import date, timedelta, datetime, timezone
from pathlib import Path
from typing import cast

from fetch_occupation_names import (
    CSIC_OVERRIDES, ScrapeError, fetch_occupation_names, parse_occupation_name,
)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

CLASSROOMS_FILE = Path(__file__).parent.parent / "data" / "classrooms.json"
OPENING_HOURS_FILE = Path(__file__).parent.parent / "data" / "opening-hours.json"
OUTPUT_DIR = Path(__file__).parent.parent / "occupancy"
LOGS_DIR = Path(__file__).parent.parent / "logs"
RUN_LOG_FILE = LOGS_DIR / "run.json"        # structured summary of this run, uploaded to R2 by the workflow
PREVIOUS_LOG_FILE = LOGS_DIR / "previous.json"  # previous run's summary, downloaded from R2 by the workflow
LOG_KEY_PREFIX = "logs/occupancy"           # R2 key prefix; one object per run, keyed by UTC hour
BASE_URL = "https://onlineservices.polimi.it/maps_rest/rest/ricerca/aula/occupazione"

# Retry settings
MAX_RETRIES = 3
RETRY_DELAY = 2  # seconds between retries

# Fetch settings
NEXT_DAYS_WINDOW = 7  # Number of days to fetch starting from today
DELAY_BETWEEN_CALLS = 0.5  # seconds to wait between API calls

# The scraped page is known to omit a couple of classrooms that classrooms.json
# lists (as of writing: G.1 and G.2 in Leonardo building 11). Those fall back to
# the REST API silently; more than this many missing rows on a single page is
# instead reported as an anomaly, since it likely means the page changed shape.
MAX_EXPECTED_MISSING_ROWS = 5

# A page that parses fine but suddenly returns far fewer slots than the previous
# run did for the same date is suspicious too (partial page, silent layout
# change). Flag it when the count drops below this fraction of the previous
# value, but only if the previous value was big enough to be meaningful.
SLOT_DROP_RATIO = 0.5
SLOT_DROP_MIN_PREVIOUS = 20

# Polimi's WAF blocks the default httpx UA (and anything else that looks like
# a bare script client); a browser-like UA lets requests from CI runners through.
REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
}

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


def fetch_occupancy(
    client: httpx.Client, room_id: int, room_name: str, d: date, failures: list[dict]
) -> list[dict] | None:
    """Fetch occupancy for a single room on a single date. Returns None on failure.

    Appends a record to `failures` (room, date, error) if every retry attempt fails,
    so the caller can report a status summary (e.g. which rooms hit a 403) once the run ends.
    """
    url = f"{BASE_URL}/{room_id}/{d.strftime('%Y%m%d')}"  # date in YYYYMMDD format, e.g. 20260313 (March 13th, 2026)

    last_error = "unknown error"
    # Retry logic: try up to MAX_RETRIES times with a delay in between
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.get(url, timeout=10)
            response.raise_for_status()
            return cast("list[dict]", strip_tags(response.json()))
        except httpx.HTTPStatusError as e:
            last_error = f"HTTP {e.response.status_code}"
            print(
                f"    Attempt {attempt}/{MAX_RETRIES} failed for room {room_id} on {d}: {e}"
            )
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY)
        except (httpx.HTTPError, httpx.TimeoutException) as e:
            last_error = type(e).__name__
            print(
                f"    Attempt {attempt}/{MAX_RETRIES} failed for room {room_id} on {d}: {e}"
            )
            if attempt < MAX_RETRIES:
                # Wait before retrying
                time.sleep(RETRY_DELAY)
    print(f"    Skipping room {room_id} on {d} after {MAX_RETRIES} failed attempts.")
    failures.append({"room": room_name, "id": room_id, "date": d.isoformat(), "error": last_error})
    return None  # Failed to fetch even after MAX_RETRIES attempts


def _pick(src: dict, *keys: str) -> dict:
    """Return a dict with only the given keys that are present and non-None in src."""
    return {k: src[k] for k in keys if src.get(k) is not None}


def _resolved_csic(campus: dict) -> str | None:
    """The scraped page's csic for a classrooms.json campus (its Sede umbrella value).

    Several campuses share one page: Leonardo and Colombo both resolve to "MIA",
    La Masa and Durando to "MIB". A failure on that page therefore affects every
    classroom of every campus that resolves to it.
    """
    csic = campus.get("id")
    return CSIC_OVERRIDES.get(csic, csic) if csic else None


def scrape_day(
    campuses: list[dict], client: httpx.Client, d: date, no_delay: bool
) -> tuple[dict[str, dict[int, list[dict]]], dict[str, str]]:
    """Scrape onlineservices.polimi.it's per-day occupancy page once per Sede.

    Returns ({resolved_csic: {idaula: [occupation, ...]}}, {resolved_csic: error}).
    A page that fails after MAX_RETRIES attempts (network error, HTTP error,
    unrecognized layout) is recorded in the second dict so the caller can fall
    back to the REST API for every classroom on that page.
    """
    pages: dict[str, dict[int, list[dict]]] = {}
    errors: dict[str, str] = {}
    for campus in campuses:
        csic = campus.get("id")
        resolved = _resolved_csic(campus)
        if not csic or resolved is None or resolved in pages or resolved in errors:
            continue
        last_error = "unknown error"
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                pages[resolved] = fetch_occupation_names(client, csic, d)
                break
            except httpx.HTTPStatusError as e:
                last_error = f"HTTP {e.response.status_code}"
            except (httpx.HTTPError, httpx.TimeoutException) as e:
                last_error = type(e).__name__
            except ScrapeError as e:
                last_error = f"ScrapeError: {e}"
            except Exception as e:  # unversioned HTML: anything can go wrong while parsing
                last_error = f"{type(e).__name__}: {e}"
            print(f"    Attempt {attempt}/{MAX_RETRIES} failed for page {resolved} on {d}: {last_error}")
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY)
        else:
            print(f"    Page {resolved} on {d} failed after {MAX_RETRIES} attempts; "
                  f"its classrooms will use the REST API.")
            errors[resolved] = last_error
        if not no_delay:
            time.sleep(DELAY_BETWEEN_CALLS)
    return pages, errors


def scraped_to_slots(occupations: list[dict]) -> list[dict]:
    """Convert scraped occupations into the output slot shape (inizio/fine + name fields)."""
    slots = []
    for o in occupations:
        slot: dict = {"inizio": o["start"], "fine": o["end"]}
        if o.get("name"):
            slot.update(parse_occupation_name(o["name"]))
        if o.get("idrichiesta"):
            slot["idrichiesta"] = o["idrichiesta"]
        slots.append(slot)
    return slots


def build_output(
    campuses: list[dict], client: httpx.Client, d: date, no_delay: bool,
    pages: dict[str, dict[int, list[dict]]], page_errors: dict[str, str],
    failures: list[dict], missing_rows: list[dict],
) -> tuple[dict, int]:
    """Build the output JSON file, mirroring the classrooms structure, plus occupancy in each classroom.
    Returns (output, number of REST API calls made).

    Occupancy comes from the scraped page for the classroom's Sede. The REST API
    is only called for classrooms whose page failed to scrape (see scrape_day)
    or that have no row on an otherwise healthy page.
    """
    result = []
    rest_calls = 0
    for campus in campuses:
        campus_out = {**_pick(campus, "name", "id", "lat", "long"), "buildings": []}
        resolved = _resolved_csic(campus)
        page = pages.get(resolved) if resolved else None
        page_failed = page is None
        if page_failed:
            print(f"  Campus {campus.get('name')} ({resolved}): page unavailable, using REST API for every room.")

        for building in campus["buildings"]:
            building_out = {
                **_pick(building, "name", "altName", "lat", "long", "idEdificio", "address"),
                "classrooms": [],
            }
            for classroom in building["classrooms"]:
                room_id, room_name = classroom["id"], classroom["name"]
                scraped = None if page_failed else page.get(room_id)

                if scraped is not None:
                    occupancy = scraped_to_slots(scraped)
                else:
                    if not page_failed:
                        missing_rows.append({
                            "room": room_name, "id": room_id, "date": d.isoformat(), "page": resolved,
                        })
                    print(f"  Fetching room {room_name} (id={room_id}) via REST API...")
                    rest_calls += 1
                    occupancy = fetch_occupancy(client, room_id, room_name, d, failures) or []
                    if not no_delay:
                        time.sleep(DELAY_BETWEEN_CALLS)

                building_out["classrooms"].append(
                    {
                        **_pick(classroom, "name", "id", "features",
                                "idfoto", "seats", "accessible_seats", "workstations"),
                        "occupancy": occupancy,
                    }
                )
            campus_out["buildings"].append(building_out)
        result.append(campus_out)

    # Wrap everything into a larger JSON object with some metadata
    return {
        "generated_at": datetime.now().isoformat(),
        "date": d.strftime("%Y%m%d"),
        "campuses": result,
    }, rest_calls


def load_previous_log() -> dict | None:
    """Load the previous run's summary (downloaded from R2 by the workflow), if any."""
    if not PREVIOUS_LOG_FILE.exists():
        return None
    try:
        with open(PREVIOUS_LOG_FILE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError) as e:
        print(f"  Warning: could not read {PREVIOUS_LOG_FILE}: {e}")
        return None


def page_stats(pages: dict[str, dict[int, list[dict]]], errors: dict[str, str]) -> dict[str, dict]:
    """Per-page row/slot counts for the run log."""
    stats = {
        csic: {"rows": len(rooms), "slots": sum(len(v) for v in rooms.values()), "error": None}
        for csic, rooms in pages.items()
    }
    for csic, err in errors.items():
        stats[csic] = {"rows": 0, "slots": 0, "error": err}
    return stats


def detect_slot_drops(d: date, stats: dict[str, dict], previous: dict | None) -> list[dict]:
    """Compare this run's per-page slot counts for `d` against the previous run's."""
    if not previous:
        return []
    prev_pages = previous.get("days", {}).get(d.isoformat(), {}).get("pages", {})
    drops = []
    for csic, cur in stats.items():
        prev = prev_pages.get(csic)
        if cur["error"] or not prev or prev.get("error"):
            continue
        if prev["slots"] >= SLOT_DROP_MIN_PREVIOUS and cur["slots"] < prev["slots"] * SLOT_DROP_RATIO:
            drops.append({"page": csic, "date": d.isoformat(), "previous": prev["slots"], "current": cur["slots"]})
    return drops


def write_run_log(log: dict) -> None:
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    with open(RUN_LOG_FILE, "w", encoding="utf-8") as f:
        json.dump(log, f, ensure_ascii=False, indent=2)
    print(f"Run log written to {RUN_LOG_FILE} (R2 key: {log['log_key']})")


def write_github_output(status: str, message: str):
    """Append a `status` and multi-line `message` output for the GitHub Actions step, if running in CI."""
    output_path = os.environ.get("GITHUB_OUTPUT")
    if not output_path:
        return
    delimiter = "FETCH_MESSAGE_EOF"
    with open(output_path, "a", encoding="utf-8") as f:
        f.write(f"status={status}\n")
        f.write(f"message<<{delimiter}\n{message}\n{delimiter}\n")


def summarize(
    days: list[date], page_errors: list[dict], failures: list[dict], missing_rows: list[dict],
    slot_drops: list[dict],
) -> tuple[str, str]:
    """Build a (status, message) pair describing the run, for the Telegram notification step.

    Status is "failed" (Telegram shows a warning) on any anomaly: a scraped page
    that errored (possible redesign of the page), a REST fallback call that
    failed, or more classrooms missing from a healthy page than expected. The
    two classrooms the page is known to omit are listed but don't by themselves
    trip the alert.
    """
    lines = [f"{len(days)} day(s) fetched: {', '.join(d.isoformat() for d in days)}."]
    anomaly = False

    if page_errors:
        anomaly = True
        lines.append(f"{len(page_errors)} scrape page(s) failed (REST fallback used):")
        for e in page_errors:
            lines.append(f"- {e['page']} on {e['date']}: {e['error']}")

    if slot_drops:
        anomaly = True
        lines.append(f"{len(slot_drops)} page(s) returned far fewer slots than the previous run:")
        for s in slot_drops:
            lines.append(f"- {s['page']} on {s['date']}: {s['previous']} -> {s['current']}")

    if missing_rows:
        per_page_day: dict[tuple[str, str], list[dict]] = {}
        for m in missing_rows:
            per_page_day.setdefault((m["page"], m["date"]), []).append(m)
        worst = max(len(v) for v in per_page_day.values())
        if worst > MAX_EXPECTED_MISSING_ROWS:
            anomaly = True
            lines.append(
                f"Up to {worst} classrooms missing from a single healthy page "
                f"(expected at most {MAX_EXPECTED_MISSING_ROWS}); page layout may have changed."
            )
        rooms = sorted({f"{m['room']} (id={m['id']})" for m in missing_rows})
        lines.append(f"{len(rooms)} classroom(s) not on the page, fetched via REST: "
                     + ", ".join(rooms[:10]) + (" ..." if len(rooms) > 10 else ""))

    if failures:
        anomaly = True
        by_error: dict[str, list[dict]] = {}
        for f in failures:
            by_error.setdefault(f["error"], []).append(f)
        lines.append(f"{len(failures)} REST fallback fetch(es) failed after {MAX_RETRIES} attempts:")
        for error, group in sorted(by_error.items(), key=lambda kv: -len(kv[1])):
            lines.append(f"- {error}: {len(group)} room(s)")
            for f in group[:10]:
                lines.append(f"    {f['room']} (id={f['id']}) on {f['date']}")
            if len(group) > 10:
                lines.append(f"    ...and {len(group) - 10} more")

    return ("failed" if anomaly else "ok"), "\n".join(lines)


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

    started = datetime.now(timezone.utc)
    log: dict = {
        "started_at": started.isoformat(timespec="seconds"),
        "log_key": f"{LOG_KEY_PREFIX}/{started.strftime('%Y/%m/%d/%H')}.json",
        "no_delay": args.no_delay,
        "status": "crashed",  # overwritten on a normal exit
        "days": {},
    }
    try:
        run(args, log)
    except BaseException as e:
        log["error"] = "".join(traceback.format_exception(e)).strip()
        log["message"] = f"Crashed: {type(e).__name__}: {e}"
        raise
    finally:
        finished = datetime.now(timezone.utc)
        log["finished_at"] = finished.isoformat(timespec="seconds")
        log["duration_seconds"] = round((finished - started).total_seconds(), 1)
        write_run_log(log)


def run(args, log: dict) -> None:
    # Load classrooms
    with open(CLASSROOMS_FILE, encoding="utf-8") as f:
        campuses = json.load(f)

    # Load opening hours (scraped periodically by scripts/fetch_opening_hours.py)
    opening_hours = load_opening_hours()

    # Previous run's summary, for the slot-count sanity check
    previous = load_previous_log()
    log["previous_run"] = previous.get("started_at") if previous else None

    # Determine days to fetch
    days = fetch_days(campuses, opening_hours)

    # If all next days are holidays or skipped weekdays, there's nothing to fetch, so we can exit early.
    if not days:
        print(
            "No days to fetch (all within holiday periods or skipped weekdays). Exiting."
        )
        log["status"], log["message"] = "ok", "No days to fetch (all within holiday periods or skipped weekdays)."
        write_github_output(log["status"], log["message"])
        return

    print(f"Fetching occupancy for {len(days)} day(s): {[d.isoformat() for d in days]}")

    # Ensure output directory exists
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Delete occupation files from previous days
    print("\nCleaning up stale files...")
    cleanup_old_files()

    failures: list[dict] = []
    page_errors: list[dict] = []
    missing_rows: list[dict] = []
    slot_drops: list[dict] = []
    with httpx.Client(headers=REQUEST_HEADERS) as client:
        for d in days:
            print(f"\n--- {d.isoformat()} ---")

            # Scrape the day's occupancy, one page per Sede (a few seconds in total)
            print("  Scraping occupancy pages...")
            pages, errors = scrape_day(campuses, client, d, args.no_delay)
            page_errors.extend({"page": p, "date": d.isoformat(), "error": e} for p, e in errors.items())
            stats = page_stats(pages, errors)
            slot_drops.extend(detect_slot_drops(d, stats, previous))

            # Build output for this day, falling back to the REST API where the scrape can't help
            output, rest_calls = build_output(
                campuses, client, d, args.no_delay, pages, errors, failures, missing_rows
            )
            log["days"][d.isoformat()] = {
                "pages": stats,
                "slots_total": sum(s["slots"] for s in stats.values()),
                "rest_calls": rest_calls,
            }

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

    status, message = summarize(days, page_errors, failures, missing_rows, slot_drops)
    write_github_output(status, message)
    log.update({
        "status": status,
        "message": message,
        "page_errors": page_errors,
        "missing_rows": missing_rows,
        "rest_failures": failures,
        "slot_drops": slot_drops,
    })

    print("\nDone.")


if __name__ == "__main__":
    main()
