history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

const h = location.hostname;
const envLabel = h === 'beta.poliaule.com' ? 'Beta'
               : h === 'poliaule.com'      ? null
               :                             'Local';
if (envLabel) {
  const badge = document.getElementById('env-badge');
  badge.textContent = envLabel;
  badge.removeAttribute('hidden');
}

import {
  classroomsData,
  findAvailableClassrooms,
  fetchClassroomsData,
  SKIP_DAYS
} from './available-rooms-script.js';

import { initSearchTab, classroomsData as staticClassroomsData } from './search-classrooms-script.js';
import { classroomDetail } from './components/classroom-detail.js';
import { infoPage } from './components/info-page.js';

import { initTimePickers } from './components/time-picker.js';
import { initTimeRangeSlider } from './components/time-range-slider.js';
import { setupCampusPicker } from './components/campus-picker.js';

import { haptics, defaultPatterns } from './components/haptics.js';
import { buildCardForClassroom } from './components/classroom-list.js';

import { initI18n, t, getLocale, applyTranslations, onLanguageSwitch, animateI18nElement } from './i18n.js';
import { escapeHtml } from './utils/html.js';
import './components/tooltip.js';
import { initSettings, applyPreferredCampusIfEnabled, applyRememberLastCampusIfEnabled, SHOW_PARTIAL_KEY, INTERVAL_HOURS_KEY, DEFAULT_TAB_KEY, LAST_TAB_KEY, AUTO_SEARCH_KEY, LIVE_SEARCH_KEY, getStartupTabId } from './components/settings.js';

// ---------- SPLASH SCREEN ----------
const _splashStartTime = Date.now();
const _SPLASH_MIN_MS = 300;

function dismissSplash() {
  const overlay = document.getElementById('splash-overlay');
  if (!overlay) return;

  const splashLogo = overlay.querySelector('.splash-logo');
  const realLogo = document.querySelector('.header-logo');
  const isInfo = location.hash === '#info';

  const revealHeader = () =>
    document.querySelectorAll('.splash-header-item')
      .forEach(el => el.classList.add('splash-revealed'));

  if (document.startViewTransition) {
    // --- View Transition path ---
    splashLogo.style.viewTransitionName = 'splash-icon';

    if (isInfo) {
      // Also name the header title/badge so they morph directly into the hero
      const titleEl = document.querySelector('.header-title');
      const badgeEl = document.getElementById('env-badge');
      const tabbar  = document.querySelector('.tabbar');
      if (titleEl) titleEl.style.viewTransitionName = 'info-title';
      if (badgeEl && !badgeEl.hidden) {
        badgeEl.style.lineHeight = '1';
        badgeEl.style.viewTransitionName = 'info-badge';
      }
      if (tabbar) tabbar.style.viewTransitionName = 'classroom-nav';

      const vt = document.startViewTransition(() => {
        splashLogo.style.viewTransitionName = '';
        if (titleEl) titleEl.style.viewTransitionName = '';
        if (badgeEl) { badgeEl.style.lineHeight = ''; badgeEl.style.viewTransitionName = ''; }
        if (tabbar)  tabbar.style.viewTransitionName = '';

        overlay.remove();
        revealHeader();

        // Open info page in this same VT — no second transition needed
        infoPage._applyOpenState('splash-icon');
      });

      vt.finished.then(() => infoPage._clearVtNames()).catch(() => infoPage._clearVtNames());
    } else {
      const vt = document.startViewTransition(() => {
        splashLogo.style.viewTransitionName = '';
        overlay.remove();
        revealHeader();
        realLogo.style.viewTransitionName = 'splash-icon';
      });

      const cleanup = () => { realLogo.style.viewTransitionName = ''; };
      vt.finished.then(cleanup).catch(cleanup);
    }
  } else {
    // --- FLIP fallback ---
    const firstRect = splashLogo.getBoundingClientRect();
    const lastRect  = realLogo.getBoundingClientRect();
    const dx    = (lastRect.left + lastRect.width  / 2) - (firstRect.left + firstRect.width  / 2);
    const dy    = (lastRect.top  + lastRect.height / 2) - (firstRect.top  + firstRect.height / 2);
    const scale = lastRect.height / firstRect.height;

    realLogo.style.opacity = '0';
    overlay.style.pointerEvents = 'none';

    splashLogo.classList.add('splash-logo-flying');
    void splashLogo.offsetWidth;

    splashLogo.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
    overlay.classList.add('splash-hiding');
    revealHeader();

    splashLogo.addEventListener('transitionend', () => {
      realLogo.style.opacity = '';
      overlay.remove();
      if (isInfo) infoPage.checkHash();
    }, { once: true });
  }
}

