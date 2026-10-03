import { getApiBase } from './config.js';
import { availableTabRooms } from './utils/secondary.js';

// ---------- DATA ----------

// Data fetched from the API will be stored here,
// one entry per day inside the array, starting with 0 = today.
export let classroomsData = [];

// Day of the week to skip. If one of the next 7 days is a
// day listed here, skip to the next day.
// This mirrors what happens in the backend.
export const SKIP_DAYS = [0] // Sunday

// Holiday closures from /v1/opening-hours. Kept apart from building.hours
// because they apply to every building at once. Null until loaded.
let holidayPeriods = null;

// ----------  FETCHING LOGIC ----------

// Extracts the identifier used to key openingHours.buildings/campus_defaults
// from a building's name (e.g. "32.1" -> "32", "B12" -> "B12", "16B" -> "16B").
const BUILDING_ID_RE = /^([a-z]*\d+[a-z]?)/i;

// Mirrors scripts/fetch.py's _building_hours_key(), so both sides resolve
// the same building to the same opening-hours.json entry.
function buildingHoursKey(building) {
  const match = BUILDING_ID_RE.exec(String(building.name ?? ''));
  return (match ? match[1] : String(building.name ?? '')).toUpperCase();
}

// Resolves a building's opening hours: explicit match > campus default > global default.
// Mirrors scripts/fetch.py's resolve_building_hours().
function resolveBuildingHours(building, campusId, openingHours) {
  const key = buildingHoursKey(building);
  if (openingHours.buildings[key]) return openingHours.buildings[key];
  if (openingHours.campus_defaults[campusId]) return openingHours.campus_defaults[campusId];
  return openingHours.default_hours;
}

// The API's JSON responses, kept in Cache Storage with their ETags so the next
// visit can draw from them straight away and then only ask whether they changed
// (If-None-Match -> 304). The browser's HTTP cache isn't used: the API sends
// no-store, so this is the only copy.
const DATA_CACHE_NAME = 'poliaule-data-v1';

export async function openDataCache() {
  try {
    return await caches.open(DATA_CACHE_NAME);
  } catch {
    return null; // no Cache Storage (insecure origin, private mode quirks): plain fetches
  }
}

export async function readCachedJson(cache, url) {
  try {
    const cached = await cache?.match(url);
    return cached ? { data: await cached.json(), etag: cached.headers.get('ETag') } : null;
  } catch {
    return null;
  }
}

// Fetches one endpoint, conditionally when there's a cached copy. `changed` is
// false when the cached copy was confirmed (304) or had to stand in because the
// request failed; without a cached copy a failure throws.
export async function fetchJson(cache, url) {
  const cached = await readCachedJson(cache, url);
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      headers: cached?.etag ? { 'If-None-Match': cached.etag } : {},
    });
    if (res.status === 304 && cached) {
      await res.arrayBuffer(); // drain the empty body, or Chromium logs the request as canceled
      return { data: cached.data, changed: false };
    }
    if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);

    const body = await res.text();
    const data = JSON.parse(body);
    const etag = res.headers.get('ETag');
    if (cache && etag) {
      cache.put(url, new Response(body, { headers: { 'Content-Type': 'application/json', 'ETag': etag } }))
        .catch(() => {});
    }
    return { data, changed: true };
  } catch (error) {
    if (!cached) throw error;
    console.warn(`Using cached ${url}:`, error);
    return { data: cached.data, changed: false };
  }
}

