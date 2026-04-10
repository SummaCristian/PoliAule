import {
  classroomsData,
  findAvailableClassrooms,
  fetchClassroomsData,
  SKIP_DAYS
} from './available-rooms-script.js';

import { initSearchTab } from './search-classrooms-script.js';

import { initTimePickers } from './components/time-picker.js';
import { setupCampusPicker } from './components/campus-picker.js';

import { haptics, defaultPatterns } from './components/haptics.js';
import { buildCardForClassroom } from './components/classroom-list.js';

import { initI18n, t, getLocale, applyTranslations, onLanguageSwitch, animateI18nElement } from './i18n.js';
import { initSettings, applyPreferredCampusIfEnabled, applyRememberLastCampusIfEnabled, AUTO_COLLAPSE_KEY, SHOW_PARTIAL_KEY, INTERVAL_HOURS_KEY } from './components/settings.js';

// ---------- SPLASH SCREEN ----------
const _splashStartTime = Date.now();
const _SPLASH_MIN_MS = 300;

function dismissSplash() {
  const overlay = document.getElementById('splash-overlay');
  if (!overlay) return;

  const splashLogo = overlay.querySelector('.splash-logo');
  const realLogo = document.querySelector('.header-logo');

  // FLIP: measure First (splash, centered) and Last (header) positions
  const firstRect = splashLogo.getBoundingClientRect();
  const lastRect = realLogo.getBoundingClientRect();

  // FLIP: center-to-center translation (transform-origin is center by default)
  const dx = (lastRect.left + lastRect.width / 2) - (firstRect.left + firstRect.width / 2);
  const dy = (lastRect.top + lastRect.height / 2) - (firstRect.top + firstRect.height / 2);
  const scale = lastRect.height / firstRect.height;

  // Hide the real header logo so the flying one appears to be it
  realLogo.style.opacity = '0';

  // Allow interaction with the UI underneath while the logo is flying
  overlay.style.pointerEvents = 'none';

  // Force a style flush so the transition is active when we set the transform
  splashLogo.classList.add('splash-logo-flying');
  void splashLogo.offsetWidth;

  // Start everything simultaneously: logo flies, background fades, header reveals
  splashLogo.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
  overlay.classList.add('splash-hiding');
  document.querySelectorAll('.splash-header-item')
    .forEach(el => el.classList.add('splash-revealed'));

  // The moment the logo lands: restore the real header logo and remove the overlay
  splashLogo.addEventListener('transitionend', () => {
    realLogo.style.opacity = '';
    overlay.remove();
  }, { once: true });
}

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

  const header = document.querySelector('.header');
  const setHeaderHeight = () =>
    document.documentElement.style.setProperty('--header-height', `${header.offsetHeight}px`);
  setHeaderHeight();
  new ResizeObserver(setHeaderHeight).observe(header);
})

document.querySelectorAll('.button-primary').forEach(btn => {
  btn.addEventListener('touchend', () => { }, { passive: true });
});

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
      requestAnimationFrame(() => container.classList.add('visible'));
    } else {
      container.classList.remove('visible');
    }
  });
}

// Assign click handlers to tabs
tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => {

    // Show the corresponding content
    const targetId = tab.dataset.target;
    showContent(targetId);

    // Haptic feedback
    haptics.trigger(defaultPatterns.success)

    // Update active tab and indicator
    document.querySelector(".tab.active")?.classList.remove("active");
    tab.classList.add("active");

    indicator.style.transform = `translateX(${index * 100}%)`;
  });
});

// ---------- BUILDING CARD ----------

