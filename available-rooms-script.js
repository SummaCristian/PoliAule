// ---------- DATA ----------

// Data fetched from the API will be stored here,
// one entry per day inside the array, starting with 0 = today.
export let classroomsData = [];

// Day of the week to skip. If one of the next 7 days is a
// day listed here, skip to the next day.
// This mirrors what happens in the backend.
export const SKIP_DAYS = [0] // Sunday

// ----------  FETCHING LOGIC ----------

// Automatically fetch data for today as soon as the page loads
document.addEventListener('DOMContentLoaded', async () => {
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
    classroomsData = await Promise.all(
      dates.map(date =>
        fetch(`/occupancy/occupation_${formatDateYYYYMMDD(date)}.json`)
          .then(res => {
            if (!res.ok) throw new Error(`Failed to load ${formatDateYYYYMMDD(date)}: ${res.status}`);
            return res.json();
          })
      )
    );
    console.log('All data loaded:', classroomsData);
  } catch (error) {
    console.error('Error fetching classrooms data:', error);
  }
});

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
export function findAvailableClassrooms(campus, date, fromTime, toTime) {
  // TODO
}

// ---------- HELPERS ----------

// Formats Date objects in the format used by the API (YYYYMMDD)
function formatDateYYYYMMDD(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}