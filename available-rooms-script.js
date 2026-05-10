// ---------- DATA ----------

// Data fetched from the API will be stored here,
// one entry per day inside the array, starting with 0 = today.
export let classroomsData = [];

// Day of the week to skip. If one of the next 7 days is a
// day listed here, skip to the next day.
// This mirrors what happens in the backend.
export const SKIP_DAYS = [0] // Sunday

// ----------  FETCHING LOGIC ----------

// Fetches the classrooms data from the server and
// stores it in classroomsData.
export async function fetchClassroomsData() {
  try {
    const listRes = await fetch('/occupancy/list.json');
    if (!listRes.ok) throw new Error(`Failed to load list.json: ${listRes.status}`);
    const { dates } = await listRes.json();

    const results = (await Promise.allSettled(
      dates.map(date =>
        fetch(`/occupancy/occupation_${date}.json`)
          .then(res => {
            if (!res.ok) throw new Error(`Failed to load ${date}: ${res.status}`);
            return res.json();
          })
      )
    ))
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);

    classroomsData.splice(0, classroomsData.length, ...results);
    console.log('All data loaded:', classroomsData);
  } catch (error) {
    console.error('Error fetching classrooms data:', error);
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
    const availableRooms = [];

    for (const classroom of building.classrooms) {
      const freeSlots = getFreeSlots(classroom.occupancy, fromTime, toTime);
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

// ---------- HELPERS ----------

// Formats Date objects in the format used by the API (YYYYMMDD)
function formatDateYYYYMMDD(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
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
 * Returns the current availability status of a classroom relative to NOW.
 * Possible return values: 'free', 'occupied', 'free-soon', 'occupied-soon', or null if no data.
 */
export function getClassroomStatusNow(classroomId) {
  if (!classroomsData || classroomsData.length === 0) return null;

  const now = new Date();
  const dateKey = formatDateYYYYMMDD(now);
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // Find today's data
  const dayData = classroomsData.find(day => day.date === dateKey);
  if (!dayData) return null;

  let classroom = null;
  outer: for (const campus of dayData.campuses) {
    for (const building of campus.buildings) {
      classroom = building.classrooms.find(r => String(r.id) === String(classroomId));
      if (classroom) break outer;
    }
  }

  if (!classroom) return null;

  const occupancy = classroom.occupancy ?? [];
  const isOccupiedNow = occupancy.some(slot => currentTime >= slot.inizio && currentTime < slot.fine);

  const thirtyMinsLater = new Date(now.getTime() + 30 * 60 * 1000);
  const thirtyMinsLaterTime = `${String(thirtyMinsLater.getHours()).padStart(2, '0')}:${String(thirtyMinsLater.getMinutes()).padStart(2, '0')}`;

  if (isOccupiedNow) {
    // Check if it will be free within 30 mins
    const currentSlot = occupancy.find(slot => currentTime >= slot.inizio && currentTime < slot.fine);
    // If current slot ends within 30 mins AND no other slot starts before that 30 min window ends
    if (currentSlot.fine < thirtyMinsLaterTime) {
      const nextOccupancy = occupancy.some(slot => slot.inizio >= currentSlot.fine && slot.inizio < thirtyMinsLaterTime);
      if (!nextOccupancy) {
        return 'free-soon';
      }
    }
    return 'occupied';
  } else {
    // Currently free. Check if it will be occupied within 30 mins.
    const nextOccupancy = occupancy.some(slot => slot.inizio > currentTime && slot.inizio < thirtyMinsLaterTime);
    if (nextOccupancy) {
      return 'occupied-soon';
    }
    return 'free';
  }
}