// Builds a <li> containing a building card with its room cards inside.
// Returns the element and the next cardIndex for stagger sequencing.
function createBuildingItem(buildingName, rooms, from, to, cardIndex = 0, isToday = false) {
  const counts = { free: 0, 'partially-free': 0, 'not-free': 0 };
  rooms.forEach(r => { if (r.status in counts) counts[r.status]++; });

  const countParts = [
    counts['free']           ? `<span class="building-count free">${counts['free']} ${t('status.free')}</span>` : '',
    counts['partially-free'] ? `<span class="building-count partially-free">${counts['partially-free']} ${t('status.partial')}</span>` : '',
    counts['not-free']       ? `<span class="building-count not-free">${counts['not-free']} ${t('status.occupied')}</span>` : '',
  ].filter(Boolean).join('<span class="building-count-sep">·</span>');

  const buildingCard = document.createElement('div');
  const autoCollapse = localStorage.getItem(AUTO_COLLAPSE_KEY) === 'true';
  buildingCard.className = autoCollapse ? 'building-card collapsed' : 'building-card';
  buildingCard.innerHTML = `
    <div class="building-card-header">
      <div class="building-card-header-text">
        <h3 class="building-name">${buildingName}</h3>
        <div class="building-counts">${countParts}</div>
      </div>
      <span class="material-symbols-outlined building-chevron">expand_more</span>
    </div>
  `;

  const body = document.createElement('div');
  body.className = 'building-card-body';

  const roomsList = document.createElement('ul');
  roomsList.className = 'list-inner-container';
  rooms.forEach(room => {
    const roomItem = document.createElement('li');
    roomItem.className = 'classroom-list-item-container';
    roomItem.dataset.status = room.status;
    roomItem.style.animationDelay = `${Math.min(cardIndex * 40, 300)}ms`;
    roomItem.innerHTML = buildCardForClassroom(room, from, to, isToday);
    cardIndex++;
    roomsList.appendChild(roomItem);
  });

  body.appendChild(roomsList);
  buildingCard.appendChild(body);

  buildingCard.querySelector('.building-card-header').addEventListener('click', () => {
    buildingCard.classList.toggle('collapsed');
    haptics.trigger(defaultPatterns.success);
  });

  const li = document.createElement('li');
  li.appendChild(buildingCard);
  if (rooms.every(r => r.status === 'partially-free')) li.dataset.allPartial = 'true';
  return { li, cardIndex };
}

// ---------- DATA FETCHING ----------

// Triggers the fetching of data as soon as the page loads
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await initI18n();
    applyTranslations();

    initSettings();

    // Fetch occupancy data and classroom directory in parallel
    await Promise.all([
      fetchClassroomsData(),
      initSearchTab(),
    ]);

    // Setup the campus picker with the available ones
    setupCampusPicker();
    applyPreferredCampusIfEnabled();
    applyRememberLastCampusIfEnabled();

    // After fetching, use the data to set the only
    // valid dates into the date picker
    setupDatePicker(classroomsData);
    // Setup the time pickers to ensure valid time ranges
    setupTimePickers();

    initTimePickers();

    // Setup the data fetch indicator and language switch handler immediately —
    // these don't depend on fonts and shouldn't wait for the splash to dismiss
    setupDataFetchIndicator();
    onLanguageSwitch(() => {
      setupDataFetchIndicatorText(true);
      setupDatePicker();
      const container = document.getElementById('available-classrooms-results');
      if (!container.classList.contains('empty')) {
        document.getElementById('available-classrooms-form').dispatchEvent(
          new Event('submit', { cancelable: true, bubbles: true })
        );
      }
    });

    // Wait for fonts so time pickers render correctly, then dismiss splash.
    // By this point all data is fetched and every component is populated.
    await document.fonts.ready;
    document.querySelector('.time-pickers-container').style.opacity = '1';
    document.getElementById('available-classrooms-form').removeAttribute('data-loading');

    const elapsed = Date.now() - _splashStartTime;
    const remaining = Math.max(0, _SPLASH_MIN_MS - elapsed);
    setTimeout(dismissSplash, remaining);

  } catch (error) {
    console.error('Error fetching classrooms data:', error);
  }
});

