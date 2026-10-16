import { createMorphPopup, attachLiquidGlass, createButton } from 'vitrium';
import { ownBack } from '../utils/back-stack.js';
import { classroomsData, lastFetchedAt, publishedDates, fetchStatus, formatDateYYYYMMDD } from '../available-rooms-script.js';
import { t, getLocale, animateI18nElement } from '../i18n.js';
import { createTimeFormatter } from '../utils/time-format.js';
import { HIDE_SUNDAYS_KEY } from './settings.js';

// The header's data status: a button whose glyph says what fetching is up to (a
// spinner while it runs, an offline mark with no connection, otherwise a dot
// coloured by how fresh the data is), morphing into a glass card that explains
// it, shows which days are in, and checks for updates. Vitrium's morph popup,
// with the button as its trigger; there is no title bar, so the whole card
// takes the press / drag deform.
//
// Everything is drawn from available-rooms-script.js's state: classroomsData
// and lastFetchedAt for the freshness, fetchStatus (and its 'datafetchstatus'
// event) for what's happening now. script.js calls renderDataStatus() when the
// data is replaced or the language switches, and gives the reload action
// through setDataReload().

// A check that answers at once (304s) would only flash the spinner
const MIN_SPINNER_MS = 700;

const TONE_ICONS = {
  green: 'hgi-tick-02',
  yellow: 'hgi-clock-01',
  red: 'hgi-alert-02',
};

const ISSUE_ICONS = {
  offline: 'hgi-wifi-off-01',
  unreachable: 'hgi-cloud-off',
  server: 'hgi-server-off',
};

let popup = null;
let reload = null;
let textReady = false;   // translations are in (the first renderDataStatus call)
let showSpinner = false;
let spinnerSince = 0;
let spinnerTimer = 0;
let clockTimer = 0;

export function setDataReload(fn) {
  reload = fn;
}

// How fresh the data is: generated today, or covering today but generated
// before, or not covering today at all. Null with no data.
function freshness() {
  if (!classroomsData.length) return null;
  const today = formatDateYYYYMMDD(new Date());
  const generated = new Date((lastFetchedAt ?? classroomsData[0].generated_at) + 'Z');
  if (formatDateYYYYMMDD(generated) === today) return 'green';
  if (classroomsData.some(day => day.date > today)) return 'yellow';
  return 'red';
}

function isOffline() {
  return navigator.onLine === false || fetchStatus.issue === 'offline';
}

// Everything the button and the card show, in one place
function snapshot() {
  const tone = freshness();
  const fetching = showSpinner;
  const offline = isOffline();
  const issue = offline ? 'offline' : fetchStatus.issue;
  const glyph = fetching ? 'spinner' : offline ? 'offline' : 'dot';

  if (!tone) {
    // No data: the headline says what's happening instead
    const key = fetching ? 'loading' : issue ?? 'noData';
    return {
      tone: fetching ? 'neutral' : issue ? 'red' : 'neutral', glyph, fetching, issue,
      hasData: false,
      icon: fetching ? null : ISSUE_ICONS[issue] ?? 'hgi-cloud-download',
      title: t(`data.${key}Title`),
      desc: t(`data.${key}Desc`),
    };
  }

  // Old data while the server answered: it's the server that is behind
  const serverBehind = tone !== 'green' && !issue && !fetching;
  return {
    tone, glyph, fetching, issue,
    hasData: true,
    icon: TONE_ICONS[tone],
    title: t(`data.${tone}Title`),
    desc: t(`data.${tone}Desc`) + (serverBehind ? ` ${t('data.serverBehind')}` : ''),
  };
}

// ---------- Time ----------

// "just now", "12 minutes ago", "3 hours ago" the same day; a date and time
// beyond that, in Rome time like the schedules
function relativeTime(date) {
  if (!date || Number.isNaN(date.getTime())) return '—';
  const locale = getLocale() === 'it' ? 'it-IT' : 'en-GB';
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return t('data.justNow');
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  if (minutes < 12 * 60 && formatDateYYYYMMDD(date) === formatDateYYYYMMDD(new Date())) {
    return rtf.format(-Math.floor(minutes / 60), 'hour');
  }
  const day = date.toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'Europe/Rome' });
  const time = createTimeFormatter({ timeZone: 'Europe/Rome' }).format(date);
  return `${day}, ${time}`;
}

