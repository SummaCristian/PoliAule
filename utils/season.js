// Seasonal decorations: a holiday's accent, small decorations on the UI and a
// few rare animations, on for a fixed window each year (Halloween: Oct 24 to
// Nov 1; Christmas: Dec 1 to Jan 10).
//
// Which season today falls in is decided by the inline script in index.html,
// before first paint (the date ranges live there), and left in
// window.__seasonByDate; it also sets <html data-season> right away so the
// accent never flashes in. This module turns seasons on and off: the Settings
// toggle, and a season picked from the search (typing one of its keywords
// offers it as the Top Hit, any time of year). It lazy-loads the season's own
// module, so none of it lands in the main bundle, and shows the season's
// banner above the Favourites.
//
// A season module exports start() and stop(), and may register decorators
// for elements other modules build, each called right after building it:
//   'card'       every classroom card (components/classroom-list.js)
//   'folder'     every building folder (components/building-folder.js)
//   'marker'     every building marker on the map (components/campus-map.js)
//   'detail'     the classroom page, each time it renders (components/classroom-detail.js)
//   'searchRow'  every classroom and building row in the search (components/search-overlay.js)
//   'banner'     the season's banner, below (once the module has started)
//   'buildingHeader'  each building's header in the Available results (script.js)
//   'map'        the Campus map, once its style has loaded (components/campus-map.js);
//                kept, so a season started later still gets it
//   'info'       the Info page, each time it renders (components/info-page.js)
//
// A season's `logo` (192px) is its search row's icon and its `hero` (512px)
// the Info page's: both frame the drawing the same way, so the chair is the
// same size in every season.
//
// Adding a season: its date range in index.html, an entry in SEASONS below,
// its strings in the locales (season.<id>.name / bannerTitle / bannerText,
// plus any "<key>@<id>" variants of existing strings, see t() in i18n.js)
// and its CSS under :root[data-season="<id>"]. An entry's `banner()` may
// pick another message for some days: it returns the strings' prefix (in
// place of season.<id>) and the icon.

import { t, applyTranslations } from '../i18n.js';

export const SEASONAL_KEY = 'poliAule_seasonal';
// A season picked from the search, outside its dates. Ignored once another
// season's dates come round, so it can't hide that one.
const OVERRIDE_KEY = 'poliAule_seasonOverride';

export const SEASONS = {
  halloween: {
    load: () => import('../components/halloween.js'),
    icon: 'hgi-ghost',
    logo: '/favicons/halloween/icon-192.png',
    hero: '/favicons/halloween/hero-512.webp',
    tint: '#ff7a2e',
    keywords: ['halloween', 'trick or treat', 'dolcetto o scherzetto', 'spooky', 'pumpkin', 'zucca'],
  },
  christmas: {
    load: () => import('../components/christmas.js'),
    icon: 'hgi-pine-tree',
    logo: '/favicons/christmas/icon-192.png',
    hero: '/favicons/christmas/hero-512.webp',
    tint: '#d6303a',
    keywords: ['christmas', 'xmas', 'natale', 'merry christmas', 'buon natale', 'babbo natale', 'santa', 'santa claus'],
    // Christmas Day, New Year and the Befana (Epiphany) get their own message
    banner() {
      const [, m, d] = milanDay().split('-').map(Number);
      if (m === 12 && d >= 24 && d <= 26) return { key: 'season.christmas.day', icon: 'hgi-gift' };
      if ((m === 12 && d === 31) || (m === 1 && d === 1)) return { key: 'season.christmas.newYear', icon: 'hgi-fireworks' };
      if (m === 1 && d === 6) return { key: 'season.christmas.befana', icon: 'hgi-sparkles' };
      return null;
    },
  },
};

// Today in Milan, YYYY-MM-DD
function milanDay() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
}

let running = null;      // { id, mod } of the season currently started
const decorators = {};
// Long-lived elements handed over with decorateLive(), so a season that starts
// after they were built (picked from the search) still reaches them
const live = {};
const closedBanners = new Set(); // closed this session; back on the next launch

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function write(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage unavailable: lasts until reload */ }
}

export function seasonalEnabled() {
  return read(SEASONAL_KEY) !== 'false';
}

// The season to show now: the one picked from the search, else today's, or
// none when turned off in Settings. Same rule as the inline script.
function currentSeason() {
  if (!seasonalEnabled()) return null;
  const byDate = window.__seasonByDate ?? null;
  const picked = read(OVERRIDE_KEY);
  if (picked && SEASONS[picked] && (!byDate || byDate === picked)) return picked;
  return byDate;
}