// ---------- FORM 1: AVAILABLE CLASSROOMS ----------
// Setup the 'Available Classrooms' form
document.getElementById('available-classrooms-form').addEventListener('submit', (e) => {
  // Skip default submit behavior since we will handle it with JavaScript
  e.preventDefault();

  // Haptic feedback
  haptics.trigger(defaultPatterns.success);

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

  // Compute results
  const results = findAvailableClassrooms(campus, date, from, to);

  // Render results
  renderAvailableClassroomsResults(results, date, from, to);
});

// Builds the UI to show the results of the 'Available Classrooms' form submission,
function renderAvailableClassroomsResults(results, date, from, to) {
  const container = document.getElementById('available-classrooms-results');
  container.innerHTML = ''; // Clear previous results

  // Find the day entry matching the selected date
  const dateKey = date.replace(/-/g, ''); // "2026-03-16" → "20260316"
  const dayData = classroomsData.find(day => day.date === dateKey) ?? classroomsData[0];

  if (results.length === 0) {
    renderNoResultsClassroomsContainer(container);
    return;
  }

  container.classList.remove('empty');

  // Filter row (always rendered)
  const filterRow = document.createElement('div');
  filterRow.className = 'results-filter-row';

  // Collapse-all toggle — initial state driven by Auto Collapse setting
  const autoCollapse = localStorage.getItem(AUTO_COLLAPSE_KEY) === 'true';
  const collapseBtn = document.createElement('button');
  collapseBtn.className = 'results-filter-btn active';
  if (autoCollapse) {
    collapseBtn.dataset.state = 'collapsed';
    collapseBtn.innerHTML = `<span class="material-symbols-outlined">unfold_more</span> ${t('results.expandAll')}`;
  } else {
    collapseBtn.innerHTML = `<span class="material-symbols-outlined">unfold_less</span> ${t('results.collapseAll')}`;
  }
  collapseBtn.addEventListener('click', () => {
    const allCollapsed = collapseBtn.dataset.state === 'collapsed';
    container.querySelectorAll('.building-card').forEach(card => {
      card.classList.toggle('collapsed', !allCollapsed);
    });
    collapseBtn.dataset.state = allCollapsed ? '' : 'collapsed';
    collapseBtn.innerHTML = allCollapsed
      ? `<span class="material-symbols-outlined">unfold_less</span> ${t('results.collapseAll')}`
      : `<span class="material-symbols-outlined">unfold_more</span> ${t('results.expandAll')}`;
  });
  filterRow.appendChild(collapseBtn);

  // Partial-free filter toggle — initial state driven by Show Partially Free setting
  const showPartialSaved = localStorage.getItem(SHOW_PARTIAL_KEY);
  const showPartialDefault = showPartialSaved === null ? true : showPartialSaved === 'true';
  const hasPartial = results.some(b => b.rooms.some(r => r.status === 'partially-free'));
  let originalBuildingOrder = [];
  if (hasPartial) {
    const toggleBtn = document.createElement('button');
    toggleBtn.className = showPartialDefault ? 'results-filter-btn active' : 'results-filter-btn';
    toggleBtn.innerHTML = `<span class="material-symbols-outlined">filter_alt</span> ${t('results.filterPartial')}`;
    if (!showPartialDefault) container.classList.add('hide-partial');
    toggleBtn.addEventListener('click', () => {
      const isActive = toggleBtn.classList.toggle('active');
      container.classList.toggle('hide-partial', !isActive);
      if (!isActive) {
        list.querySelectorAll('li[data-all-partial]').forEach(item => list.appendChild(item));
      } else {
        originalBuildingOrder.forEach(item => list.appendChild(item));
      }
    });
    filterRow.appendChild(toggleBtn);
  }

  container.appendChild(filterRow);

  const list = document.createElement('ul');
  list.className = 'list-outer-container';

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const isToday = date === todayStr;

  let cardIndex = 0;
  results.forEach(building => {
    const { li, cardIndex: next } = createBuildingItem(building.building.name, building.rooms, from, to, cardIndex, isToday);
    cardIndex = next;
    list.appendChild(li);
  });
  originalBuildingOrder = [...list.children];

  container.appendChild(list);
}