function generatedAt() {
  const raw = lastFetchedAt ?? classroomsData[0]?.generated_at;
  return raw ? new Date(raw + 'Z') : null;
}

// ---------- Button ----------

function renderGlyph(s) {
  const glyph = document.getElementById('data-fetch-indicator');
  if (!glyph) return;
  glyph.dataset.glyph = s.glyph;
  const dot = glyph.querySelector('.pulse-indicator');
  dot.classList.remove('green', 'yellow', 'red');
  if (s.hasData || s.issue) dot.classList.add(s.hasData ? s.tone : 'red');
}

// The button's name carries the state too: its glyph is only a colour or a shape
function renderLabel(s) {
  const label = s.fetching ? t('data.checking') : s.title;
  const btn = document.getElementById('data-fetch-btn');
  btn?.setAttribute('aria-label', `${t('a11y.dataStatus')}: ${label}`);
  popup?.panel.setAttribute('aria-label', btn?.getAttribute('aria-label') ?? '');
}

// ---------- Card ----------

// The days the data covers, from today on: today first even when it's missing
// (that's what makes the data outdated), then every published day, dashed when
// it couldn't be loaded.
function weekHtml(s) {
  const today = formatDateYYYYMMDD(new Date());
  const loaded = new Set(classroomsData.map(day => day.date));
  const hideSundays = localStorage.getItem(HIDE_SUNDAYS_KEY) === 'true';
  const toDate = key => new Date(+key.slice(0, 4), +key.slice(4, 6) - 1, +key.slice(6, 8));
  // Sundays out when the date picker hides them too (Settings), unless it's today
  const dates = [...new Set([today, ...publishedDates.filter(date => date >= today)])]
    .filter(date => date === today || !hideSundays || toDate(date).getDay() !== 0)
    .slice(0, 7);
  const locale = getLocale() === 'it' ? 'it-IT' : 'en-GB';
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' });

  const cells = dates.map(date => {
    const d = toDate(date);
    const name = weekday.format(d).replace('.', '');
    // Glass for the days that are in, tinted for today; a missing day is only an outline
    const missing = !loaded.has(date);
    const classes = ['ds-day', date === today && 'is-today', missing && 'is-missing',
      !missing && 'lg-glass', !missing && date === today && 'lg-glass--tinted']
      .filter(Boolean).join(' ');
    return `<li class="${classes}"><span class="ds-day-name">${name}</span><span class="ds-day-num">${d.getDate()}</span></li>`;
  }).join('');
  return `<ul class="ds-week" aria-label="${t('data.days')}">${cells}</ul>`;
}

// What's happening now: checking, offline, what failed, or when it last checked
function activityHtml(s) {
  let icon, text, kind;
  if (s.fetching) {
    kind = 'busy';
    icon = '<span class="ds-spinner" aria-hidden="true"></span>';
    text = t('data.checking');
  } else if (s.issue) {
    kind = 'issue';
    icon = `<i class="hgi-stroke ${ISSUE_ICONS[s.issue]}" aria-hidden="true"></i>`;
    const { failedDays, requestedDays } = fetchStatus;
    text = s.issue !== 'offline' && failedDays > 0 && failedDays < requestedDays
      ? t('data.partial').replace('{failed}', failedDays).replace('{total}', requestedDays)
      : t(`data.${s.issue}Cached`);
  } else {
    kind = 'idle';
    icon = '<i class="hgi-stroke hgi-checkmark-circle-02" aria-hidden="true"></i>';
    text = fetchStatus.lastCheck
      ? t('data.checked').replace('{time}', relativeTime(fetchStatus.lastCheck))
      : t('data.notChecked');
  }
  return `<div class="ds-activity" data-kind="${kind}">${icon}<span class="ds-activity-text">${text}</span></div>`;
}

// Vitrium's glass button, tinted in the accent like the 404 page's main action.
// Made once and only updated, so a re-render doesn't rebuild its glass.
let reloadBtn = null;