function showSplashError() {
  const overlay = document.getElementById('splash-overlay');
  if (!overlay) return;
  overlay.classList.add('splash-error');
  overlay.innerHTML = `
    <span class="material-symbols-outlined splash-error-icon">wifi_off</span>
    <p class="splash-error-title">Unable to load</p>
    <p class="splash-error-subtitle">Check your connection and try again.</p>
    <button class="button-primary splash-error-reload" onclick="location.reload()">Reload</button>
  `;
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

    // Always scroll to top on tab change
    window.scrollTo(0, 0);

    // Haptic feedback
    haptics.trigger(defaultPatterns.light)

    // Update active tab and indicator
    document.querySelector(".tab.active")?.classList.remove("active");
    tab.classList.add("active");

    indicator.style.transform = `translateX(${index * 100}%)`;

    // Persist last-used tab when that mode is active
    if (localStorage.getItem(DEFAULT_TAB_KEY) === 'last') {
      localStorage.setItem(LAST_TAB_KEY, targetId);
    }
  });
});

// Apply the startup tab preference
{
  const startupId = getStartupTabId();
  if (startupId !== 'available-classrooms-container') {
    const startupTab = [...tabs].find(t => t.dataset.target === startupId);
    if (startupTab) {
      const idx = [...tabs].indexOf(startupTab);
      showContent(startupId);
      document.querySelector(".tab.active")?.classList.remove("active");
      startupTab.classList.add("active");
      indicator.style.transition = 'none';
      indicator.style.transform = `translateX(${idx * 100}%)`;
      indicator.getBoundingClientRect(); // force reflow
      indicator.style.transition = '';
    }
  }
}

// ---------- BUILDING CARD ----------

