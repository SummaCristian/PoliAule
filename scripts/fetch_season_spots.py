"""
Builds data/season-spots.json: open spots on and around each campus, where the seasonal
decorations stand on the Campus map (components/halloween.js puts 3D pumpkins and
tombstones there) without ending up hidden inside a building.

For every campus in data/classrooms.json (secondary ones aside), one OSM API /map call over
a box around its buildings lists what's there. A spot is either inside an open area (park,
garden, grass, square, pedestrian area, pitch, playground) or on a pedestrian path, at least
CLEARANCE_M from every building outline and within NEAR_CAMPUS_M of one of the campus's own
buildings. From those candidates, spots are picked at least SPACING_M apart, in an order
fixed by their coordinates, up to MAX_SPOTS per campus.

Open space hardly ever moves, so this is run by hand, like fetch_building_outlines.py, and
its output is committed and bundled with the frontend.

Map data (c) OpenStreetMap contributors, ODbL.
"""

import hashlib
import json
import math
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import httpx

CLASSROOMS_FILE = Path(__file__).parent.parent / "data" / "classrooms.json"
OUTPUT_FILE = Path(__file__).parent.parent / "data" / "season-spots.json"
OSM_API = "https://api.openstreetmap.org/api/0.6"

# The OSM API's usage policy asks for an identifying UA and gentle request rates.
REQUEST_HEADERS = {"User-Agent": "PoliAule/1.0 (https://poliaule.com)"}
DELAY_BETWEEN_CALLS = 1.0
MAX_RETRIES = 3
RETRY_DELAY = 2

BOX_MARGIN_M = 120     # around the campus's buildings, for the /map box
NEAR_CAMPUS_M = 110    # a spot is kept only this close to one of the campus's buildings
CLEARANCE_M = 5        # from any building outline
GRID_M = 7             # candidate spacing inside open areas
PATH_STEP_M = 8        # candidate spacing along paths
SPACING_M = 24         # between picked spots
MAX_SPOTS = 40         # per campus

OPEN_AREAS = {
    "leisure": {"park", "garden", "playground", "pitch", "common"},
    "landuse": {"grass", "recreation_ground", "village_green", "meadow"},
    "place": {"square"},
}
PATHS = {"pedestrian", "footway", "path", "living_street"}


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
            if attempt < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAY)
    raise RuntimeError(f"{url}: {last_error}")


class Projection:
    """Local metres around a point: x east, y north."""

    def __init__(self, lat0: float, lon0: float):
        self.lat0, self.lon0 = lat0, lon0
        self.kx = 111320 * math.cos(math.radians(lat0))
        self.ky = 110540

    def to_m(self, lat: float, lon: float) -> tuple[float, float]:
        return (lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky

    def to_ll(self, x: float, y: float) -> tuple[float, float]:
        return self.lat0 + y / self.ky, self.lon0 + x / self.kx


def inside(poly: list[tuple[float, float]], x: float, y: float) -> bool:
    hit = False
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


def segment_distance(px: float, py: float, ax: float, ay: float, bx: float, by: float) -> float:
    dx, dy = bx - ax, by - ay
    length2 = dx * dx + dy * dy
    t = 0 if length2 == 0 else max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / length2))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


class Buildings:
    """Every building outline in the box, for "is this spot clear of them" checks."""

    def __init__(self, polys: list[list[tuple[float, float]]]):
        self.items = []
        for poly in polys:
            xs = [p[0] for p in poly]
            ys = [p[1] for p in poly]
            self.items.append((min(xs), min(ys), max(xs), max(ys), poly))

    def clear(self, x: float, y: float) -> bool:
        for x0, y0, x1, y1, poly in self.items:
            if x < x0 - CLEARANCE_M or x > x1 + CLEARANCE_M or y < y0 - CLEARANCE_M or y > y1 + CLEARANCE_M:
                continue
            if inside(poly, x, y):
                return False
            for i in range(len(poly) - 1):
                if segment_distance(x, y, *poly[i], *poly[i + 1]) < CLEARANCE_M:
                    return False
        return True


def join_rings(parts: list[list[tuple[float, float]]]) -> list[list[tuple[float, float]]]:
    """A multipolygon's outer member ways, which may each be only a stretch of a ring,
    joined end to end into closed rings."""
    parts = [list(p) for p in parts if len(p) >= 2]
    rings = []
    while parts:
        ring = parts.pop(0)
        while ring[0] != ring[-1]:
            for i, part in enumerate(parts):
                if part[0] == ring[-1]:
                    ring += part[1:]
                elif part[-1] == ring[-1]:
                    ring += part[::-1][1:]
                else:
                    continue
                parts.pop(i)
                break
            else:
                break   # an open ring (members outside the box): left out
        if len(ring) >= 4 and ring[0] == ring[-1]:
            rings.append(ring)
    return rings


