import {
  classroomsData,
  findAvailableClassrooms,
  fetchClassroomsData,
  SKIP_DAYS
} from './available-rooms-script.js';

// ---------- THEME COLOR META TAGS ----------
const lightMeta = document.querySelector('meta[name="theme-color"][media="(prefers-color-scheme: light)"]');
const darkMeta = document.querySelector('meta[name="theme-color"][media="(prefers-color-scheme: dark)"]');
const mq = window.matchMedia('(prefers-color-scheme: dark)');

function updateThemeColor(e) {
  // Force Safari to re-read by briefly swapping content
  if (e.matches) {
    darkMeta.content = '#1E1E1E';
  } else {
    lightMeta.content = '#ECECEC';
  }
}

mq.addEventListener('change', updateThemeColor);

// ---------- TAB BAR ----------
// Setup the Tab bar to switch between tabs
const tabbar = document.querySelector(".tabbar");
const tabs = document.querySelectorAll(".tab");
const indicator = document.querySelector(".tab-indicator");

const contentContainers = document.querySelectorAll(".tab-content");

tabbar.style.setProperty("--tabs", tabs.length);

// Show a given tab and hide the other(s)
function showContent(targetId) {
  contentContainers.forEach(container => {
    if (container.id === targetId) {
      container.style.display = 'block';
      requestAnimationFrame(() => container.classList.add('visible'));
    } else {
      container.classList.remove('visible');
      container.style.display = 'none'; // hide immediately, no waiting for animationend
    }
  });
}

// Assign click handlers to tabs
tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => {

    // Show the corresponding content
    const targetId = tab.dataset.target;
    showContent(targetId);

    // Update active tab and indicator
    document.querySelector(".tab.active")?.classList.remove("active");
    tab.classList.add("active");

    indicator.style.transform = `translateX(${index * 100}%)`;
  });
});

// ---------- DATA FETCHING ----------

// Triggers the fetching of data as soon as the page loads
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await fetchClassroomsData();
    console.log('All data loaded:', classroomsData);

    // After fetching, use the data to set the only 
    // valid dates into the date picker
    setupDatePicker(classroomsData);
    // Setup the time pickers to ensure valid time ranges
    setupTimePickers();
  } catch (error) {
    console.error('Error fetching classrooms data:', error);
  }
});

// ---------- FORM 1: AVAILABLE CLASSROOMS ----------
// Setup the 'Available Classrooms' form
document.getElementById('available-classrooms-form').addEventListener('submit', (e) => {
  // Skip default submit behavior since we will handle it with JavaScript
  e.preventDefault();

  // Check if data was already fetched
  if (!classroomsData.length) {
    console.warn('Data not yet loaded, please wait...');
    return;
  }

  // Read input data
  const data = new FormData(e.target);
  const campus = data.get('campus');
  const date = data.get('date');
  const from = data.get('from');
  const to = data.get('to');

  console.log('Form submitted with:', { campus, date, from, to });

  // Compute results
  const results = findAvailableClassrooms(campus, date, from, to);
  console.log(results);

  // Render results
  renderAvailableClassroomsResults(results);
});

// Builds the UI to show the results of the 'Available Classrooms' form submission,
function renderAvailableClassroomsResults(results) {
  const container = document.getElementById('available-classrooms-results');
  container.innerHTML = ''; // Clear previous results

  if (results.length === 0) {
    container.textContent = 'No available classrooms found for the selected criteria.';
    return;
  }

  const list = document.createElement('ul');

  results.forEach(building => {
    const buildingItem = document.createElement('li');
    buildingItem.innerHTML = `<h3>${building.building.name}</h3>`;

    const roomsList = document.createElement('ul');
    building.rooms.forEach(room => {
      const roomItem = document.createElement('li');
      roomItem.innerHTML = `<p>${room.name} - Available from ${room.slots[0].start} to ${room.slots[0].end}</p>`;
      roomsList.appendChild(roomItem);
    });

    buildingItem.appendChild(roomsList);
    list.appendChild(buildingItem);
  });

  container.appendChild(list);
}

// Sets the allowed dates into the date picker,
// and setups the handling of SKIP DAYS (e.g. Sunday)
function setupDatePicker() {
  const datePicker = document.getElementById('date-picker');
  const availableDates = classroomsData.map(day => day.date);
  const toInputFormat = d => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

  datePicker.min = toInputFormat(availableDates.at(0)); // First day in array
  datePicker.max = toInputFormat(availableDates.at(-1)); // Last day in array

  // Handle skip days (e.g. Sunday)
  // If the user selects a date that is a skip day, 
  // clear the selection and show a warning
  datePicker.addEventListener('input', () => {
    const selected = new Date(datePicker.value);
    if (SKIP_DAYS.includes(selected.getDay())) {
      datePicker.value = ''; // clear the invalid selection
      alert('Selected date is a skip day. Please choose another date.');
    }
  });
}
// Sets up the time pickers to ensure that the 'to' time 
// is always at least 1 hour after the 'from' time
function setupTimePickers() {
  const fromPicker = document.getElementById('from-time-picker');
  const toPicker = document.getElementById('to-time-picker');

  fromPicker.addEventListener('input', () => {
    if (!fromPicker.value) return;

    const [hours, minutes] = fromPicker.value.split(':').map(Number);
    const minTo = new Date();
    minTo.setHours(hours + 1, minutes);
    toPicker.min = `${String(minTo.getHours()).padStart(2, '0')}:${String(minTo.getMinutes()).padStart(2, '0')}`;

    if (toPicker.value && toPicker.value < toPicker.min) {
      toPicker.value = toPicker.min;
    }
  });

  toPicker.addEventListener('input', () => {
    if (!toPicker.value || !fromPicker.value) return;

    const [fromHours, fromMinutes] = fromPicker.value.split(':').map(Number);
    const [toHours, toMinutes] = toPicker.value.split(':').map(Number);
    const diffMinutes = (toHours * 60 + toMinutes) - (fromHours * 60 + fromMinutes);

    if (diffMinutes < 60) {
      const corrected = new Date();
      corrected.setHours(fromHours + 1, fromMinutes);
      toPicker.value = `${String(corrected.getHours()).padStart(2, '0')}:${String(corrected.getMinutes()).padStart(2, '0')}`;
    }
  });

  // Set initial values
  const now = new Date();
  const later = new Date(now);
  later.setHours(now.getHours() + 1);

  fromPicker.value = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  toPicker.value = `${String(later.getHours()).padStart(2, '0')}:${String(later.getMinutes()).padStart(2, '0')}`;
  toPicker.min = toPicker.value;
}

function roundToNearest15(date) {
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  return date;
}