// Render the error state for the Available Classrooms results container
function renderNoResultsClassroomsContainer(container) {
  container.classList.add('empty');

  container.innerHTML = `
    <span class="material-symbols-outlined empty-container-icon">search_off</span>
    <p class="empty-container-title">${t('results.noResultsTitle')}</p>
    <p class="empty-container-subtitle">${t('results.noResultsSubtitle')}</p>
  `;
}

// Sets the allowed dates into the date picker,
// and populates the custom UI and the hidden select with the available dates
function setupDatePicker() {
  const datePicker = document.getElementById('date-picker');
  const availableDates = classroomsData.map(day => day.date);
  const toInputFormat = d => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
  const formatLocal = d => [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0')
  ].join('-');

  // --- Populate the date picker UI ---
  const container = document.querySelector('.date-picker-container');
  const indicator = container.querySelector('.date-indicator');

  // Derive single-letter day names from the current locale (Sun=0 … Sat=6).
  const dayFormatter = new Intl.DateTimeFormat(getLocale(), { weekday: 'narrow' });
  const DAY_NAMES = Array.from({ length: 7 }, (_, i) =>
    dayFormatter.format(new Date(2000, 0, 2 + i)) // Jan 2 2000 = Sunday
  );

  // Clear any hardcoded elements, keep only the indicator
  container.querySelectorAll('.date-element-container').forEach(el => el.remove());

  // Generate every day from min to max, including skipped ones
  const allDates = [];
  const parseLocalFromKey = key => {
    const [y, m, d] = [key.slice(0, 4), key.slice(4, 6), key.slice(6, 8)].map(Number);
    return new Date(y, m - 1, d);
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dataStart = parseLocalFromKey(availableDates.at(0));
  const cursor = today < dataStart ? today : dataStart;
  const end = parseLocalFromKey(availableDates.at(-1));

  while (cursor <= end) {
    allDates.push(formatLocal(cursor));
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

  function placeIndicator(el) {
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const paddingLeft = parseFloat(getComputedStyle(container).paddingLeft);
    const x = elRect.left - containerRect.left - paddingLeft;

    // Store x as a CSS variable so the shake keyframe can reference it
    indicator.style.setProperty('--indicator-x', `${x}px`);
    indicator.style.width = `${elRect.width}px`;
    indicator.style.height = `${elRect.height}px`;
    indicator.style.transform = `translateX(${x}px)`;
    indicator.style.opacity = '1';
  }

  function selectDateElement(el) {
    if (el.classList.contains('date-skipped')) {
      // Shake the indicator in place
      indicator.classList.remove('shake');
      void indicator.offsetWidth; // force reflow to restart animation
      indicator.classList.add('shake');
      indicator.addEventListener('animationend', () => indicator.classList.remove('shake'), { once: true });

      // Haptic feedback
      haptics.trigger(defaultPatterns.error);

      return;
    }

    elements.forEach(e => e.classList.remove('active'));
    el.classList.add('active');

    placeIndicator(el);

    datePicker.value = el.dataset.date;

    // Haptic feedback
    haptics.trigger([
      { duration: 30 },
      { delay: 60, duration: 40, intensity: 1 },
    ])

  }

  elements.forEach(el => {
    el.addEventListener('click', () => selectDateElement(el));
  });


  document.getElementById('today-indicator').addEventListener('click', () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayEl = container.querySelector(`.date-element-container[data-date="${todayStr}"]`);
    if (todayEl) selectDateElement(todayEl);
  });

  // Position the "Today" popover above the today cell
  function positionTodayIndicator() {
    const today = new Date();
    const todayStr = formatLocal(today);
    const todayEl = container.querySelector(`.date-element-container[data-date="${todayStr}"]`);
    const todayIndicator = document.getElementById('today-indicator');

    if (!todayEl) {
      todayIndicator.classList.add('hidden');
      return;
    }

    todayIndicator.classList.remove('hidden');

    // Use offsetTop/offsetLeft (layout values) instead of getBoundingClientRect()
    // so that CSS transform animations on ancestor elements (e.g. the tab appear
    // animation's scale(0.95)) don't skew the measurements.
    const cellCenterX = container.offsetLeft + todayEl.offsetLeft + todayEl.offsetWidth / 2;
    const topOffset = container.offsetTop - todayIndicator.offsetHeight - 8;

    todayIndicator.style.left = `${cellCenterX}px`;
    todayIndicator.style.top = `${topOffset}px`;
  }

  function repositionAll() {
    const activeEl = container.querySelector('.date-element-container.active');
    if (activeEl) placeIndicator(activeEl);
    positionTodayIndicator();
  }

  window.addEventListener('resize', repositionAll);
  new ResizeObserver(repositionAll).observe(container.closest('.date-picker'));

  // Apply initial hide-sundays state
  const hideSundaysContainer = container.closest('.date-picker');
  if (localStorage.getItem('poliAule_hideSundays') === 'true') {
    hideSundaysContainer.classList.add('date-picker--hide-sundays');
  }
  window.addEventListener('hidesundayschange', e => {
    hideSundaysContainer.classList.toggle('date-picker--hide-sundays', e.detail.hidden);
    repositionAll();
  });

  // Auto-select today if available, otherwise fall back to the first available date
  // Wait for fonts to load to ensure accurate element measurements
  document.fonts.ready.then(() => {
    requestAnimationFrame(() => {
      // Auto-select the first available (non-skipped) date
      const firstAvailable = [...elements].find(el => !el.classList.contains('date-skipped'));
      if (firstAvailable) selectDateElement(firstAvailable);

      positionTodayIndicator();

      // Show the container now that dates are populated and positioned
      container.style.opacity = '1';
    });
  });
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
  const intervalHours = parseInt(localStorage.getItem(INTERVAL_HOURS_KEY), 10) || 1;
  const now = new Date();
  now.setMinutes(15, 0, 0);
  if (new Date().getMinutes() >= 15) now.setHours(now.getHours() + 1);

  const minTo = new Date(now);
  minTo.setHours(now.getHours() + 1);

  const later = new Date(now);
  later.setHours(now.getHours() + intervalHours);

  fromPicker.value = formatTime(now);
  toPicker.value = formatTime(later);
  toPicker.min = formatTime(minTo);
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

  const generationDate = new Date(classroomsData[0].generated_at + 'Z');
  const generationKey = [
    generationDate.getFullYear(),
    String(generationDate.getMonth() + 1).padStart(2, '0'),
    String(generationDate.getDate()).padStart(2, '0')
  ].join('');

  const hasFutureData = classroomsData.some(entry => entry.date > todayKey);

  if (generationKey === todayKey) {
    // Generated today — fresh
    indicator.classList.add('green');
  } else if (hasFutureData) {
    // Not generated today but still has upcoming days — tolerable
    indicator.classList.add('yellow');
  } else {
    // No future data at all — outdated
    indicator.classList.add('red');
  }

  setupDataFetchIndicatorText();
}

// Setups the text inside the popover shown in the Data Fetch Indicator
function setupDataFetchIndicatorText(animate = false) {
  const container = document.getElementById('data-fetch-indicator-popover-container');

  const states = {
    green: {
      title: t('data.greenTitle'),
      description: t('data.greenDesc'),
    },
    yellow: {
      title: t('data.yellowTitle'),
      description: t('data.yellowDesc'),
    },
    red: {
      title: t('data.redTitle'),
      description: t('data.redDesc'),
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

  const dateLocale = getLocale() === 'it' ? 'it-IT' : 'en-GB';
  const formattedTime = generationDate
    ? generationDate.toLocaleString(dateLocale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Europe/Rome',
    })
    : '—';

  container.innerHTML = `
    <h1 class="popover-title ${status}">${title}</h1>
    <p class="data-status-description secondary">${description}</p>
    <label class="data-status-time secondary">${t('data.lastFetched')}: ${formattedTime}</label>
  `;
  if (animate) animateI18nElement(container);
}

