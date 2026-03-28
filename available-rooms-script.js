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
  // Days to fetch (today + next 6 days)
  const dates = [];
  const cursor = new Date(); // Today

  // Get the next 7 days, skipping the ones in SKIP_DAYS
  while (dates.length < 7) {
    if (!SKIP_DAYS.includes(cursor.getDay())) {
      dates.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  // Fetch all days in parallel and store the results in classroomsData
  try {
    classroomsData = (await Promise.allSettled(
      dates.map(date =>
        fetch(`/occupancy/occupation_${formatDateYYYYMMDD(date)}.json`)
          .then(res => {
            if (!res.ok) throw new Error(`Failed to load ${formatDateYYYYMMDD(date)}: ${res.status}`);
            return res.json();
          })
      )
    ))
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);
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
        });
      }
    }

    const STATUS_ORDER = { 'free': 0, 'partially-free': 1, 'not-free': 2 };
    availableRooms.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);

    if (availableRooms.length > 0) {
      results.push({
        building: { id: building.name, name: building.name },
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