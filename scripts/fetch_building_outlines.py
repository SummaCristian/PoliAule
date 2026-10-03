"""
Builds data/building-outlines.json: each building's footprint from OpenStreetMap, as a
small SVG path the building cards draw behind their text.

For every building in data/classrooms.json, the OSM API's /map call over a tiny bbox around
its lat/long lists the nearby `building=*` ways and multipolygon relations; each candidate's
full geometry is fetched (/way/:id/full, /relation/:id/full), and the one whose outer ring
contains the point wins (else the nearest one within MAX_DISTANCE_M, flagged in the output).

Rings are projected to local metres (north up, like the map tab), simplified, and scaled
into a VIEWBOX x VIEWBOX box keeping their aspect ratio. Inner rings (courtyards) are kept;
the frontend draws the path with fill-rule: evenodd.

Footprints hardly ever change, so this is run by hand, not by a workflow, and its output is
committed and bundled with the frontend. Buildings OSM doesn't match get no entry, and their
card simply shows no outline; `--only CAMPUS:NAME` re-runs single buildings, and
OVERRIDES pins a building to a specific OSM element when the automatic pick is wrong.

Map data (c) OpenStreetMap contributors, ODbL.
"""

import argparse
import json
import math
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import httpx

CLASSROOMS_FILE = Path(__file__).parent.parent / "data" / "classrooms.json"
OUTPUT_FILE = Path(__file__).parent.parent / "data" / "building-outlines.json"
OSM_API = "https://api.openstreetmap.org/api/0.6"

# The OSM API's usage policy asks for an identifying UA and gentle request rates.
REQUEST_HEADERS = {"User-Agent": "PoliAule/1.0 (https://poliaule.com)"}
DELAY_BETWEEN_CALLS = 1.0
MAX_RETRIES = 3
RETRY_DELAY = 2

SEARCH_RADIUS_M = 40       # half-size of the /map bbox around the building's point
MAX_DISTANCE_M = 30        # nearest fallback when no footprint contains the point
SIMPLIFY_TOLERANCE_M = 0.6
VIEWBOX = 100

# "CAMPUS:NAME" -> "way/<id>" or "relation/<id>", for buildings the automatic pick gets wrong.
OVERRIDES: dict[str, str] = {}


def get(client: httpx.Client, url: str) -> ET.Element:
    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            response = client.get(url)
            response.raise_for_status()
            time.sleep(DELAY_BETWEEN_CALLS)
            return ET.fromstring(response.content)
        except (httpx.HTTPError, ET.ParseError) as e:
            last_error = e
            time.sleep(RETRY_DELAY)
    raise RuntimeError(f"GET {url} failed: {last_error}")


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------

def project(lat: float, lon: float, lat0: float, lon0: float) -> tuple[float, float]:
    """Equirectangular metres around (lat0, lon0), y growing downward like SVG."""
    x = (lon - lon0) * 111_320 * math.cos(math.radians(lat0))
    y = -(lat - lat0) * 110_540
    return x, y


def point_in_ring(x: float, y: float, ring: list[tuple[float, float]]) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def distance_to_ring(x: float, y: float, ring: list[tuple[float, float]]) -> float:
    best = math.inf
    for (ax, ay), (bx, by) in zip(ring, ring[1:] + ring[:1]):
        dx, dy = bx - ax, by - ay
        t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
        best = min(best, math.hypot(x - (ax + t * dx), y - (ay + t * dy)))
    return best