def campus_spots(client: httpx.Client, campus: dict) -> list[list]:
    points = [(b["lat"], b["long"]) for b in campus.get("buildings", [])
              if not b.get("secondary") and isinstance(b.get("lat"), (int, float)) and isinstance(b.get("long"), (int, float))]
    if not points:
        return []
    proj = Projection(sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points))
    own = [proj.to_m(lat, lon) for lat, lon in points]
    xs = [p[0] for p in own]
    ys = [p[1] for p in own]
    south, west = proj.to_ll(min(xs) - BOX_MARGIN_M, min(ys) - BOX_MARGIN_M)
    north, east = proj.to_ll(max(xs) + BOX_MARGIN_M, max(ys) + BOX_MARGIN_M)
    root = get(client, f"{OSM_API}/map?bbox={west},{south},{east},{north}")

    nodes = {n.get("id"): proj.to_m(float(n.get("lat")), float(n.get("lon"))) for n in root.iter("node")}
    def is_open(tags: dict) -> bool:
        return (any(tags.get(k) in v for k, v in OPEN_AREAS.items())
                or (tags.get("highway") == "pedestrian" and tags.get("area") == "yes"))

    building_polys, open_polys, paths = [], [], []
    way_coords = {}
    for way in root.iter("way"):
        tags = {t.get("k"): t.get("v") for t in way.iter("tag")}
        coords = [nodes[nd.get("ref")] for nd in way.iter("nd") if nd.get("ref") in nodes]
        way_coords[way.get("id")] = coords
        if len(coords) < 2:
            continue
        closed = len(coords) >= 4 and coords[0] == coords[-1]
        if "building" in tags and closed:
            building_polys.append(coords)
        elif closed and is_open(tags):
            open_polys.append(coords)
        elif tags.get("highway") in PATHS:
            paths.append(coords)
    # Multipolygons: many of the university's own buildings, and some parks, are mapped
    # as relations rather than single closed ways
    for rel in root.iter("relation"):
        tags = {t.get("k"): t.get("v") for t in rel.iter("tag")}
        if tags.get("type") != "multipolygon":
            continue
        outers = [way_coords[m.get("ref")] for m in rel.iter("member")
                  if m.get("type") == "way" and m.get("role") in ("outer", "") and m.get("ref") in way_coords]
        if "building" in tags:
            building_polys.extend(join_rings(outers))
        elif is_open(tags):
            open_polys.extend(join_rings(outers))
    buildings = Buildings(building_polys)

    def near_campus(x: float, y: float) -> bool:
        return any(math.hypot(x - bx, y - by) <= NEAR_CAMPUS_M for bx, by in own)

    candidates = []
    for poly in open_polys:
        pxs = [p[0] for p in poly]
        pys = [p[1] for p in poly]
        x = min(pxs)
        while x <= max(pxs):
            y = min(pys)
            while y <= max(pys):
                if inside(poly, x, y):
                    candidates.append((x, y, "open"))
                y += GRID_M
            x += GRID_M
    for line in paths:
        for i in range(len(line) - 1):
            (ax, ay), (bx, by) = line[i], line[i + 1]
            steps = max(1, int(math.hypot(bx - ax, by - ay) / PATH_STEP_M))
            for s in range(steps):
                t = s / steps
                candidates.append((ax + (bx - ax) * t, ay + (by - ay) * t, "path"))

    candidates = [c for c in candidates if near_campus(c[0], c[1]) and buildings.clear(c[0], c[1])]
    # An order that looks random but is the same on every run, so re-running doesn't move them
    candidates.sort(key=lambda c: hashlib.sha1(f"{c[0]:.1f},{c[1]:.1f}".encode()).hexdigest())
    picked = []
    for x, y, kind in candidates:
        if all(math.hypot(x - px, y - py) >= SPACING_M for px, py, _ in picked):
            picked.append((x, y, kind))
            if len(picked) >= MAX_SPOTS:
                break
    out = []
    for x, y, kind in picked:
        lat, lon = proj.to_ll(x, y)
        out.append([round(lon, 6), round(lat, 6), kind])
    return out


def main() -> int:
    campuses = json.loads(CLASSROOMS_FILE.read_text())
    result = {"_attribution": "Map data (c) OpenStreetMap contributors, ODbL"}
    with httpx.Client(headers=REQUEST_HEADERS, timeout=60) as client:
        for campus in campuses:
            if campus.get("secondary"):
                continue
            spots = campus_spots(client, campus)
            print(f"{campus['id']} {campus['name']}: {len(spots)} spots", file=sys.stderr)
            if spots:
                result[campus["id"]] = spots
    OUTPUT_FILE.write_text(json.dumps(result, separators=(",", ":")) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
