"""
Experiment: how well does the onlineservices.polimi.it scrape
(scripts/fetch_occupation_names.py) reproduce the occupancy currently served
by the live PoliAule API (which was built from the maps_rest REST API)?

For every date listed by GET /v1/occupations (or a single --date), this script:
  1. downloads GET /v1/occupations/<date> from the live API (no PoliMi REST
     calls are made; the API's data is assumed fresh),
  2. runs the scraper once per campus (one page per Sede),
  3. diffs the two per classroom, slot by slot.

Slots are keyed by (classroom id, start, end). Unmatched slots in the same
room that overlap in time are paired up as "different" (boundary mismatch);
what remains is "API only" or "scrape only". Classrooms the scrape returns
that aren't in data/classrooms.json are listed separately: the API can't
know about them, so they're informational, not mismatches.

Usage:
    python scripts/compare_scrape_vs_api.py                 # every date the API has
    python scripts/compare_scrape_vs_api.py --date 2026-09-08
    python scripts/compare_scrape_vs_api.py --json report.json --quiet
"""

import argparse
import json
import sys
import time
from collections import Counter
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).parent))
from fetch import REQUEST_HEADERS, DELAY_BETWEEN_CALLS  # noqa: E402
from fetch_occupation_names import (  # noqa: E402
    CSIC_OVERRIDES, GRID_START_MINUTES, MINUTES_PER_UNIT, fetch_occupation_names,
)

CLASSROOMS_FILE = Path(__file__).parent.parent / "data" / "classrooms.json"
DEFAULT_API_BASE = "https://api.poliaule.com"


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Slot:
    room_id: int
    start: str  # "HH:MM"
    end: str    # "HH:MM"

    @property
    def start_min(self) -> int:
        h, m = self.start.split(":")
        return int(h) * 60 + int(m)

    @property
    def end_min(self) -> int:
        h, m = self.end.split(":")
        return int(h) * 60 + int(m)

    def overlaps(self, other: "Slot") -> bool:
        return self.start_min < other.end_min and other.start_min < self.end_min

    def label(self) -> str:
        return f"{self.start}-{self.end}"


@dataclass
class RoomInfo:
    name: str
    building: str
    campus: str

    def label(self, room_id: int) -> str:
        return f"{self.campus} / {self.building} / {self.name} (id={room_id})"


@dataclass
class DayResult:
    day: date
    api_slots: set[Slot] = field(default_factory=set)
    scrape_slots: set[Slot] = field(default_factory=set)
    matched: set[Slot] = field(default_factory=set)
    different: list[tuple[Slot, Slot]] = field(default_factory=list)  # (api, scrape)
    api_only: list[Slot] = field(default_factory=list)
    scrape_only: list[Slot] = field(default_factory=list)
    unknown_rooms: dict[int, int] = field(default_factory=dict)  # idaula -> slot count
    scrape_failures: dict[str, str] = field(default_factory=dict)  # csic -> error
    api_rooms_missing_from_scrape: list[int] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------


def load_rooms() -> tuple[dict[int, RoomInfo], list[str]]:
    with open(CLASSROOMS_FILE, encoding="utf-8") as f:
        campuses = json.load(f)
    rooms: dict[int, RoomInfo] = {}
    campus_ids: list[str] = []
    for campus in campuses:
        if campus.get("id"):
            campus_ids.append(campus["id"])
        for building in campus["buildings"]:
            for room in building["classrooms"]:
                rooms[room["id"]] = RoomInfo(room["name"], building["name"], campus["name"])
    return rooms, campus_ids


def api_dates(client: httpx.Client, api_base: str) -> list[date]:
    r = client.get(f"{api_base}/v1/occupations", timeout=20)
    r.raise_for_status()
    return [date(int(s[:4]), int(s[4:6]), int(s[6:8])) for s in r.json()["dates"]]


def api_slots_for_day(client: httpx.Client, api_base: str, d: date) -> tuple[set[Slot], set[int], str]:
    """Return (slots, room ids present in the file, generated_at)."""
    r = client.get(f"{api_base}/v1/occupations/{d.isoformat()}", timeout=30)
    r.raise_for_status()
    payload = r.json()
    slots: set[Slot] = set()
    room_ids: set[int] = set()
    for campus in payload["campuses"]:
        for building in campus["buildings"]:
            for room in building["classrooms"]:
                room_ids.add(room["id"])
                for occ in room.get("occupancy", []):
                    slots.add(Slot(room["id"], occ["inizio"], occ["fine"]))
    return slots, room_ids, payload.get("generated_at", "?")


def scrape_slots_for_day(
    client: httpx.Client, campus_ids: list[str], d: date, no_delay: bool
) -> tuple[dict[int, set[Slot]], dict[str, str]]:
    """Run the scraper once per distinct Sede. Returns ({idaula: slots}, {csic: error})."""
    per_room: dict[int, set[Slot]] = {}
    failures: dict[str, str] = {}
    seen: set[str] = set()
    for csic in campus_ids:
        resolved = CSIC_OVERRIDES.get(csic, csic)
        if resolved in seen:
            continue
        seen.add(resolved)
        try:
            page = fetch_occupation_names(client, csic, d)
        except Exception as e:  # scraper is best-effort by design, see fetch.py
            failures[resolved] = f"{type(e).__name__}: {e}"
            continue
        for idaula, occupations in page.items():
            per_room.setdefault(idaula, set()).update(
                Slot(idaula, o["start"], o["end"]) for o in occupations
            )
        if not no_delay:
            time.sleep(DELAY_BETWEEN_CALLS)
    return per_room, failures