// Builds a <li> containing a building card with its room cards inside.
// Returns the element and the next cardIndex for stagger sequencing.
function createBuildingItem(building, rooms, from, to, cardIndex = 0, isToday = false, date = null) {
  const buildingName = building.name;
  const countParts = [
    rooms.filter(r => r.status === 'free').length ? `<span class="building-count free">${rooms.filter(r => r.status === 'free').length} ${t('status.free')}</span>` : '',
    rooms.filter(r => r.status === 'partially-free').length ? `<span class="building-count partially-free">${rooms.filter(r => r.status === 'partially-free').length} ${t('status.partial')}</span>` : '',
    rooms.filter(r => r.status === 'not-free').length ? `<span class="building-count not-free">${rooms.filter(r => r.status === 'not-free').length} ${t('status.occupied')}</span>` : '',
  ].filter(Boolean).join('<span class="building-count-sep">·</span>');

  const buildingCard = document.createElement('div');
  buildingCard.className = 'building-card collapsed';

  // Use current cardIndex for the building's delay only (rooms rendered lazily)
  const buildingIndex = cardIndex++;

  buildingCard.innerHTML = `
    <div class="building-card-header">
      <div class="building-card-header-text">
        <h3 class="building-name">${t('building.prefix')} ${escapeHtml(buildingName)}${building.altName ? ` <small class="building-alt-name">${escapeHtml(building.altName)}</small>` : ''}</h3>
        <div class="building-counts">${countParts}</div>
      </div>
      <span class="material-symbols-outlined building-chevron">expand_more</span>
    </div>
  `;

  const body = document.createElement('div');
  body.className = 'building-card-body';

  const roomsList = document.createElement('ul');
  roomsList.className = 'list-inner-container';

  body.appendChild(roomsList);
  buildingCard.appendChild(body);

  buildingCard.addEventListener('click', (e) => {
    if (!buildingCard.classList.contains('collapsed') && e.target.closest('.building-card-body')) return;
    const isCollapsed = buildingCard.classList.contains('collapsed');

    if (isCollapsed) {
      const scrollContainer = buildingCard.closest('#available-classrooms-results');
      const containerIsScrollable = scrollContainer &&
        ['auto', 'scroll'].includes(getComputedStyle(scrollContainer).overflowY);

      // Snapshot position before DOM changes
      const cardTopBefore = buildingCard.getBoundingClientRect().top;

      rooms.forEach(room => {
        const roomItem = document.createElement('li');
        roomItem.className = 'classroom-list-item-container';
        roomItem.dataset.status = room.status;
        roomItem.appendChild(buildCardForClassroom(room, building, from, to, isToday, date));
        roomsList.appendChild(roomItem);
      });
      if (rooms.every(r => r.status === 'partially-free')) {
        const emptyState = document.createElement('li');
        emptyState.className = 'building-all-partial-hidden';
        emptyState.textContent = t('results.allPartialHidden');
        roomsList.appendChild(emptyState);
      }
      buildingCard.closest('.list-outer-container')
        ?.querySelectorAll('.building-card:not(.collapsed)')
        .forEach(card => {
          if (card !== buildingCard) {
            card.classList.add('collapsed');
            card.querySelector('.list-inner-container').replaceChildren();
          }
        });
      buildingCard.classList.remove('collapsed');
      haptics.trigger(defaultPatterns.light);

      // getBoundingClientRect() forces a synchronous reflow — cardTopAfter reflects
      // the final layout (CSS transitions don't affect layout values, only visuals).
      // Instantly compensate for any shift so the card stays visually in place.
      const cardTopAfter = buildingCard.getBoundingClientRect().top;
      const delta = cardTopAfter - cardTopBefore;
      if (delta !== 0) {
        if (containerIsScrollable) {
          scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollTop + delta);
        } else {
          window.scrollBy(0, delta);
        }
      }

      // Now smooth-scroll the card to the top of the visible area
      requestAnimationFrame(() => {
        if (containerIsScrollable) {
          const top = buildingCard.getBoundingClientRect().top
            - scrollContainer.getBoundingClientRect().top
            + scrollContainer.scrollTop - 8;
          scrollContainer.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
        } else {
          const header = document.querySelector('.header');
          const offset = (header?.offsetHeight ?? 0) + 8;
          const top = buildingCard.getBoundingClientRect().top + window.scrollY - offset;
          window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
        }
      });
    } else {
      buildingCard.classList.add('collapsed');
      haptics.trigger(defaultPatterns.light);
      const onCollapsed = e => {
        if (e.propertyName !== 'grid-template-rows') return;
        body.removeEventListener('transitionend', onCollapsed);
        roomsList.replaceChildren();
      };
      body.addEventListener('transitionend', onCollapsed);
    }
  });

  const li = document.createElement('li');
  li.style.animationDelay = `${Math.min(buildingIndex * 40, 300)}ms`;
  li.appendChild(buildingCard);
  if (rooms.every(r => r.status === 'partially-free')) li.dataset.allPartial = 'true';
  return { li, cardIndex };
}

// ---------- DATA FETCHING ----------

// Triggers the fetching of data as soon as the page loads
document.addEventListener('DOMContentLoaded', async () => {
  // Safety net: if init hangs for any reason (e.g. fonts.ready stalls on bad
  // connectivity), surface the error screen instead of staying stuck forever.
  const _initTimeoutId = setTimeout(showSplashError, 15000);

  try {
    await initI18n();
    applyTranslations();

    initSettings();

    // Init info page overlay immediately — no data dependency
    infoPage.init();

    // Fetch occupancy data and classroom directory in parallel
    await Promise.all([
      fetchClassroomsData(),
      initSearchTab(),
    ]);

    // Init classroom detail overlay (hash routing + VT morph)
    classroomDetail.init(staticClassroomsData);

    // Setup the campus picker with the available ones
    setupCampusPicker(staticClassroomsData);
    applyPreferredCampusIfEnabled();
    applyRememberLastCampusIfEnabled();

    // After fetching, use the data to set the only
    // valid dates into the date picker
    setupDatePicker(classroomsData);
    // Setup the time pickers to ensure valid time ranges
    setupTimePickers();

    initTimePickers();
    initTimeRangeSlider();
    setupLiveSearch();

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

    const autoSearchEnabled = localStorage.getItem(AUTO_SEARCH_KEY) !== 'false';
    if (autoSearchEnabled) {
      document.getElementById('available-classrooms-form').dispatchEvent(
        new Event('submit', { cancelable: true, bubbles: true })
      );
    }

    clearTimeout(_initTimeoutId);
    const elapsed = Date.now() - _splashStartTime;
    const remaining = Math.max(0, _SPLASH_MIN_MS - elapsed);
    setTimeout(dismissSplash, remaining);

  } catch (error) {
    clearTimeout(_initTimeoutId);
    console.error('Initialization failed:', error);
    const elapsed = Date.now() - _splashStartTime;
    const remaining = Math.max(0, _SPLASH_MIN_MS - elapsed);
    setTimeout(showSplashError, remaining);
  }
});

