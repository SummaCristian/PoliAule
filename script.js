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

document.addEventListener('DOMContentLoaded', () => {
  const isSamsungBrowser = /SamsungBrowser/i.test(navigator.userAgent);
  if (isSamsungBrowser) {
    document.documentElement.classList.add('samsung');
  }
})

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

    // Setup the campus picker with the available ones
    setupCampusPicker();

    // After fetching, use the data to set the only
    // valid dates into the date picker
    setupDatePicker(classroomsData);
    // Setup the time pickers to ensure valid time ranges
    setupTimePickers();

    // Setup the data fetch indicator
    setupDataFetchIndicator();
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
  const date = data.get('date'); // comes from the hidden select
  const from = data.get('from');
  const to = data.get('to');

  console.log('Form submitted with:', { campus, date, from, to });

  // Compute results
  const results = findAvailableClassrooms(campus, date, from, to);
  console.log(results);

  // Render results
  renderAvailableClassroomsResults(results, date);
});

// Builds the UI to show the results of the 'Available Classrooms' form submission,
function renderAvailableClassroomsResults(results, date) {
  const container = document.getElementById('available-classrooms-results');
  container.innerHTML = ''; // Clear previous results

  // Find the day entry matching the selected date
  const dateKey = date.replace(/-/g, ''); // "2026-03-16" → "20260316"
  const dayData = classroomsData.find(day => day.date === dateKey) ?? classroomsData[0];

  // Add data generation time info
  const dataInfoMsg = document.createElement('label');
  dataInfoMsg.className = 'secondary';

  const generationDate = new Date(classroomsData[0].generated_at + 'Z');

  const formattedGenerationDate = generationDate.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Europe/Rome', // UTC+1 (or +2 in DST)
  }) + ' at ' + generationDate.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/Rome', // UTC+1 (or +2 in DST)
  });

  // "16 Mar 2026 at 05:14"
  dataInfoMsg.textContent = `Data fetched on ${formattedGenerationDate}`;
  container.appendChild(dataInfoMsg);

  if (results.length === 0) {
    const errorMsg = document.createElement('p');
    errorMsg.className = 'secondary';
    errorMsg.textContent = 'No available classrooms found for the selected criteria.';

    container.appendChild(errorMsg);
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
// and populates the custom UI and the hidden select with the available dates
function setupDatePicker() {
  const datePicker = document.getElementById('date-picker');
  const availableDates = classroomsData.map(day => day.date);
  const toInputFormat = d => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

  // --- Populate the date picker UI ---
  const container = document.querySelector('.date-picker-container');
  const indicator = container.querySelector('.date-indicator');

  const DAY_NAMES = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  // Clear any hardcoded elements, keep only the indicator
  container.querySelectorAll('.date-element-container').forEach(el => el.remove());

  // Generate every day from min to max, including skipped ones
  const allDates = [];
  const cursor = new Date(toInputFormat(availableDates.at(0)));
  const end = new Date(toInputFormat(availableDates.at(-1)));

  while (cursor <= end) {
    allDates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }

  allDates.forEach((dateStr, index) => {
    const date = new Date(dateStr);
    const dayOfWeek = DAY_NAMES[date.getDay()];
    const dayNumber = date.getDate();
    const isSunday = date.getDay() === 0;
    const isSkipped = !availableDates.includes(dateStr.replace(/-/g, ''));

    // Only add valid dates to the hidden select
    if (!isSkipped) {
      datePicker.insertAdjacentHTML('beforeend',
        `<option value="${dateStr}">${dateStr}</option>`
      );
    }

    // Add the visual element regardless, dimming skipped days
    const el = document.createElement('div');
    el.className = `date-element-container${isSkipped ? ' date-skipped' : ''}`;
    el.dataset.date = dateStr;
    el.dataset.index = index;
    el.innerHTML = `
      <span class="date-day-of-week ${isSunday ? 'date-sunday' : ''}">${dayOfWeek}</span>
      <span class="date-number">${dayNumber}</span>
    `;
    container.appendChild(el);
  });

  // --- Indicator logic ---
  const elements = container.querySelectorAll('.date-element-container');

  function selectDateElement(el) {
    if (el.classList.contains('date-skipped')) {
      // Shake the indicator in place
      indicator.classList.remove('shake');
      void indicator.offsetWidth; // force reflow to restart animation
      indicator.classList.add('shake');
      indicator.addEventListener('animationend', () => indicator.classList.remove('shake'), { once: true });
      return;
    }

    elements.forEach(e => e.classList.remove('active'));
    el.classList.add('active');

    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const paddingLeft = parseFloat(getComputedStyle(container).paddingLeft);

    const x = elRect.left - containerRect.left - paddingLeft;

    // Store x as a CSS variable so the shake keyframe can reference it
    indicator.style.setProperty('--indicator-x', `${x}px`);
    indicator.style.width = `${elRect.width}px`;
    indicator.style.height = `${elRect.height}px`;
    indicator.style.transform = `translateX(${x}px)`;

    datePicker.value = el.dataset.date;
  }

  elements.forEach(el => {
    el.addEventListener('click', () => selectDateElement(el));
  });

  // Auto-select today if available, otherwise fall back to the first available date
  // Uses setTimeout to ensure layout is fully painted before measuring element positions
  setTimeout(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayEl = container.querySelector(`.date-element-container[data-date="${todayStr}"]`);
    const fallback = container.querySelector('.date-element-container:not(.date-skipped)');
    selectDateElement(todayEl ?? fallback);
  }, 0);
}

