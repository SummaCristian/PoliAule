// Port of scripts/fetch.py. Mirrors its behavior 1:1 (day selection, rate
// limiting, retries, tag stripping) but writes to an R2 bucket instead of
// the local filesystem. See PoliAule's CLAUDE.md for the data flow this
// replaces.

export interface Env {
  DATA_BUCKET: R2Bucket;
  // Only bound in the beta environment.
  PROD_DATA_BUCKET?: R2Bucket;
  CONFIG_KV?: KVNamespace;
  IS_BETA: boolean;
}

const BASE_URL = "https://onlineservices.polimi.it/maps_rest/rest/ricerca/aula/occupazione";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const NEXT_DAYS_WINDOW = 7;
const DELAY_BETWEEN_CALLS_MS = 500;

const CLASSROOMS_KEY = "classrooms.json";
const OPENING_HOURS_KEY = "opening-hours.json";
const LIST_KEY = "occupancy/list.json";
const occupationKey = (dateStr: string) => `occupancy/occupation_${dateStr}.json`;

// Mirrors FALLBACK_HOLIDAY_PERIODS / FALLBACK_DEFAULT_HOURS in scripts/fetch.py.
const FALLBACK_HOLIDAY_PERIODS = [
  { start: "2025-12-24", end: "2026-01-06" },
  { start: "2025-08-01", end: "2025-08-10" },
];
const FALLBACK_DEFAULT_HOURS: Hours = { mon_fri: ["00:00", "23:59"], sat: ["00:00", "23:59"], sun: null };

// ---------------------------------------------------------------------------
// Types (mirror docs/api.md schemas)
// ---------------------------------------------------------------------------

type HourRange = [string, string];
interface Hours {
  mon_fri: HourRange | null;
  sat: HourRange | null;
  sun: HourRange | null;
}
interface OpeningHours {
  holiday_periods: { start: string; end: string }[];
  buildings: Record<string, Hours>;
  campus_defaults: Record<string, Hours>;
  default_hours: Hours;
}
interface Classroom {
  id: number;
  name: string;
  seats?: number | null;
  accessible_seats?: number | null;
  workstations?: number | null;
  idfoto?: number | null;
  features?: unknown;
}
interface Building {
  name: string;
  altName?: string | null;
  address?: string;
  lat?: number;
  long?: number;
  idEdificio?: number | null;
  classrooms: Classroom[];
}
interface Campus {
  id: string;
  name: string;
  lat: number;
  long: number;
  buildings: Building[];
}

// ---------------------------------------------------------------------------
// Helpers (mirror scripts/fetch.py)
// ---------------------------------------------------------------------------

const HTML_TAG_RE = /<[^>]*>/g;

/** Recursively strips HTML tags from every string in a parsed JSON value. Mirrors strip_tags(). */
function stripTags<T>(value: T): T {
  if (typeof value === "string") return value.replace(HTML_TAG_RE, "") as unknown as T;
  if (Array.isArray(value)) return value.map(stripTags) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = stripTags(v);
    return out as T;
  }
  return value;
}

const BUILDING_ID_RE = /([a-z]*\d+[a-z]?)/i;

function buildingHoursKey(building: Building): string {
  const match = BUILDING_ID_RE.exec(building.name ?? "");
  return (match ? match[1] : building.name ?? "").toUpperCase();
}

function resolveBuildingHours(building: Building, campusId: string, openingHours: OpeningHours): Hours {
  const key = buildingHoursKey(building);
  if (openingHours.buildings[key]) return openingHours.buildings[key];
  if (openingHours.campus_defaults[campusId]) return openingHours.campus_defaults[campusId];
  return openingHours.default_hours;
}

/** weekday: 0 = Sunday ... 6 = Saturday (JS Date convention). */
function isClosedOnWeekday(hours: Hours, weekday: number): boolean {
  if (weekday === 6) return hours.sat === null;
  if (weekday === 0) return hours.sun === null;
  return hours.mon_fri === null;
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function isHoliday(d: Date, openingHours: OpeningHours): boolean {
  const s = toDateStr(d);
  return openingHours.holiday_periods.some((p) => p.start <= s && s <= p.end);
}

function allBuildingsClosed(campuses: Campus[], openingHours: OpeningHours, weekday: number): boolean {
  for (const campus of campuses) {
    for (const building of campus.buildings) {
      const hours = resolveBuildingHours(building, campus.id, openingHours);
      if (!isClosedOnWeekday(hours, weekday)) return false;
    }
  }
  return true;
}

/** Returns the next NEXT_DAYS_WINDOW days starting today, excluding holidays and
 * days every building is closed. Mirrors fetch_days(). */
function fetchDays(campuses: Campus[], openingHours: OpeningHours): Date[] {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const days: Date[] = [];
  let i = 0;
  while (days.length < NEXT_DAYS_WINDOW) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() + i);
    if (isHoliday(d, openingHours)) break;
    if (!allBuildingsClosed(campuses, openingHours, d.getUTCDay())) days.push(d);
    i++;
  }
  return days;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function dateToCompact(d: Date): string {
  return toDateStr(d).replace(/-/g, ""); // YYYYMMDD, matches the current file naming
}

/** Fetches occupancy for a single room on a single date. Returns [] on failure
 * (mirrors fetch_occupancy() returning None -> caller substitutes []). */
async function fetchOccupancy(roomId: number, d: Date): Promise<unknown[]> {
  const url = `${BASE_URL}/${roomId}/${dateToCompact(d)}`;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return stripTags(await res.json()) as unknown[];
    } catch (err) {
      console.warn(`Attempt ${attempt}/${MAX_RETRIES} failed for room ${roomId} on ${toDateStr(d)}: ${err}`);
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS);
    }
  }
  console.warn(`Skipping room ${roomId} on ${toDateStr(d)} after ${MAX_RETRIES} failed attempts.`);
  return [];
}

