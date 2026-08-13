"""
Fetches classroom photos from Polimi and writes changed ones to photos/<classroom_id>.jpg.

Polimi's photo flow is two calls: resolve idfoto -> a docmanager.polimi.it URL carrying
a short-lived signed token, then download the bytes from that URL. Both calls need a
browser-like User-Agent or Polimi's WAF rejects them (same as fetch.py/fetch_opening_hours.py).

To avoid re-uploading and re-purging 291 unchanged images every month, each photo's MD5 is
compared against photos/manifest.json (restored from the previous run via actions/cache in
the workflow). Only new/changed photos are written to disk; the workflow then only uploads
and purges what's on disk, and this script always rewrites manifest.json so unchanged hashes
carry forward to the next run.
"""

import argparse
import hashlib
import json
import os
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

import httpx

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

CLASSROOMS_FILE = Path(__file__).parent.parent / "data" / "classrooms.json"
OUTPUT_DIR = Path(__file__).parent.parent / "photos"
MANIFEST_FILE = OUTPUT_DIR / "manifest.json"
RESOLVE_API = "https://onlineservices.polimi.it/maps_rest/rest/syncro/rooms/foto"
TRUSTED_PHOTO_HOST = "docmanager.polimi.it"

# Retry settings (mirrors fetch.py)
MAX_RETRIES = 3
RETRY_DELAY = 2  # seconds between retries

# Fetch settings
DELAY_BETWEEN_CALLS = 0.5  # seconds to wait between classrooms

# Polimi's WAF blocks the default httpx UA; a browser-like UA lets requests
# from CI runners through.
REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
}

MAX_DETAIL_LINES = 10  # per category, in the Telegram summary


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def write_github_output(status: str, message: str):
    """Append a `status` and multi-line `message` output for the GitHub Actions step, if running in CI."""
    output_path = os.environ.get("GITHUB_OUTPUT")
    if not output_path:
        return
    delimiter = "FETCH_MESSAGE_EOF"
    with open(output_path, "a", encoding="utf-8") as f:
        f.write(f"status={status}\n")
        f.write(f"message<<{delimiter}\n{message}\n{delimiter}\n")


def collect_classrooms_with_photos(campuses: list[dict]) -> list[dict]:
    """Flatten campuses -> buildings -> classrooms into [{id, name, idfoto}], skipping rooms with no idfoto."""
    result = []
    for campus in campuses:
        for building in campus.get("buildings", []):
            for classroom in building.get("classrooms", []):
                idfoto = classroom.get("idfoto")
                if idfoto:
                    result.append({"id": classroom["id"], "name": classroom["name"], "idfoto": idfoto})
    return result


def resolve_photo_url(client: httpx.Client, idfoto: int) -> str:
    """Resolve an idfoto to its signed docmanager.polimi.it download URL. Raises on failure/untrusted host."""
    response = client.get(f"{RESOLVE_API}/{idfoto}", timeout=10)
    response.raise_for_status()
    url = response.text.strip()
    parsed = urlparse(url)
    if parsed.hostname != TRUSTED_PHOTO_HOST or parsed.scheme != "https":
        raise ValueError(f"Untrusted host: {parsed.hostname}")
    return url


def fetch_photo_bytes(client: httpx.Client, room: dict) -> bytes:
    """Resolve + download one classroom's photo, retrying the whole resolve+download pair on failure."""
    last_error = "unknown error"
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            url = resolve_photo_url(client, room["idfoto"])
            response = client.get(url, timeout=20)
            response.raise_for_status()
            return response.content
        except (httpx.HTTPError, ValueError) as e:
            last_error = str(e)
            print(f"    Attempt {attempt}/{MAX_RETRIES} failed for classroom {room['name']} (id={room['id']}): {e}")
            if attempt < MAX_RETRIES:
                time.sleep(RETRY_DELAY)
    raise RuntimeError(last_error)


def summarize(new: list[dict], updated: list[dict], unchanged_count: int, failures: list[dict]) -> tuple[str, str]:
    """Build a (status, message) pair describing the run, for the Telegram notification step."""
    lines = [
        f"{len(new)} new, {len(updated)} updated, {unchanged_count} unchanged, {len(failures)} failed."
    ]

    def add_section(title: str, rooms: list[dict]):
        if not rooms:
            return
        lines.append(f"{title}:")
        for r in rooms[:MAX_DETAIL_LINES]:
            lines.append(f"    {r['name']} (id={r['id']})")
        if len(rooms) > MAX_DETAIL_LINES:
            lines.append(f"    ...and {len(rooms) - MAX_DETAIL_LINES} more")

    add_section("New", new)
    add_section("Updated", updated)
    if failures:
        lines.append(f"Failed after {MAX_RETRIES} attempts:")
        for f in failures[:MAX_DETAIL_LINES]:
            lines.append(f"    {f['name']} (id={f['id']}): {f['error']}")
        if len(failures) > MAX_DETAIL_LINES:
            lines.append(f"    ...and {len(failures) - MAX_DETAIL_LINES} more")

    status = "failed" if failures else "ok"
    return status, "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-delay", action="store_true", help="Skip delay between API calls")
    args = parser.parse_args()

    with open(CLASSROOMS_FILE, encoding="utf-8") as f:
        campuses = json.load(f)

    rooms = collect_classrooms_with_photos(campuses)
    if not rooms:
        message = "No classrooms with idfoto found in data/classrooms.json. Nothing to fetch."
        print(message, file=sys.stderr)
        write_github_output("failed", message)
        return 1

    print(f"Found {len(rooms)} classroom(s) with a photo.")

    manifest: dict[str, str] = {}
    if MANIFEST_FILE.exists():
        with open(MANIFEST_FILE, encoding="utf-8") as f:
            manifest = json.load(f)

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    new: list[dict] = []
    updated: list[dict] = []
    failures: list[dict] = []
    unchanged_count = 0

    with httpx.Client(headers=REQUEST_HEADERS) as client:
        for i, room in enumerate(rooms, start=1):
            key = str(room["id"])
            label = f"[{i}/{len(rooms)}] {room['name']} (id={room['id']})"
            try:
                content = fetch_photo_bytes(client, room)
            except (RuntimeError, httpx.HTTPError) as e:
                print(f"  {label}: failed - {e}")
                failures.append({**room, "error": str(e)})
                if not args.no_delay:
                    time.sleep(DELAY_BETWEEN_CALLS)
                continue

            digest = hashlib.md5(content).hexdigest()
            previous_digest = manifest.get(key)

            if digest == previous_digest:
                unchanged_count += 1
                print(f"  {label}: unchanged")
            else:
                (new if previous_digest is None else updated).append(room)
                with open(OUTPUT_DIR / f"{key}.jpg", "wb") as f:
                    f.write(content)
                manifest[key] = digest
                print(f"  {label}: {'new' if previous_digest is None else 'updated'}")

            if not args.no_delay:
                time.sleep(DELAY_BETWEEN_CALLS)

    with open(MANIFEST_FILE, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, sort_keys=True)

    status, message = summarize(new, updated, unchanged_count, failures)
    print(f"\n{message}")
    write_github_output(status, message)

    print("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