// The season currently shown, or null.
export function activeSeason() {
  return document.documentElement.dataset.season || null;
}

// Settings' toggle. Turning it off also drops a season picked from the search.
export function setSeasonalEnabled(on) {
  write(SEASONAL_KEY, String(on));
  if (!on) write(OVERRIDE_KEY, null);
  window.dispatchEvent(new CustomEvent('seasonalchange'));
}

// The search's Top Hit: turns a season on (any time of year) or off.
export function toggleSeason(id) {
  if (activeSeason() === id) {
    write(OVERRIDE_KEY, null);
    // Its own dates: off means off, until turned back on
    if (window.__seasonByDate === id) write(SEASONAL_KEY, 'false');
  } else {
    write(OVERRIDE_KEY, window.__seasonByDate === id ? null : id);
    write(SEASONAL_KEY, 'true');
  }
  window.dispatchEvent(new CustomEvent('seasonalchange'));
}

// The season whose keyword is the whole query (case, accents and extra
// spaces ignored), or null.
export function seasonForQuery(query) {
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ');
  const q = norm(query);
  if (!q) return null;
  for (const [id, season] of Object.entries(SEASONS)) {
    if (season.keywords.some((k) => norm(k) === q)) return id;
  }
  return null;
}

export function setDecorator(kind, fn) {
  decorators[kind] = fn;
  if (live[kind]) fn(...live[kind]);
}

// Called by the module that builds the element, right after building it.
export function decorate(kind, el, data) {
  decorators[kind]?.(el, data);
}

// The same, for an element that lives on (the map): remembered for a season
// that starts later.
export function decorateLive(kind, el, data) {
  live[kind] = [el, data];
  decorate(kind, el, data);
}

// ── Banner ────────────────────────────────────────────────────────────────
// A tinted glass box at the top of the Favourites section with a short
// message for the season. Closing it only lasts until the app is opened
// again, so it isn't remembered anywhere.

function showBanner(id) {
  const host = document.querySelector('#available-classrooms-container > .favourites-section');
  if (!host || host.querySelector(':scope > .season-banner') || closedBanners.has(id)) return;
  const season = SEASONS[id];
  const variant = season.banner?.();
  const key = variant?.key ?? `season.${id}`;
  const icon = variant?.icon ?? season.icon;
  const el = document.createElement('div');
  // liquid-glass: Vitrium's press / stretch physics, like the app's other
  // glass; a press on the close button is left to the button
  el.className = 'season-banner lg-glass lg-glass--clear lg-glass--tinted liquid-glass';
  el.style.setProperty('--season-tint', season.tint);
  el.innerHTML = `
    <i class="hgi-stroke ${icon} season-banner__icon" aria-hidden="true"></i>
    <div class="season-banner__text">
      <p class="season-banner__title" data-i18n="${key}.bannerTitle">${t(`${key}.bannerTitle`)}</p>
      <p class="season-banner__body" data-i18n="${key}.bannerText">${t(`${key}.bannerText`)}</p>
    </div>
    <button type="button" class="season-banner__close" data-i18n-attr="aria-label:season.bannerClose" aria-label="${t('season.bannerClose')}">
      <i class="hgi-stroke hgi-cancel-01" aria-hidden="true"></i>
    </button>
  `;
  el.querySelector('.season-banner__close').addEventListener('click', () => {
    closedBanners.add(id);
    el.remove();
  });
  host.prepend(el);
  decorate('banner', el);
}

function hideBanner() {
  document.querySelector('.season-banner')?.remove();
}

// ── On / off ──────────────────────────────────────────────────────────────

async function apply() {
  const season = currentSeason();
  if (season) document.documentElement.dataset.season = season;
  else delete document.documentElement.dataset.season;

  if (running && running.id !== season) {
    running.mod.stop();
    for (const kind of Object.keys(decorators)) delete decorators[kind];
    running = null;
    hideBanner();
  }
  if (!season || running || !SEASONS[season]) return;
  const mod = await SEASONS[season].load();
  // Turned off again while the module was loading
  if (activeSeason() !== season || running) return;
  running = { id: season, mod };
  mod.start();
  showBanner(season);
}

export function initSeason() {
  apply();
  window.addEventListener('seasonalchange', () => {
    apply();
    // Static strings with a seasonal variant ("…@halloween") swap back or in;
    // the ones built by components follow on their next render
    applyTranslations();
  });
}