const occupationsListUrl = apiBase => `${apiBase}/v1/occupations`;
const occupationUrl = (apiBase, date) =>
  `${apiBase}/v1/occupations/${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
const openingHoursUrl = apiBase => `${apiBase}/v1/opening-hours`;

// Merges the opening hours into the days and publishes them as classroomsData
function applyClassroomsData(days, openingHours) {
  if (openingHours) {
    holidayPeriods = openingHours.holiday_periods ?? [];
    for (const day of days) {
      for (const campus of day.campuses) {
        for (const building of campus.buildings) {
          building.hours = resolveBuildingHours(building, campus.id, openingHours);
        }
      }
    }
  }
  classroomsData.splice(0, classroomsData.length, ...days);
}

// Fills classroomsData from the copies cached by the last visit, without touching
// the network. Days already past are left out. Returns whether anything was loaded.
export async function loadCachedClassroomsData() {
  const cache = await openDataCache();
  if (!cache) return false;
  const apiBase = getApiBase();

  const list = await readCachedJson(cache, occupationsListUrl(apiBase));
  if (!list) return false;
  const today = formatDateYYYYMMDD(new Date());
  const dates = list.data.dates.filter(date => date >= today);

  const [days, openingHours] = await Promise.all([
    Promise.all(dates.map(date => readCachedJson(cache, occupationUrl(apiBase, date))))
      .then(entries => entries.filter(Boolean).map(entry => entry.data)),
    readCachedJson(cache, openingHoursUrl(apiBase)).then(entry => entry?.data ?? null),
  ]);
  if (!days.length) return false;

  applyClassroomsData(days, openingHours);
  console.log('Cached data loaded:', classroomsData);
  return true;
}

// Fetches the classrooms data from the server (revalidating whatever is cached)
// and stores it in classroomsData. Returns whether it differs from the cached
// copies, i.e. whether a UI drawn from loadCachedClassroomsData() is now stale.
// Concurrent calls share one run.
let inFlightFetch = null;
export function fetchClassroomsData() {
  inFlightFetch ??= fetchClassroomsDataOnce().finally(() => { inFlightFetch = null; });
  return inFlightFetch;
}

async function fetchClassroomsDataOnce() {
  try {
    const cache = await openDataCache();
    const apiBase = getApiBase();
    const list = await fetchJson(cache, occupationsListUrl(apiBase));
    const { dates } = list.data;

    const [days, openingHours] = await Promise.all([
      Promise.allSettled(dates.map(date => fetchJson(cache, occupationUrl(apiBase, date))))
        .then(settled => settled.filter(r => r.status === 'fulfilled').map(r => r.value)),
      fetchJson(cache, openingHoursUrl(apiBase))
        .catch(error => {
          // Non-fatal: fall through with openingHours = null so classroomsData
          // still loads (and gets used) even if opening hours can't be fetched.
          console.error('Error fetching opening hours data:', error);
          return null;
        }),
    ]);

    applyClassroomsData(days.map(day => day.data), openingHours?.data ?? null);
    console.log('All data loaded:', classroomsData);

    // Days the API no longer lists would otherwise sit in the cache forever
    if (cache && list.changed) pruneCachedDays(cache, apiBase, dates);

    return list.changed || !!openingHours?.changed || days.some(day => day.changed);
  } catch (error) {
    console.error('Error fetching classrooms data:', error);
    return false;
  }
}

async function pruneCachedDays(cache, apiBase, dates) {
  try {
    const keep = new Set(dates.map(date => occupationUrl(apiBase, date)));
    const prefix = `${occupationsListUrl(apiBase)}/`;
    for (const request of await cache.keys()) {
      if (request.url.startsWith(prefix) && !keep.has(request.url)) await cache.delete(request);
    }
  } catch {
    // Best effort: a leftover day is only wasted space
  }
}

// ---------- LOGIC ----------

// Returns a list of available classrooms for the 
// given campus, date and time range.
// The query is perfomed on the data previously fetched and 
// stored in classroomsData.
// 
// Classrooms are returned together with a start and end time,
// which represent the time range in which the classroom is available.
// This allows to define 'partial availability', which is 
// useful to return relevant data, 
// especially when full availability is not possible.
export function findAvailableClassrooms(campusId, date, fromTime, toTime) {
  const formattedDate = formatDateYYYYMMDD(new Date(date));

  // Find the day's data
  const dayData = classroomsData.find(day => day.date === formattedDate);
  if (!dayData) {
    console.warn(`No data found for date ${formattedDate}`);
    return [];
  }

  // Find the campus
  const campusData = dayData.campuses.find(c => c.id === campusId);
  if (!campusData) {
    console.warn(`No data found for campus ${campusId} on date ${date}`);
    return [];
  }

  const results = [];

  for (const building of campusData.buildings) {
    // A closed building has no available rooms, whatever its bookings say. One
    // that opens late or closes early only has free time while it's open, so its
    // rooms come out partially free.
    const open = clipToOpeningHours(building, formattedDate, fromTime, toTime);
    if (!open) continue;

    const availableRooms = [];

    for (const classroom of availableTabRooms(campusId, building)) {
      const freeSlots = getFreeSlots(classroom.occupancy, open.from, open.to);
      if (freeSlots.length > 0) {
        const isFree = freeSlots.length === 1
          && freeSlots[0].start === fromTime
          && freeSlots[0].end === toTime;
        availableRooms.push({
          id: classroom.id,
          name: classroom.name,
          status: isFree ? 'free' : 'partially-free',
          features: classroom.features ?? [],
          occupancy: classroom.occupancy ?? [],
          slots: freeSlots,
          idfoto: classroom.idfoto ?? null,
        });
      }
    }

    const STATUS_ORDER = { 'free': 0, 'partially-free': 1, 'not-free': 2 };
    availableRooms.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

    if (availableRooms.length > 0) {
      results.push({
        building: building,
        rooms: availableRooms,
      });
    }
  }

  return results;
}

// Share (0–1) of the campus's classrooms that are free for the whole of each
// { from, to } window on `date` ("YYYY-MM-DD"), for the time picker's hourly
// cells. Same rules as findAvailableClassrooms(): a room counts only if its
// building is open for all of the window and nothing is booked in it.
// Null when there's no data for that day or campus.
export function getFreeShareBySlot(campusId, date, windows) {
  const formattedDate = formatDateYYYYMMDD(new Date(date));
  const dayData = classroomsData.find(day => day.date === formattedDate);
  const campusData = dayData?.campuses.find(c => c.id === campusId);
  if (!campusData) return null;

  const rooms = campusData.buildings.flatMap(building =>
    availableTabRooms(campusId, building).map(classroom => ({ building, classroom })));
  if (!rooms.length) return null;

  return windows.map(({ from, to }) => {
    let free = 0;
    for (const { building, classroom } of rooms) {
      const open = clipToOpeningHours(building, formattedDate, from, to);
      if (!open || open.from !== from || open.to !== to) continue;
      const freeSlots = getFreeSlots(classroom.occupancy ?? [], from, to);
      if (freeSlots.length === 1 && freeSlots[0].start === from && freeSlots[0].end === to) free++;
    }
    return free / rooms.length;
  });
}

// ---------- HELPERS ----------

// Formats Date objects in the format used by the API (YYYYMMDD)
function formatDateYYYYMMDD(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

// A building's opening hours on dateKey ("YYYYMMDD"), one of:
//   null              its hours never loaded, so treat it as always open (a
//                     failed /v1/opening-hours fetch mustn't hide every room)
//   { closed: true }  a holiday, or a weekday it never opens
//   { opens, closes } "HH:MM" strings
export function getBuildingOpening(building, dateKey) {
  const hours = building?.hours;
  if (!hours) return null;

  const isoDate = `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`;
  if (holidayPeriods?.some(p => p.start <= isoDate && isoDate <= p.end)) return { closed: true };

  const dow = new Date(isoDate + 'T00:00').getDay(); // 0 = Sunday
  const range = hours[dow === 0 ? 'sun' : dow === 6 ? 'sat' : 'mon_fri'];
  if (!range) return { closed: true };

  return { opens: range[0], closes: range[1] };
}

// Narrows [fromTime, toTime] to the part the building is open for on dateKey,
// as { from, to }. Null when it's closed for all of it.
function clipToOpeningHours(building, dateKey, fromTime, toTime) {
  const opening = getBuildingOpening(building, dateKey);
  if (!opening) return { from: fromTime, to: toTime };
  if (opening.closed) return null;

  const from = fromTime > opening.opens ? fromTime : opening.opens;
  const to = toTime < opening.closes ? toTime : opening.closes;
  return from < to ? { from, to } : null;
}

// Returns the free time slots within [fromTime, toTime]
// given an array of occupancy slots from the JSON.
function getFreeSlots(occupancy, fromTime, toTime) {
  const freeSlots = [];
  let cursor = fromTime;

  // Sort occupancy just in case it isn't already
  const sorted = [...occupancy]
    .map(s => ({ start: s.inizio, end: s.fine }))
    .sort((a, b) => a.start.localeCompare(b.start));

  for (const slot of sorted) {
    if (slot.end <= cursor) continue;      // slot entirely before our window
    if (slot.start >= toTime) break;       // slot entirely after our window

    if (slot.start > cursor) {
      // free gap before this occupied slot
      freeSlots.push({ start: cursor, end: slot.start });
    }
    cursor = slot.end > cursor ? slot.end : cursor;
  }

  // free gap after the last occupied slot
  if (cursor < toTime) {
    freeSlots.push({ start: cursor, end: toTime });
  }

  return freeSlots;
}

/**
 * Given a classroom's occupancy slots and a reference instant (Date), returns
 * the availability status relative to that instant.
 * Possible return values: 'free', 'occupied', 'free-soon', 'occupied-soon'.
 */
export function computeClassroomStatus(occupancy, refDate) {
  const slots = occupancy ?? [];
  const currentTime = `${String(refDate.getHours()).padStart(2, '0')}:${String(refDate.getMinutes()).padStart(2, '0')}`;

  const isOccupiedNow = slots.some(slot => currentTime >= slot.inizio && currentTime < slot.fine);

  const thirtyMinsLater = new Date(refDate.getTime() + 30 * 60 * 1000);
  const thirtyMinsLaterTime = `${String(thirtyMinsLater.getHours()).padStart(2, '0')}:${String(thirtyMinsLater.getMinutes()).padStart(2, '0')}`;

  if (isOccupiedNow) {
    // Check if it will be free within 30 mins
    const currentSlot = slots.find(slot => currentTime >= slot.inizio && currentTime < slot.fine);
    // If current slot ends within 30 mins AND no other slot starts before that 30 min window ends
    if (currentSlot.fine < thirtyMinsLaterTime) {
      const nextOccupancy = slots.some(slot => slot.inizio >= currentSlot.fine && slot.inizio < thirtyMinsLaterTime);
      if (!nextOccupancy) {
        return 'free-soon';
      }
    }
    return 'occupied';
  } else {
    // Currently free. Check if it will be occupied within 30 mins.
    const nextOccupancy = slots.some(slot => slot.inizio > currentTime && slot.inizio < thirtyMinsLaterTime);
    if (nextOccupancy) {
      return 'occupied-soon';
    }
    return 'free';
  }
}

/**
 * Returns the current availability status of a classroom relative to NOW.
 * Possible return values: 'free', 'occupied', 'free-soon', 'occupied-soon',
 * 'closed' (its building is closed right now), or null if no data.
 */
// Each loaded day's rooms by id, with their building, so a status lookup is one
// Map hit instead of a walk over every campus: lists and the search call it once
// per room shown. Keyed by the day object, so a refresh (which brings new day
// objects) starts a new index and the old one is dropped with its day.
const roomIndexes = new WeakMap();

function roomsById(dayData) {
  let index = roomIndexes.get(dayData);
  if (!index) {
    index = new Map();
    for (const campus of dayData.campuses) {
      for (const building of campus.buildings) {
        for (const classroom of building.classrooms) {
          // First one wins, as the linear search it replaces did
          const key = String(classroom.id);
          if (!index.has(key)) index.set(key, { classroom, building });
        }
      }
    }
    roomIndexes.set(dayData, index);
  }
  return index;
}

export function getClassroomStatusNow(classroomId) {
  if (!classroomsData || classroomsData.length === 0) return null;

  const now = new Date();
  const dateKey = formatDateYYYYMMDD(now);

  // Find today's data
  const dayData = classroomsData.find(day => day.date === dateKey);
  if (!dayData) return null;

  const entry = roomsById(dayData).get(String(classroomId));
  if (!entry) return null;
  const { classroom, building } = entry;

  const opening = getBuildingOpening(building, dateKey);
  if (opening) {
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    if (opening.closed || currentTime < opening.opens || currentTime >= opening.closes) return 'closed';
  }

  // No source had its schedule today (scripts/fetch.py): unknown, not free.
  if (classroom.occupancy == null) return null;
  return computeClassroomStatus(classroom.occupancy, now);
}

// A classroom and its building as they are on dateKey ("YYYYMMDD"), or null
// when that day isn't loaded or the room isn't in it.
export function getClassroomOnDay(classroomId, dateKey) {
  const dayData = classroomsData?.find(day => day.date === dateKey);
  return dayData ? roomsById(dayData).get(String(classroomId)) ?? null : null;
}

const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const toHHMM = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

/**
 * What a classroom card's small timeline shows. With fromTime/toTime, it is
 * that queried range on dateKey ("YYYYMMDD"); without, a window around now
 * (30 min back, 90 ahead, kept inside the day) on today. Returns null when
 * there's no data for that day, or the room's schedule that day is unknown.
 *
 *   { from, to }   the window, in minutes since midnight
 *   busy           [[start, end]] booked spans inside it, merged
 *   closed         [[start, end]] spans the building is closed inside it
 *   now            minutes since midnight when now falls inside it, else null
 *   nextChange     "HH:MM" of the first free <-> busy switch after now (null
 *                  without a now): what "From 11:15" / "Until 11:30" show
 */
export function getClassroomTimeline(classroomId, dateKey = null, fromTime = null, toTime = null) {
  if (!classroomsData || classroomsData.length === 0) return null;

  const nowDate = new Date();
  const todayKey = formatDateYYYYMMDD(nowDate);
  const key = dateKey ?? todayKey;
  const dayData = classroomsData.find(day => day.date === key);
  if (!dayData) return null;

  const entry = roomsById(dayData).get(String(classroomId));
  if (!entry) return null;
  const { classroom, building } = entry;
  if (classroom.occupancy == null) return null; // schedule unknown that day

  const nowMins = nowDate.getHours() * 60 + nowDate.getMinutes();
  let from, to;
  if (fromTime && toTime) {
    from = toMinutes(fromTime);
    to = toMinutes(toTime);
  } else {
    from = Math.min(Math.max(nowMins - 30, 0), 24 * 60 - 120);
    to = from + 120;
  }
  if (to <= from) return null;

  const clip = ([s, e]) => [Math.max(s, from), Math.min(e, to)];
  const inside = ([s, e]) => s < e;

  const busy = [];
  const sorted = (classroom.occupancy ?? [])
    .map(s => [toMinutes(s.inizio), toMinutes(s.fine)])
    .sort((a, b) => a[0] - b[0]);
  for (const span of sorted) {
    const last = busy[busy.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else busy.push([...span]);
  }

  const opening = getBuildingOpening(building, key);
  let closed = [];
  if (opening?.closed) closed = [[from, to]];
  else if (opening) closed = [[0, toMinutes(opening.opens)], [toMinutes(opening.closes), 24 * 60]];

  const now = key === todayKey && nowMins >= from && nowMins <= to ? nowMins : null;

  let nextChange = null;
  if (now !== null) {
    const current = busy.find(([s, e]) => s <= now && now < e);
    const next = current ? current[1] : busy.find(([s]) => s > now)?.[0];
    if (next !== undefined && next < 24 * 60) nextChange = toHHMM(next);
  }

  return {
    from,
    to,
    busy: busy.map(clip).filter(inside),
    closed: closed.map(clip).filter(inside),
    now,
    nextChange,
  };
}

/**
 * Builds the data for the "zoom out" building overview: every building in the
 * given campus on the given date, each with a per-status classroom count.
 *
 * The status is computed over the queried [fromTime, toTime] window, using
 * the same free-slot logic as findAvailableClassrooms(), so the counts match
 * what the classrooms grid below is showing for that same query (free /
 * partially-free / occupied) instead of a snapshot at a single instant.
 *
 * Returns [{ building, counts: {free, 'partially-free', occupied}, rooms }]
 * in the campus's building order, `rooms` being every classroom with its
 * status over that window ([{ classroom, status }], for the folder's cards).
 */
export function getCampusBuildingsOverview(campusId, date, fromTime, toTime) {
  const formattedDate = formatDateYYYYMMDD(new Date(date));
  const dayData = classroomsData.find(day => day.date === formattedDate);
  if (!dayData) return [];

  const campusData = dayData.campuses.find(c => c.id === campusId);
  if (!campusData) return [];

  // Closed buildings are left out and free time is cut to opening hours, as
  // findAvailableClassrooms() does for the results. So are buildings with
  // nothing bookable (utils/secondary.js).
  return campusData.buildings.flatMap(building => {
    const bookable = availableTabRooms(campusId, building);
    if (!bookable.length) return [];
    const open = clipToOpeningHours(building, formattedDate, fromTime, toTime);
    if (!open) return [];

    const counts = { 'free': 0, 'partially-free': 0, 'occupied': 0 };
    const rooms = [];
    for (const room of bookable) {
      const freeSlots = getFreeSlots(room.occupancy ?? [], open.from, open.to);
      let status = 'occupied';
      if (freeSlots.length > 0) {
        const isFullyFree = freeSlots.length === 1
          && freeSlots[0].start === fromTime
          && freeSlots[0].end === toTime;
        status = isFullyFree ? 'free' : 'partially-free';
      }
      counts[status]++;
      rooms.push({ classroom: room, status });
    }
    return [{ building, counts, rooms }];
  });
}