function reloadButton(s) {
  reloadBtn ??= createButton({
    icon: '<i class="hgi-stroke hgi-refresh ds-reload-icon" aria-hidden="true"></i>',
    text: t('data.reload'),
    className: 'ds-reload lg-glass--tinted',
  });
  reloadBtn.disabled = s.fetching;
  reloadBtn.querySelector('.ds-reload-icon').classList.toggle('spinning', s.fetching);
  reloadBtn.querySelector('.lg-button-label').textContent =
    s.fetching ? t('data.reloading') : s.issue ? t('data.retry') : t('data.reload');
  return reloadBtn;
}

function renderCard(s, { animate = false } = {}) {
  const container = document.getElementById('data-fetch-indicator-popover-container');
  if (!container) return;

  const tile = s.icon
    ? `<i class="hgi-stroke ${s.icon}"></i>`
    : '<span class="ds-spinner ds-spinner--tile"></span>';
  const subtitle = s.hasData
    ? `<p class="ds-subtitle">${t('data.published').replace('{time}', relativeTime(generatedAt()))}</p>`
    : '';

  container.dataset.tone = s.tone;
  container.innerHTML = `
    <header class="ds-head">
      <div class="ds-tile lg-glass lg-glass--tinted" aria-hidden="true">${tile}</div>
      <div class="ds-head-text">
        <h2 class="ds-title">${s.title}</h2>
        ${subtitle}
      </div>
    </header>
    <p class="ds-desc">${s.desc}</p>
    ${s.hasData ? weekHtml(s) : ''}
    ${s.hasData ? activityHtml(s) : ''}
  `;
  container.appendChild(reloadButton(s));
  if (animate) animateI18nElement(container);
  fitOpenCard();
}

// The open card was sized to its old content: follow the new one's height
function fitOpenCard() {
  if (!popup?.isOpen) return;
  const { panel, inner } = popup;
  const from = panel.offsetHeight;
  const to = Math.min(inner.scrollHeight, 420);
  if (!from || Math.abs(to - from) < 1) return;
  panel.style.height = `${to}px`;
  panel.animate({ height: [`${from}px`, `${to}px`] }, { duration: 280, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' });
}

// ---------- Rendering ----------

export function renderDataStatus({ animate = false } = {}) {
  textReady = true;
  const s = snapshot();
  renderGlyph(s);
  renderLabel(s);
  renderCard(s, { animate });
}

// The spinner shows as soon as a check starts, and stays at least
// MIN_SPINNER_MS so a quick one still reads as "checked"
function onFetchStatus() {
  clearTimeout(spinnerTimer);
  if (fetchStatus.fetching) {
    if (!showSpinner) spinnerSince = performance.now();
    showSpinner = true;
    update();
    return;
  }
  const left = MIN_SPINNER_MS - (performance.now() - spinnerSince);
  if (showSpinner && left > 0) {
    spinnerTimer = setTimeout(onFetchStatus, left);
    return;
  }
  showSpinner = false;
  update();
}

// Before the translations are in, only the glyph can be drawn
function update() {
  if (textReady) renderDataStatus();
  else renderGlyph(snapshot());
}

function init() {
  const trigger = document.getElementById('data-fetch-btn');
  const container = document.getElementById('data-fetch-indicator-popover-container');
  if (!trigger || !container) return;

  // Back closes the card (utils/back-stack.js)
  const back = ownBack(() => popup.close());
  popup = createMorphPopup({
    trigger, role: 'dialog', label: trigger.getAttribute('aria-label') ?? '', width: 20 * 16,
    onOpen: () => {
      back.push();
      // Relative times move on while the card is open
      if (textReady) renderCard(snapshot());
      clockTimer = setInterval(() => renderCard(snapshot()), 30000);
    },
    onClose: () => {
      back.release();
      clearInterval(clockTimer);
    },
  });
  popup.inner.appendChild(container);
  attachLiquidGlass(popup.panel);
  trigger.addEventListener('click', () => popup.toggle());

  // The card closes into the button, whose spinner then shows the check
  container.addEventListener('click', (e) => {
    if (!e.target.closest('.ds-reload') || fetchStatus.fetching) return;
    popup.close();
    reload?.();
  });

  document.addEventListener('datafetchstatus', onFetchStatus);
  window.addEventListener('offline', update);
  // Back online after a check that failed for being offline: check again
  window.addEventListener('online', () => {
    if (fetchStatus.issue === 'offline' && !fetchStatus.fetching) reload?.();
    update();
  });
  // A fetch may already be under way (script.js starts it before this runs)
  onFetchStatus();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