def simplify(points: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    """Douglas-Peucker on an open polyline."""
    if len(points) < 3:
        return points
    (ax, ay), (bx, by) = points[0], points[-1]
    dx, dy = bx - ax, by - ay
    norm = math.hypot(dx, dy)
    far_i, far_d = 0, -1.0
    for i in range(1, len(points) - 1):
        px, py = points[i]
        d = math.hypot(px - ax, py - ay) if norm == 0 else abs(dy * px - dx * py + bx * ay - by * ax) / norm
        if d > far_d:
            far_i, far_d = i, d
    if far_d <= tolerance:
        return [points[0], points[-1]]
    left = simplify(points[: far_i + 1], tolerance)
    right = simplify(points[far_i:], tolerance)
    return left[:-1] + right


def simplify_ring(ring: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    # Split the closed ring at its farthest point from the start so both halves are open lines.
    far = max(range(len(ring)), key=lambda i: math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]))
    a = simplify(ring[: far + 1], tolerance)
    b = simplify(ring[far:] + [ring[0]], tolerance)
    return a[:-1] + b[:-1]


# ---------------------------------------------------------------------------
# OSM parsing
# ---------------------------------------------------------------------------

def parse_nodes(root: ET.Element) -> dict[str, tuple[float, float]]:
    return {n.get("id"): (float(n.get("lat")), float(n.get("lon"))) for n in root.iter("node")}


def way_coords(way: ET.Element, nodes: dict) -> list[tuple[float, float]]:
    return [nodes[nd.get("ref")] for nd in way.iter("nd") if nd.get("ref") in nodes]


def join_ways(ways: list[list]) -> list[list]:
    """Stitch a multipolygon's member ways into closed rings."""
    ways = [w[:] for w in ways if len(w) >= 2]
    rings = []
    while ways:
        ring = ways.pop(0)
        changed = True
        while ring[0] != ring[-1] and changed:
            changed = False
            for i, w in enumerate(ways):
                if w[0] == ring[-1]:
                    ring += w[1:]
                elif w[-1] == ring[-1]:
                    ring += w[-2::-1]
                elif w[-1] == ring[0]:
                    ring = w[:-1] + ring
                elif w[0] == ring[0]:
                    ring = w[:0:-1] + ring
                else:
                    continue
                ways.pop(i)
                changed = True
                break
        if ring[0] == ring[-1] and len(ring) >= 4:
            rings.append(ring[:-1])
    return rings


def element_rings(client: httpx.Client, kind: str, osm_id: str) -> tuple[list, list, dict]:
    """(outer rings, inner rings, tags) of a way or multipolygon relation, in lat/lon."""
    root = get(client, f"{OSM_API}/{kind}/{osm_id}/full")
    nodes = parse_nodes(root)
    ways = {w.get("id"): w for w in root.iter("way")}
    if kind == "way":
        way = ways[osm_id]
        coords = way_coords(way, nodes)
        tags = {t.get("k"): t.get("v") for t in way.iter("tag")}
        return join_ways([coords]), [], tags
    rel = next(r for r in root.iter("relation") if r.get("id") == osm_id)
    tags = {t.get("k"): t.get("v") for t in rel.findall("tag")}
    outer, inner = [], []
    for m in rel.findall("member"):
        if m.get("type") != "way" or m.get("ref") not in ways:
            continue
        coords = way_coords(ways[m.get("ref")], nodes)
        (inner if m.get("role") == "inner" else outer).append(coords)
    return join_ways(outer), join_ways(inner), tags