// Sets up the time pickers to ensure that the 'to' time
// is always at least 1 hour after the 'from' time
function setupTimePickers() {
  const fromPicker = document.getElementById('from-time-picker');
  const toPicker = document.getElementById('to-time-picker');

  function toMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  }

  function formatTime(date) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  fromPicker.addEventListener('input', () => {
    if (!fromPicker.value) return;

    const [hours, minutes] = fromPicker.value.split(':').map(Number);
    const minTo = new Date();
    minTo.setHours(hours + 1, minutes);
    toPicker.min = formatTime(minTo);

    if (toPicker.value && toMinutes(toPicker.value) < toMinutes(toPicker.min)) {
      toPicker.value = toPicker.min;
    }
  });

  toPicker.addEventListener('input', () => {
    if (!toPicker.value || !fromPicker.value) return;

    const diffMinutes = toMinutes(toPicker.value) - toMinutes(fromPicker.value);

    if (diffMinutes < 60) {
      const [fromHours, fromMinutes] = fromPicker.value.split(':').map(Number);
      const corrected = new Date();
      corrected.setHours(fromHours + 1, fromMinutes);
      toPicker.value = formatTime(corrected);
    }
  });

  // Set initial values
  const now = new Date();
  now.setMinutes(15, 0, 0);
  if (new Date().getMinutes() >= 15) now.setHours(now.getHours() + 1);

  const later = new Date(now);
  later.setHours(now.getHours() + 1);

  fromPicker.value = formatTime(now);
  toPicker.value = formatTime(later);
  toPicker.min = formatTime(later);
}

function setupDataFetchIndicator() {
  const indicator = document.getElementById('data-fetch-indicator');

  if (!classroomsData.length) {
    indicator.classList.add('red');
    return;
  }

  const today = new Date();
  const todayKey = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0')
  ].join('');

  const firstDate = classroomsData[0].date;
  const generationDate = new Date(classroomsData[0].generated_at + 'Z');
  const generationKey = [
    generationDate.getFullYear(),
    String(generationDate.getMonth() + 1).padStart(2, '0'),
    String(generationDate.getDate()).padStart(2, '0')
  ].join('');

  if (firstDate === todayKey && generationKey === todayKey) {
    // Data starts today and was generated today — fresh
    indicator.classList.add('green');
  } else if (firstDate === todayKey) {
    // Data starts today but was generated on a previous day — stale
    indicator.classList.add('yellow');
  } else {
    // Data doesn't even start from today — outdated
    indicator.classList.add('red');
  }

  setupDataFetchIndicatorText();
}

// Setups the text inside the popover shown in the Data Fetch Indicator
function setupDataFetchIndicatorText() {
  const container = document.getElementById('data-fetch-indicator-popover-container');

  const states = {
    green: {
      title: 'Data is up to date',
      description: 'Classroom availability was fetched today and is currently updated.',
    },
    yellow: {
      title: 'Data may be stale',
      description: 'Classroom availability covers today but was generated on a previous day.',
    },
    red: {
      title: 'Data is outdated',
      description: 'No availability data found for today. Results may not reflect the current schedule.',
    },
  };

  // Derive current status from the indicator's classes
  const indicator = document.getElementById('data-fetch-indicator');
  const status = ['green', 'yellow', 'red'].find(s => indicator.classList.contains(s)) ?? 'red';
  const { title, description } = states[status];

  // Last fetch time
  const generationDate = classroomsData[0]
    ? new Date(classroomsData[0].generated_at + 'Z')
    : null;

  const formattedTime = generationDate
    ? generationDate.toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      timeZone: 'Europe/Rome',
    }) + ' at ' + generationDate.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Europe/Rome',
    })
    : 'Unknown';

  container.innerHTML = `
    <h1 class="popover-title ${status}">${title}</h1>
    <p class="data-status-description secondary">${description}</p>
    <label class="data-status-time secondary">Last fetched: ${formattedTime}</label>
  `;
}

// Initializes the Campus picker, allowing to select only the options actually available
function setupCampusPicker() {
  const campuses = classroomsData[0].campuses;
  const picker = document.getElementById('campus-picker');

  campuses.forEach(campus => {
    if (campus.buildings.length > 0) {
      picker.insertAdjacentHTML('beforeend',
        `<option value="${campus.id}">${campus.name}</option>`
      );
    }
  });
}