function pick<T extends object, K extends keyof T>(src: T, keys: K[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) {
    if (src[k] !== undefined && src[k] !== null) out[k] = src[k];
  }
  return out;
}

/** Builds one day's output, mirroring build_output(): same field allowlist,
 * same rate-limited sequential fetch loop. */
async function buildOutput(campuses: Campus[], d: Date): Promise<unknown> {
  const result = [];
  for (const campus of campuses) {
    const campusOut = { ...pick(campus, ["name", "id", "lat", "long"]), buildings: [] as unknown[] };
    for (const building of campus.buildings) {
      const buildingOut = {
        ...pick(building, ["name", "altName", "lat", "long", "idEdificio", "address"]),
        classrooms: [] as unknown[],
      };
      for (const classroom of building.classrooms) {
        const occupancy = await fetchOccupancy(classroom.id, d);
        buildingOut.classrooms.push({
          ...pick(classroom, ["name", "id", "features", "idfoto", "seats", "accessible_seats", "workstations"]),
          occupancy,
        });
        await sleep(DELAY_BETWEEN_CALLS_MS);
      }
      campusOut.buildings.push(buildingOut);
    }
    result.push(campusOut);
  }
  return { generated_at: new Date().toISOString(), date: dateToCompact(d), campuses: result };
}

// ---------------------------------------------------------------------------
// R2 I/O
// ---------------------------------------------------------------------------

async function readJson<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  const obj = await bucket.get(key);
  if (!obj) return null;
  return (await obj.json()) as T;
}

async function writeJson(bucket: R2Bucket, key: string, value: unknown): Promise<void> {
  await bucket.put(key, JSON.stringify(value), { httpMetadata: { contentType: "application/json" } });
}

/** Mirrors load_opening_hours()'s emergency fallback. */
async function loadOpeningHours(bucket: R2Bucket): Promise<OpeningHours> {
  const existing = await readJson<OpeningHours>(bucket, OPENING_HOURS_KEY);
  if (existing) return existing;
  console.warn(`${OPENING_HOURS_KEY} not found in bucket, using hardcoded fallback hours.`);
  return {
    holiday_periods: FALLBACK_HOLIDAY_PERIODS,
    buildings: {},
    campus_defaults: {},
    default_hours: FALLBACK_DEFAULT_HOURS,
  };
}

/** Runs the full fetch pipeline against PoliMi and writes results to `bucket`. */
async function runFetchPipeline(bucket: R2Bucket): Promise<void> {
  const campuses = await readJson<Campus[]>(bucket, CLASSROOMS_KEY);
  if (!campuses) {
    throw new Error(`${CLASSROOMS_KEY} not found in bucket, upload it manually before running this Worker.`);
  }

  const openingHours = await loadOpeningHours(bucket);
  const days = fetchDays(campuses, openingHours);

  if (days.length === 0) {
    console.log("No days to fetch (all within holiday periods or skipped weekdays). Exiting.");
    return;
  }

  console.log(`Fetching occupancy for ${days.length} day(s): ${days.map(toDateStr).join(", ")}`);

  const retainedKeys = new Set(days.map((d) => occupationKey(dateToCompact(d))));
  for (const d of days) {
    const output = await buildOutput(campuses, d);
    await writeJson(bucket, occupationKey(dateToCompact(d)), output);
    console.log(`  Written ${occupationKey(dateToCompact(d))}`);
  }

  // Delete stale occupation objects not in the current retained set (replaces cleanup_old_files()).
  const listed = await bucket.list({ prefix: "occupancy/occupation_" });
  for (const obj of listed.objects) {
    if (!retainedKeys.has(obj.key)) {
      await bucket.delete(obj.key);
      console.log(`  Deleted stale object: ${obj.key}`);
    }
  }

  await writeJson(bucket, LIST_KEY, {
    generated_at: new Date().toISOString(),
    dates: days.map(dateToCompact),
  });
  console.log(`Written date list to ${LIST_KEY}`);
}

/** Beta, flag off: copies every object from the prod bucket into the beta bucket
 * verbatim, with no PoliMi calls, so beta's occupancy data stays exactly as fresh as prod. */
async function copyFromProd(prod: R2Bucket, beta: R2Bucket): Promise<void> {
  let cursor: string | undefined;
  let copied = 0;
  do {
    const listed: R2Objects = await bucket_list(prod, cursor);
    for (const obj of listed.objects) {
      const body = await prod.get(obj.key);
      if (!body) continue;
      await beta.put(obj.key, await body.arrayBuffer(), { httpMetadata: body.httpMetadata });
      copied++;
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  console.log(`Copied ${copied} object(s) from prod bucket to beta bucket.`);
}

function bucket_list(bucket: R2Bucket, cursor?: string): Promise<R2Objects> {
  return bucket.list({ cursor });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(run(env));
  },
  // Manual trigger for local testing and one-off runs (wrangler dev / curl).
  async fetch(_req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    await run(env);
    return new Response("ok");
  },
};

async function run(env: Env): Promise<void> {
  if (env.IS_BETA && env.CONFIG_KV) {
    const enabled = (await env.CONFIG_KV.get("occupancy_backend_enabled")) === "true";
    if (!enabled) {
      if (!env.PROD_DATA_BUCKET) throw new Error("PROD_DATA_BUCKET binding missing on beta environment");
      console.log("Beta backend disabled, copying prod data instead of fetching PoliMi.");
      await copyFromProd(env.PROD_DATA_BUCKET, env.DATA_BUCKET);
      return;
    }
    console.log("Beta backend enabled, running live fetch pipeline against PoliMi.");
  }
  await runFetchPipeline(env.DATA_BUCKET);
}