// ---------- FORM 1: AVAILABLE CLASSROOMS ----------
// Setup the 'Available Classrooms' form
document.getElementById('available-classrooms-form').addEventListener('submit', (e) => {
  // Skip default submit behavior since we will handle it with JavaScript
  e.preventDefault();

  // Haptic feedback
  haptics.trigger(defaultPatterns.light);

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
  container.dataset.searched = 'true';
  container.innerHTML = ''; // Clear previous results

  // Find the day entry matching the selected date
  const dateKey = date.replace(/-/g, ''); // "2026-03-16" → "20260316"
  const dayData = classroomsData.find(day => day.date === dateKey) ?? classroomsData[0];

  if (results.length === 0) {
    renderNoResultsClassroomsContainer(container);
    return;
  }

  container.classList.remove('empty');

  // Filter row (rendered only when partial-free filter is needed)
  const filterRow = document.createElement('div');
  filterRow.className = 'results-filter-row';

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
      haptics.trigger(defaultPatterns.light);
      const isActive = toggleBtn.classList.toggle('active');
      container.classList.toggle('hide-partial', !isActive);
      if (!isActive) {
        list.querySelectorAll('li[data-all-partial]').forEach(item => list.appendChild(item));
      } else {
        originalBuildingOrder.forEach(item => list.appendChild(item));
      }
    });
    filterRow.appendChild(toggleBtn);
    container.appendChild(filterRow);
  }

  const list = document.createElement('ul');
  list.className = 'list-outer-container';

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const isToday = date === todayStr;

  let cardIndex = 0;
  results.forEach(buildingResult => {
    const { li, cardIndex: next } = createBuildingItem(buildingResult.building, buildingResult.rooms, from, to, cardIndex, isToday, date);
    cardIndex = next;
    list.appendChild(li);
  });
  originalBuildingOrder = [...list.children];

  container.appendChild(list);

  // Mark the list as appeared after the staggered animation finishes.
  // This avoids re-triggering the animation when returning from the details page
  // or switching back and forth between tabs.
  requestAnimationFrame(() => {
    setTimeout(() => {
      list.classList.add('appeared');
    }, 800);
  });
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

const TIME_MIN_MINS = 7 * 60 + 15;  // 07:15
const TIME_MAX_MINS = 20 * 60 + 15; // 20:15

// Set by setupTimePickers when the current time is after 20:15 (need tomorrow's date)
let preferInitialDate = null;

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
    // Use offsetLeft/offsetWidth/offsetHeight instead of getBoundingClientRect()
    // so that CSS transform animations on ancestor elements (e.g. the tab appear
    // animation's scale(0.95)) don't skew the measurements.
    const paddingLeft = parseFloat(getComputedStyle(container).paddingLeft);
    const x = el.offsetLeft - paddingLeft;

    // Store x as a CSS variable so the shake keyframe can reference it
    indicator.style.setProperty('--indicator-x', `${x}px`);
    indicator.style.width = `${el.offsetWidth}px`;
    indicator.style.height = `${el.offsetHeight}px`;
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
    datePicker.dispatchEvent(new Event('change', { bubbles: true }));

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
      // Auto-select preferred date (tomorrow when after 20:15) or first available
      const preferred = preferInitialDate
        && [...elements].find(el => el.dataset.date === preferInitialDate && !el.classList.contains('date-skipped'));
      const firstAvailable = [...elements].find(el => !el.classList.contains('date-skipped'));
      if (preferred || firstAvailable) selectDateElement(preferred || firstAvailable);

      positionTodayIndicator();

      // Show the container now that dates are populated and positioned
      container.style.opacity = '1';
    });
  });
}