def candidates(client: httpx.Client, lat: float, lon: float) -> list[tuple[str, str]]:
    dlat = SEARCH_RADIUS_M / 110_540
    dlon = SEARCH_RADIUS_M / (111_320 * math.cos(math.radians(lat)))
    root = get(client, f"{OSM_API}/map?bbox={lon - dlon},{lat - dlat},{lon + dlon},{lat + dlat}")
    found = []
    in_relation = set()
    for rel in root.iter("relation"):
        tags = {t.get("k"): t.get("v") for t in rel.findall("tag")}
        if "building" in tags and tags.get("type") == "multipolygon":
            found.append(("relation", rel.get("id")))
            in_relation.update(m.get("ref") for m in rel.findall("member") if m.get("type") == "way")
    for way in root.iter("way"):
        tags = {t.get("k"): t.get("v") for t in way.findall("tag")}
        if "building" in tags and way.get("id") not in in_relation:
            found.append(("way", way.get("id")))
    return found


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def to_path(outer: list, inner: list, lat0: float, lon0: float) -> tuple[str, float]:
    """SVG path in a VIEWBOX-sized box plus the footprint's aspect ratio (width / height)."""
    rings = [[project(la, lo, lat0, lon0) for la, lo in r] for r in outer + inner]
    rings = [simplify_ring(r, SIMPLIFY_TOLERANCE_M) for r in rings]
    rings = [r for r in rings if len(r) >= 3]
    xs = [x for r in rings for x, _ in r]
    ys = [y for r in rings for _, y in r]
    w, h = max(xs) - min(xs), max(ys) - min(ys)
    scale = VIEWBOX / max(w, h)
    ox = (VIEWBOX - w * scale) / 2 - min(xs) * scale
    oy = (VIEWBOX - h * scale) / 2 - min(ys) * scale
    parts = []
    for r in rings:
        pts = [f"{x * scale + ox:.1f} {y * scale + oy:.1f}" for x, y in r]
        parts.append("M" + "L".join(pts) + "Z")
    return "".join(parts), round(w / h, 3)


def outline_for(client: httpx.Client, key: str, lat: float, lon: float) -> dict | None:
    if key in OVERRIDES:
        kind, osm_id = OVERRIDES[key].split("/")
        picks = [(kind, osm_id)]
    else:
        picks = candidates(client, lat, lon)

    best = None  # (distance, kind, id, outer, inner, tags)
    for kind, osm_id in picks:
        outer, inner, tags = element_rings(client, kind, osm_id)
        if not outer:
            continue
        rings_m = [[project(la, lo, lat, lon) for la, lo in r] for r in outer]
        if any(point_in_ring(0, 0, r) for r in rings_m):
            dist = 0.0
        else:
            dist = min(distance_to_ring(0, 0, r) for r in rings_m)
        if best is None or dist < best[0]:
            best = (dist, kind, osm_id, outer, inner, tags)
        if dist == 0 and key not in OVERRIDES:
            break

    if best is None or (best[0] > MAX_DISTANCE_M and key not in OVERRIDES):
        return None
    dist, kind, osm_id, outer, inner, tags = best
    d, aspect = to_path(outer, inner, lat, lon)
    entry = {"d": d, "aspect": aspect, "osm": f"{kind}/{osm_id}"}
    if dist > 0:
        entry["distance_m"] = round(dist, 1)
    if tags.get("name"):
        entry["osm_name"] = tags["name"]
    return entry


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    parser.add_argument("--only", action="append", default=[], metavar="CAMPUS:NAME",
                        help="Only (re)fetch these buildings, keeping the rest of the existing file.")
    args = parser.parse_args()

    campuses = json.loads(CLASSROOMS_FILE.read_text())
    existing = json.loads(OUTPUT_FILE.read_text()) if OUTPUT_FILE.exists() and args.only else {}
    result: dict[str, dict] = existing
    missing = []

    with httpx.Client(headers=REQUEST_HEADERS, timeout=60) as client:
        for campus in campuses:
            for building in campus["buildings"]:
                key = f"{campus['id']}:{building['name']}"
                if args.only and key not in args.only:
                    continue
                lat, lon = building.get("lat"), building.get("long")
                if lat is None or lon is None:
                    missing.append((key, "no coordinates"))
                    continue
                try:
                    entry = outline_for(client, key, lat, lon)
                except RuntimeError as e:
                    missing.append((key, str(e)))
                    continue
                if entry is None:
                    missing.append((key, "no OSM footprint nearby"))
                    result.get(campus["id"], {}).pop(building["name"], None)
                    continue
                result.setdefault(campus["id"], {})[building["name"]] = entry
                note = f" ({entry['distance_m']} m away)" if "distance_m" in entry else ""
                print(f"{key:<14} {entry['osm']:<20} {entry.get('osm_name', '')}{note}")

    OUTPUT_FILE.write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n")
    for key, reason in missing:
        print(f"MISSING {key}: {reason}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
