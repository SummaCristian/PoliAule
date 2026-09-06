"""
Read the occupancy fetch run logs that the workflow uploads to R2
(logs/occupancy/YYYY/MM/DD/HH.json, one per run, see scripts/fetch.py) and
print them as a table, so a run that misbehaved days ago can be traced back.

Objects are fetched with `wrangler r2 object get` (so wrangler must be logged
in, or CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID set) and cached locally under
logs/cache/, since past runs never change. R2 has no cheap listing from the
CLI, so keys are probed for the hours the cron Worker fires at (see --hours).

Usage:
    python scripts/read_logs.py                              # today
    python scripts/read_logs.py --from 2026-09-01 --to 2026-09-07
    python scripts/read_logs.py --problems                   # only non-ok runs
    python scripts/read_logs.py --show 2026/09/08/14         # full log of one run
    python scripts/read_logs.py --bucket poliaule-data-beta
"""

import argparse
import json
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

CACHE_DIR = Path(__file__).parent.parent / "logs" / "cache"
KEY_PREFIX = "logs/occupancy"
DEFAULT_HOURS = "3,5-19"  # mirrors workers/cron/wrangler.toml (UTC)


def parse_hours(spec: str) -> list[int]:
    hours: set[int] = set()
    for part in spec.split(","):
        if "-" in part:
            a, b = part.split("-")
            hours.update(range(int(a), int(b) + 1))
        else:
            hours.add(int(part))
    return sorted(hours)


def fetch_log(bucket: str, key: str, refresh: bool = False) -> dict | None:
    cached = CACHE_DIR / bucket / f"{key}.json"
    if cached.exists() and not refresh:
        with open(cached, encoding="utf-8") as f:
            return json.load(f)
    cached.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        ["npx", "--yes", "wrangler@4", "r2", "object", "get",
         f"{bucket}/{KEY_PREFIX}/{key}.json", "--file", str(cached), "--remote"],
        capture_output=True, text=True,
    )
    if result.returncode != 0 or not cached.exists() or cached.stat().st_size == 0:
        cached.unlink(missing_ok=True)
        if "does not exist" not in result.stderr and "404" not in result.stderr and "not found" not in result.stderr.lower():
            print(f"  warning: wrangler failed for {key}: {result.stderr.strip().splitlines()[-1] if result.stderr.strip() else result.returncode}", file=sys.stderr)
        return None
    with open(cached, encoding="utf-8") as f:
        return json.load(f)


def day_range(start: date, end: date):
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def summarize_row(key: str, log: dict) -> str:
    days = log.get("days", {})
    slots = sum(d.get("slots_total", 0) for d in days.values())
    rest = sum(d.get("rest_calls", 0) for d in days.values())
    page_errors = len(log.get("page_errors", []))
    rest_fail = len(log.get("rest_failures", []))
    missing = len({m["id"] for m in log.get("missing_rows", [])})
    drops = len(log.get("slot_drops", []))
    status = log.get("status", "?")
    mark = {"ok": " ", "failed": "!", "crashed": "X"}.get(status, "?")
    dur = log.get("duration_seconds", 0)
    return (f"{mark} {key}  {status:7} {dur:6.0f}s  days={len(days)}  slots={slots:5d}  "
            f"rest={rest:3d}  pageErr={page_errors}  restFail={rest_fail}  missing={missing}  drops={drops}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--bucket", default="poliaule-data")
    parser.add_argument("--from", dest="start", help="First day (UTC), YYYY-MM-DD. Default: today")
    parser.add_argument("--to", dest="end", help="Last day (UTC), YYYY-MM-DD. Default: --from")
    parser.add_argument("--hours", default=DEFAULT_HOURS, help=f"UTC hours to probe, e.g. '3,5-19' (default) or '0-23'")
    parser.add_argument("--problems", action="store_true", help="Only show runs whose status is not ok")
    parser.add_argument("--show", metavar="YYYY/MM/DD/HH", help="Print the full log of one run and exit")
    parser.add_argument("--latest", action="store_true", help="Print the full latest.json and exit")
    parser.add_argument("--refresh", action="store_true", help="Ignore the local cache")
    args = parser.parse_args()

    if args.show or args.latest:
        key = "latest" if args.latest else args.show
        log = fetch_log(args.bucket, key, refresh=True)
        if log is None:
            sys.exit(f"No log at {KEY_PREFIX}/{key}.json in {args.bucket}")
        print(json.dumps(log, ensure_ascii=False, indent=2))
        return

    start = date.fromisoformat(args.start) if args.start else date.today()
    end = date.fromisoformat(args.end) if args.end else start
    hours = parse_hours(args.hours)

    rows: list[str] = []
    problems: list[tuple[str, dict]] = []
    for d in day_range(start, end):
        for h in hours:
            key = f"{d.strftime('%Y/%m/%d')}/{h:02d}"
            log = fetch_log(args.bucket, key, refresh=args.refresh)
            if log is None:
                continue
            if log.get("status") != "ok":
                problems.append((key, log))
            if not args.problems or log.get("status") != "ok":
                rows.append(summarize_row(key, log))

    if not rows:
        print("No run logs found for that range.")
        return
    print(f"Runs in {args.bucket} ({start} to {end}, UTC hours {args.hours}):\n")
    print("\n".join(rows))

    if problems:
        print(f"\n{len(problems)} run(s) with something to report:")
        for key, log in problems:
            print(f"\n--- {key} ({log.get('status')}) ---")
            print(log.get("message", "").rstrip())
            if log.get("error"):
                print(log["error"].rstrip().splitlines()[-1])


if __name__ == "__main__":
    main()