// Sets up the time pickers to ensure that the 'to' time
// is always at least 1 hour after the 'from' time, within 07:15–20:15
function setupTimePickers() {
  const fromPicker = document.getElementById('from-time-picker');
  const toPicker = document.getElementById('to-time-picker');

  function toMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  }

  function formatMins(mins) {
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }

  function formatTime(date) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  fromPicker.addEventListener('input', () => {
    if (!fromPicker.value) return;

    const fromMins = toMinutes(fromPicker.value);
    const minToMins = Math.min(fromMins + 60, TIME_MAX_MINS);
    toPicker.min = formatMins(minToMins);

    if (toPicker.value && toMinutes(toPicker.value) < minToMins) {
      toPicker.value = formatMins(minToMins);
    }
  });

  toPicker.addEventListener('input', () => {
    if (!toPicker.value || !fromPicker.value) return;

    const diffMinutes = toMinutes(toPicker.value) - toMinutes(fromPicker.value);
    if (diffMinutes < 60) {
      const corrected = Math.min(toMinutes(fromPicker.value) + 60, TIME_MAX_MINS);
      toPicker.value = formatMins(corrected);
    }
  });

  // Set initial values
  const intervalHours = parseInt(localStorage.getItem(INTERVAL_HOURS_KEY), 10) || 2;
  const now = new Date();

  // Snap to next :15 slot
  const snapped = new Date(now);
  snapped.setMinutes(15, 0, 0);
  if (now.getMinutes() >= 15) snapped.setHours(snapped.getHours() + 1);

  const snappedMins = snapped.getHours() * 60 + snapped.getMinutes();

  if (snappedMins > TIME_MAX_MINS) {
    // After 20:15 → next non-skipped day at 07:15; signal date picker to advance
    do { snapped.setDate(snapped.getDate() + 1); } while (SKIP_DAYS.includes(snapped.getDay()));
    snapped.setHours(7, 15, 0, 0);
    preferInitialDate = [
      snapped.getFullYear(),
      String(snapped.getMonth() + 1).padStart(2, '0'),
      String(snapped.getDate()).padStart(2, '0'),
    ].join('-');
  } else if (snappedMins < TIME_MIN_MINS) {
    // Before 07:15 → today at 07:15
    snapped.setHours(7, 15, 0, 0);
  }

  let fromMins = snapped.getHours() * 60 + snapped.getMinutes();
  let toMins = fromMins + intervalHours * 60;

  if (toMins > TIME_MAX_MINS) {
    toMins = TIME_MAX_MINS;
    fromMins = Math.max(TIME_MIN_MINS, toMins - Math.max(60, intervalHours * 60));
    // Re-sync snapped object for formatTime(snapped)
    snapped.setHours(Math.floor(fromMins / 60), fromMins % 60, 0, 0);
  }

  const minToMins = Math.min(fromMins + 60, TIME_MAX_MINS);

  fromPicker.value = formatTime(snapped);
  toPicker.value = formatMins(toMins);
  toPicker.min = formatMins(minToMins);
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
    <button id="reload-data-btn" class="button-primary button-secondary data-reload-btn">
      <span class="material-symbols-outlined data-reload-icon">refresh</span>
      <span class="data-reload-label">${t('data.reload')}</span>
    </button>
  `;
  document.getElementById('reload-data-btn').addEventListener('click', reloadOccupancyData);
  if (animate) animateI18nElement(container);
}

async function reloadOccupancyData() {
  const btn = document.getElementById('reload-data-btn');
  if (!btn || btn.disabled) return;

  btn.disabled = true;
  btn.querySelector('.data-reload-icon').classList.add('spinning');
  btn.querySelector('.data-reload-label').textContent = t('data.reloading');

  await fetchClassroomsData();

  const indicator = document.getElementById('data-fetch-indicator');
  indicator.classList.remove('green', 'yellow', 'red');
  setupDataFetchIndicator();
  setupDatePicker(classroomsData);

  const resultsContainer = document.getElementById('available-classrooms-results');
  if (resultsContainer && !resultsContainer.classList.contains('empty')) {
    document.getElementById('available-classrooms-form').dispatchEvent(
      new Event('submit', { cancelable: true, bubbles: true })
    );
  }
}

// ---------- LIVE SEARCH ----------

function setupLiveSearch() {
  const form = document.getElementById('available-classrooms-form');
  const results = document.getElementById('available-classrooms-results');

  function isEnabled() {
    return localStorage.getItem(LIVE_SEARCH_KEY) !== 'false';
  }

  function trigger() {
    if (!isEnabled() || !classroomsData.length || !results.dataset.searched) return;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }

  let debounceTimer = null;
  function triggerDebounced() {
    if (!isEnabled()) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(trigger, 320);
  }

  document.addEventListener('campuschange', trigger);
  document.getElementById('date-picker').addEventListener('change', trigger);
  document.getElementById('from-time-picker').addEventListener('input', triggerDebounced);
  document.getElementById('to-time-picker').addEventListener('input', triggerDebounced);
}