# ---------------------------------------------------------------------------
# Comparison
# ---------------------------------------------------------------------------


def compare_day(
    d: date,
    api_slots: set[Slot],
    api_room_ids: set[int],
    scraped: dict[int, set[Slot]],
    scrape_failures: dict[str, str],
    known_rooms: dict[int, RoomInfo],
) -> DayResult:
    res = DayResult(day=d, api_slots=api_slots, scrape_failures=scrape_failures)

    # Split scraped rooms into ones we know about and ones we don't.
    for idaula, slots in scraped.items():
        if idaula in known_rooms:
            res.scrape_slots |= slots
        else:
            res.unknown_rooms[idaula] = len(slots)

    res.matched = api_slots & res.scrape_slots
    api_left = api_slots - res.matched
    scrape_left = res.scrape_slots - res.matched

    # Pair up overlapping leftovers in the same room as "different".
    by_room_scrape: dict[int, list[Slot]] = {}
    for s in scrape_left:
        by_room_scrape.setdefault(s.room_id, []).append(s)
    consumed: set[Slot] = set()
    for a in sorted(api_left, key=lambda s: (s.room_id, s.start_min)):
        candidates = [s for s in by_room_scrape.get(a.room_id, []) if s not in consumed and s.overlaps(a)]
        if candidates:
            # Prefer the candidate with the largest overlap.
            best = max(candidates, key=lambda s: min(s.end_min, a.end_min) - max(s.start_min, a.start_min))
            consumed.add(best)
            res.different.append((a, best))
        else:
            res.api_only.append(a)
    res.scrape_only = sorted(scrape_left - consumed, key=lambda s: (s.room_id, s.start_min))
    res.api_only.sort(key=lambda s: (s.room_id, s.start_min))
    res.different.sort(key=lambda p: (p[0].room_id, p[0].start_min))

    # Rooms the API has data for that the scrape didn't return a row for at all
    # (occupied or not). A room with an empty row is fine; a missing row means
    # the scrape can't tell us anything about it.
    res.api_rooms_missing_from_scrape = sorted(api_room_ids - set(scraped))
    return res


def api_only_reason(s: Slot) -> str:
    """Best-effort explanation for a slot the scrape can't represent."""
    reasons = []
    if s.start_min < GRID_START_MINUTES:
        reasons.append("starts before 08:00 grid")
    if s.start_min % MINUTES_PER_UNIT or s.end_min % MINUTES_PER_UNIT:
        reasons.append("not aligned to 15-min grid")
    return ", ".join(reasons)


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------


def pct(n: int, d: int) -> str:
    return "n/a" if d == 0 else f"{100 * n / d:.1f}%"


def print_day(res: DayResult, rooms: dict[int, RoomInfo], quiet: bool) -> None:
    n_api, n_scr, n_match = len(res.api_slots), len(res.scrape_slots), len(res.matched)
    union = len(res.api_slots | res.scrape_slots)
    print(f"\n{'=' * 78}\n{res.day.isoformat()} ({res.day.strftime('%A')})\n{'=' * 78}")
    print(f"  API slots:        {n_api}")
    print(f"  Scrape slots:     {n_scr}  (in known classrooms)")
    print(f"  Exact matches:    {n_match}  -> {pct(n_match, union)} of the union, "
          f"{pct(n_match, n_api)} of API, {pct(n_match, n_scr)} of scrape")
    print(f"  Different bounds: {len(res.different)}")
    print(f"  API only:         {len(res.api_only)}")
    print(f"  Scrape only:      {len(res.scrape_only)}")
    if res.unknown_rooms:
        print(f"  Scraped rooms not in classrooms.json: {len(res.unknown_rooms)} "
              f"({sum(res.unknown_rooms.values())} slots, ignored)")
    if res.api_rooms_missing_from_scrape:
        print(f"  API rooms with no row in scrape: {len(res.api_rooms_missing_from_scrape)}")
    for csic, err in res.scrape_failures.items():
        print(f"  !! scrape failed for {csic}: {err}")

    if quiet:
        return

    def room_label(rid: int) -> str:
        info = rooms.get(rid)
        return info.label(rid) if info else f"unknown room (id={rid})"

    if res.different:
        print("\n  --- Different boundaries (API vs scrape) ---")
        for a, s in res.different:
            print(f"    {room_label(a.room_id)}: API {a.label()}  |  scrape {s.label()}")
    if res.api_only:
        print("\n  --- Only in API ---")
        for s in res.api_only:
            reason = api_only_reason(s)
            print(f"    {room_label(s.room_id)}: {s.label()}" + (f"   [{reason}]" if reason else ""))
    if res.scrape_only:
        print("\n  --- Only in scrape ---")
        for s in res.scrape_only:
            print(f"    {room_label(s.room_id)}: {s.label()}")
    if res.api_rooms_missing_from_scrape:
        print("\n  --- API rooms with no row in the scraped page ---")
        for rid in res.api_rooms_missing_from_scrape:
            n = sum(1 for s in res.api_slots if s.room_id == rid)
            print(f"    {room_label(rid)}: {n} API slot(s)")


