import json
import time
import httpx
from datetime import date, timedelta, datetime
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

CLASSROOMS_FILE = Path(__file__).parent.parent / "data" / "classrooms.json"
OUTPUT_DIR = Path(__file__).parent.parent / "occupancy"
BASE_URL = "https://onlineservices.polimi.it/maps_rest/rest/ricerca/aula/occupazione"

# Retry settings
MAX_RETRIES = 3
RETRY_DELAY = 2  # seconds between retries

# Fetch settings
NEXT_DAYS_WINDOW = 7  # Number of days to fetch starting from today

# Days to skip entirely (0 = Monday, 6 = Sunday)
SKIP_WEEKDAYS = {6}  # PoliMi is mostly closed on Sundays anyway.

# Holiday periods: list of (start, end) tuples, both inclusive.
HOLIDAY_PERIODS: list[tuple[date, date]] = [
  (date(2025, 12, 24), date(2026, 1, 6)),   # Christmas Break
  (date(2025,  8,  1), date(2025, 8, 10)),  # Summer Break (lessons usually start in the 3rd week of September)
]

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def is_holiday(d: date) -> bool:
    """Return True if the date falls within any of the defined holiday periods."""
    return any(start <= d <= end for start, end in HOLIDAY_PERIODS)


def fetch_days() -> list[date]:
    """Return the next 7 days starting today, excluding skipped weekdays and holidays."""
    today = date.today()
    days = []
    for i in range(NEXT_DAYS_WINDOW + 1): # range(i) omits the last one
        d = today + timedelta(days=i)
        if d.weekday() not in SKIP_WEEKDAYS and not is_holiday(d):
            days.append(d)
    return days


def fetch_occupancy(client: httpx.Client, room_id: int, d: date) -> list[dict] | None:
    """Fetch occupancy for a single room on a single date. Returns None on failure."""
    url = f"{BASE_URL}/{room_id}/{d.strftime('%Y%m%d')}"    # date in YYYYMMDD format, e.g. 20260313 (March 13th, 2026)
    
    # Retry logic: try up to MAX_RETRIES times with a delay in between
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.get(url, timeout=10)
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, httpx.TimeoutException) as e:
            print(f"    Attempt {attempt}/{MAX_RETRIES} failed for room {room_id} on {d}: {e}")
            if attempt < MAX_RETRIES:
                # Wait before retrying
                time.sleep(RETRY_DELAY)
    print(f"    Skipping room {room_id} on {d} after {MAX_RETRIES} failed attempts.")
    return None # Failed to fetch even after MAX_RETRIES attempts


def build_output(campuses: list[dict], client: httpx.Client, d: date) -> dict:
    """Build the output JSON file, mirroring the classrooms structure, plus occupancy in each classroom."""
    result = []
    for campus in campuses:
        campus_out = {
            "name": campus["name"],
            "id": campus["id"],
            "buildings": []
        }
        for building in campus["buildings"]:
            building_out = {
                "name": building["name"],
                "classrooms": []
            }
            for classroom in building["classrooms"]:
                print(f"  Fetching room {classroom['name']} (id={classroom['id']})...")
                occupancy = fetch_occupancy(client, classroom["id"], d)   # API Call
                building_out["classrooms"].append({
                    "name": classroom["name"],
                    "id": classroom["id"],
                    "occupancy": occupancy if occupancy is not None else [] # If fetch failed, set occupancy to empty list
                })
            campus_out["buildings"].append(building_out)
        result.append(campus_out)
    
    # Wrap everything into a larger JSON object with some metadata
    return {
      "generated_at": datetime.now().isoformat(),
      "data": d.strftime("%Y%m%d"),
      "campuses": result
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    # Load classrooms
    with open(CLASSROOMS_FILE, encoding="utf-8") as f:
        campuses = json.load(f)

    # Determine days to fetch
    days = fetch_days()
    
    # If all next days are holidays or skipped weekdays, there's nothing to fetch, so we can exit early.
    if not days:
        print("No days to fetch (all within holiday periods or skipped weekdays). Exiting.")
        return

    print(f"Fetching occupancy for {len(days)} day(s): {[d.isoformat() for d in days]}")

    # Ensure output directory exists
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    with httpx.Client() as client:
        for d in days:
            print(f"\n--- {d.isoformat()} ---")

            # Build output for this day
            output = build_output(campuses, client, d)

            # Create output file and write JSON
            out_path = OUTPUT_DIR / f"occupation_{d.strftime('%Y%m%d')}.json"
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(output, f, ensure_ascii=False, indent=2)
            print(f"  Written to {out_path}")

    print("\nDone.")


if __name__ == "__main__":
    main()