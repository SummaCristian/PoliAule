import { getLocale } from '../i18n.js';
import { haptics, defaultPatterns } from './haptics.js';
import { classroomsData } from '../available-rooms-script.js';

// Sets the allowed dates into the date picker,
// and populates the custom UI and the hidden select with the available dates.
//
// getPreferInitialDate is a getter (not a plain value) because the caller
// (script.js) computes the "prefer tomorrow after 20:15" date in
// setupTimePickers, which can still be running when this function's deferred
// auto-select callback fires — reading it live avoids a stale-capture bug.
export function setupDatePicker(getPreferInitialDate = () => null) {
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
      const preferInitialDate = getPreferInitialDate();
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