def print_summary(results: list[DayResult]) -> None:
    n_api = sum(len(r.api_slots) for r in results)
    n_scr = sum(len(r.scrape_slots) for r in results)
    n_match = sum(len(r.matched) for r in results)
    n_diff = sum(len(r.different) for r in results)
    n_api_only = sum(len(r.api_only) for r in results)
    n_scr_only = sum(len(r.scrape_only) for r in results)
    union = sum(len(r.api_slots | r.scrape_slots) for r in results)

    reasons = Counter(api_only_reason(s) or "no obvious reason" for r in results for s in r.api_only)

    print(f"\n{'#' * 78}\nOVERALL ({len(results)} day(s))\n{'#' * 78}")
    print(f"  API slots:         {n_api}")
    print(f"  Scrape slots:      {n_scr}")
    print(f"  Exact matches:     {n_match}")
    print(f"  Different bounds:  {n_diff}")
    print(f"  API only:          {n_api_only}")
    for reason, n in reasons.most_common():
        print(f"      {n:5d}  {reason}")
    print(f"  Scrape only:       {n_scr_only}")
    print()
    print(f"  MATCH RATE (exact / union):          {pct(n_match, union)}")
    print(f"  Exact-or-overlapping / union:        {pct(n_match + n_diff, union - n_diff)}")
    print(f"  API slots reproduced exactly:        {pct(n_match, n_api)}")
    print(f"  API slots reproduced at least loosely: {pct(n_match + n_diff, n_api)}")
    print(f"  Scrape slots confirmed by API:       {pct(n_match, n_scr)}")


def to_json(results: list[DayResult], rooms: dict[int, RoomInfo]) -> dict:
    def slot(s: Slot) -> dict:
        info = rooms.get(s.room_id)
        return {
            "room_id": s.room_id,
            "room": info.name if info else None,
            "building": info.building if info else None,
            "campus": info.campus if info else None,
            "start": s.start,
            "end": s.end,
        }

    return {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "days": [
            {
                "date": r.day.isoformat(),
                "api_slots": len(r.api_slots),
                "scrape_slots": len(r.scrape_slots),
                "matched": len(r.matched),
                "match_rate": (len(r.matched) / len(r.api_slots | r.scrape_slots)) if (r.api_slots | r.scrape_slots) else None,
                "different": [{"api": slot(a), "scrape": slot(s)} for a, s in r.different],
                "api_only": [{**slot(s), "reason": api_only_reason(s) or None} for s in r.api_only],
                "scrape_only": [slot(s) for s in r.scrape_only],
                "unknown_scraped_rooms": r.unknown_rooms,
                "api_rooms_missing_from_scrape": r.api_rooms_missing_from_scrape,
                "scrape_failures": r.scrape_failures,
            }
            for r in results
        ],
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--date", help="Single date to compare, YYYY-MM-DD (default: every date the API lists)")
    parser.add_argument("--api-base", default=DEFAULT_API_BASE)
    parser.add_argument("--json", help="Also write the full diff to this JSON file")
    parser.add_argument("--quiet", action="store_true", help="Only print per-day counts and the summary")
    parser.add_argument("--no-delay", action="store_true", help="Skip the delay between scrape requests")
    args = parser.parse_args()

    rooms, campus_ids = load_rooms()
    results: list[DayResult] = []

    with httpx.Client(headers=REQUEST_HEADERS, follow_redirects=True) as client:
        days = [date.fromisoformat(args.date)] if args.date else api_dates(client, args.api_base)
        print(f"Comparing {len(days)} day(s) against {args.api_base}: {', '.join(d.isoformat() for d in days)}")

        for d in days:
            print(f"\n[{d.isoformat()}] downloading API data...", flush=True)
            try:
                api_slots, api_room_ids, generated_at = api_slots_for_day(client, args.api_base, d)
            except httpx.HTTPError as e:
                print(f"  API fetch failed: {e}. Skipping day.")
                continue
            print(f"  API file generated_at={generated_at}, {len(api_slots)} slots")
            print(f"[{d.isoformat()}] scraping onlineservices.polimi.it...", flush=True)
            scraped, failures = scrape_slots_for_day(client, campus_ids, d, args.no_delay)
            print(f"  scraped {len(scraped)} classroom rows, "
                  f"{sum(len(v) for v in scraped.values())} slots, {len(failures)} campus failure(s)")
            results.append(compare_day(d, api_slots, api_room_ids, scraped, failures, rooms))

    for res in results:
        print_day(res, rooms, args.quiet)
    if results:
        print_summary(results)

    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(to_json(results, rooms), f, ensure_ascii=False, indent=2)
        print(f"\nFull diff written to {args.json}")


if __name__ == "__main__":
    main()
