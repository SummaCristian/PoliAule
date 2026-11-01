// Seasonal decorations: a holiday's accent, small decorations on the UI and a
// few rare animations, on for a window each year (Halloween: Oct 24 to Nov 1;
// Christmas: Dec 1 to Jan 10). A window is fixed dates, or counted from
// Easter for the moveable feasts (Easter itself: Palm Sunday to Pasquetta).
//
// Which season today falls in is decided by the inline script in index.html,
// before first paint (the date ranges live there), and left in
// window.__seasonByDate; it also sets <html data-season> right away so the
// accent never flashes in. This module turns seasons on and off: the Settings
// toggle, and a season picked from the search (typing one of its keywords
// offers it as the Top Hit, any time of year). It lazy-loads the season's own
// module, so none of it lands in the main bundle, and shows the season's
// banner above the Favourites. A light season has no module: just the
// banner, the search row and whatever its CSS (and locale variants) do.
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
//   'settings'   the Settings page's content, once (components/settings-page.js);
//                kept, as it is built before a season may start
//   'changelog'  the changelog's content, each time it renders, the list or a
//                version's page (components/changelog-page.js)
//   'notFound'   the in-app not-found page, each time it renders, generic or
//                classroom (components/not-found-page.js; not the static 404.html);
//                kept, as it can draw before the season's module has loaded
//
// A season's `logo` (192px) is its search row's icon and its `hero` (512px)
// the Info page's: both frame the drawing the same way, so the chair is the
// same size in every season.
//
// Graduation days are a layer of their own, on top of whatever season is on
// (or none): <html data-graduation> while today is a graduation day at the
// campus picked in the app (utils/graduation.js), with its own module
// (components/graduation.js) registering its own decorators next to the
// season's. Its accent and banner take the season's place; what else it
// replaces is up to the season modules, which check graduationShown().
// Its keywords in the search turn on a preview of it, any day and at any
// campus: the cosmetics only, without the banner (the notes about the
// ceremonies aren't part of the layer, they follow the real days).
//
// Adding a season: its date range in index.html (a range end is a
// [month, day] or a number of days from Easter Sunday), an entry in SEASONS
// below (without `load` for a light season), its strings in the locales
// (season.<id>.name / bannerTitle / bannerText, plus any "<key>@<id>"
// variants of existing strings, see t() in i18n.js) and its CSS under
// :root[data-season="<id>"]. An entry's `banner()` may pick another message
// for some days: it returns the strings' prefix (in place of season.<id>)
// and the icon, and `vars` to fill into them ("{years}") when the message
// has numbers in it.

import { t, applyTranslations, onLanguageSwitch } from '../i18n.js';
import { escapeHtml } from './html.js';
import { graduationOn, graduationCampus, milanDay, initGraduations } from './graduation.js';

export const SEASONAL_KEY = 'poliAule_seasonal';
// A season picked from the search. It wins over today's; turning it off
// falls back to today's season, if any.
const OVERRIDE_KEY = 'poliAule_seasonOverride';

// Easter Sunday of a year (anonymous Gregorian computus) at UTC midnight. The
// inline script in index.html has the same one, which decides the ranges;
// this is for what depends on the day itself (a banner for Easter Sunday).
export function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451), n = h + l - 7 * m + 114;
  return new Date(Date.UTC(year, Math.floor(n / 31) - 1, n % 31 + 1));
}

// How many days Milan's today (or `day`, YYYY-MM-DD) is after that year's
// Easter Sunday: 0 on Easter, 1 on Pasquetta, -7 on Palm Sunday.
export function daysFromEaster(day = milanDay()) {
  const [y, m, d] = day.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - easterSunday(y).getTime()) / 864e5);
}

// The navy of the suits on graduation day, which PoliMi's birthday wears too
// (the accent itself is the CSS tokens of :root[data-graduation], shared)
const NAVY = '#2b4a8c';
// The year the Politecnico was founded (on November 29)
const FOUNDED = 1863;

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
    // Sant'Ambrogio (Milan's patron saint, Dec 7), Christmas Day, New Year and
    // the Befana (Epiphany) get their own message
    banner() {
      const [, m, d] = milanDay().split('-').map(Number);
      if (m === 12 && d === 7) return { key: 'season.christmas.ambrogio', icon: 'hgi-church' };
      if (m === 12 && d >= 24 && d <= 26) return { key: 'season.christmas.day', icon: 'hgi-gift' };
      if ((m === 12 && d === 31) || (m === 1 && d === 1)) return { key: 'season.christmas.newYear', icon: 'hgi-fireworks' };
      if (m === 1 && d === 6) return { key: 'season.christmas.befana', icon: 'hgi-sparkles' };
      return null;
    },
  },
  // Palm Sunday to Pasquetta, so it moves with Easter (see index.html); Easter
  // Sunday and Pasquetta get their own banner
  easter: {
    load: () => import('../components/easter.js'),
    icon: 'hgi-egg',
    logo: '/favicons/easter/icon-192.png',
    hero: '/favicons/easter/hero-512.webp',
    tint: '#8a5bd6',
    keywords: ['pasqua', 'easter', 'buona pasqua', 'happy easter', 'pasquetta', 'uovo di pasqua', 'colomba'],
    banner() {
      const n = daysFromEaster();
      if (n === 0) return { key: 'season.easter.day', icon: 'hgi-flower' };
      if (n === 1) return { key: 'season.easter.monday', icon: 'hgi-tent-tree' };
      return null;
    },
  },
  // The Ambrosian carnival: from Giovedì grasso (the Thursday before Ash
  // Wednesday) to Sabato grasso, the Saturday after it, when Milan's carnival
  // ends (the rest of Italy's ended on Tuesday). Moves with Easter (see
  // index.html: 52 to 43 days before it).
  carnival: {
    load: () => import('../components/carnival.js'),
    icon: 'hgi-mask-theater-01',
    logo: '/favicons/carnival/icon-192.png',
    hero: '/favicons/carnival/hero-512.webp',
    tint: '#d6338a',
    keywords: ['carnevale', 'carnival', 'carnevale ambrosiano', 'coriandoli', 'maschere', 'maschera', 'giovedi grasso', 'martedi grasso', 'sabato grasso'],
    banner() {
      const n = daysFromEaster();
      if (n === -52) return { key: 'season.carnival.giovedi', icon: 'hgi-party' };
      if (n === -47) return { key: 'season.carnival.martedi', icon: 'hgi-party-popper' };
      // Ash Wednesday to Friday: Lent elsewhere, still carnival in Milan
      if (n >= -46 && n <= -44) return { key: 'season.carnival.ambrosiano', icon: 'hgi-mask-theater-02' };
      if (n === -43) return { key: 'season.carnival.sabato', icon: 'hgi-party-popper' };
      return null;
    },
  },
  // A day of its own (Mar 14), with a module for the little things it does
  piday: {
    load: () => import('../components/pi-day.js'),
    icon: 'hgi-pi',
    tint: '#4f6df5',
    keywords: ['pi', 'π', 'pi greco', 'pigreco', 'pi day', 'pi greco day'],
  },
  // November 29, 1863: the Politecnico's founding. A light season: the navy
  // accent, the banner (with its age) and the search row, nothing else: it
  // keeps the usual logo.
  birthday: {
    icon: 'hgi-birthday-cake',
    tint: NAVY,
    keywords: ['compleanno polimi', 'polimi birthday', 'buon compleanno', 'compleanno del poli', 'compleanno politecnico', 'politecnico birthday', 'happy birthday'],
    banner() {
      return { key: 'season.birthday', vars: { years: Number(milanDay().slice(0, 4)) - FOUNDED } };
    },
  },
};

export const GRADUATION = {
  load: () => import('../components/graduation.js'),
  icon: 'hgi-laurel-wreath-01',
  logo: '/favicons/graduation/icon-192.png',
  hero: '/favicons/graduation/hero-512.webp',
  tint: NAVY,
  keywords: ['laurea', 'lauree', 'graduation', 'graduation day', 'alloro', "corona d'alloro", 'proclamazione', 'dottore', 'dottoressa', 'congratulazioni'],
};
// The graduation preview picked from the search, kept until turned off
const GRADUATION_PREVIEW_KEY = 'poliAule_graduationPreview';
// A real graduation day turned off from the search: its date, so the next
// one comes back on
const GRADUATION_OFF_KEY = 'poliAule_graduationOff';

let running = null;      // { id, mod } of the season currently started
let graduation = null;   // { campusId, preview, mod } while the graduation layer is started
// Per kind, the decorator of each owner ('season', 'graduation')
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
  if (picked && SEASONS[picked]) return picked;
  return byDate;
}

// The season currently shown, or null.
export function activeSeason() {
  return document.documentElement.dataset.season || null;
}

// Whether the graduation layer is shown (its campus graduates today, or the
// preview is on).
export function graduationShown() {
  return !!document.documentElement.dataset.graduation;
}

// Whether a season (or 'graduation') is shown, for the search's toggle row.
export function seasonShown(id) {
  return id === 'graduation' ? graduationShown() : activeSeason() === id;
}

// The Info page's hero for what's shown: graduation's over the season's.
export function shownHero() {
  return graduationShown() ? GRADUATION.hero : SEASONS[activeSeason()]?.hero ?? null;
}

// A season's entry (or graduation's), for the search's row.
export function seasonEntry(id) {
  return id === 'graduation' ? GRADUATION : SEASONS[id];
}

// What the graduation layer is for: the campus picked in the app, with what
// it celebrates today (see utils/graduation.js), or a preview of the
// cosmetics there; null when neither. Same rule as the inline script.
function currentGraduation() {
  if (!seasonalEnabled()) return null;
  const campusId = graduationCampus() ?? document.getElementById('campus-picker')?.value;
  const today = milanDay();
  const info = graduationOn(today, campusId);
  if (info && read(GRADUATION_OFF_KEY) !== today) return { campusId, info, preview: false };
  if (read(GRADUATION_PREVIEW_KEY) === 'true') return { campusId, info: null, preview: true };
  return null;
}

// Settings' toggle. Turning it off also drops a season (or the graduation
// preview) picked from the search.
export function setSeasonalEnabled(on) {
  write(SEASONAL_KEY, String(on));
  if (!on) {
    write(OVERRIDE_KEY, null);
    write(GRADUATION_PREVIEW_KEY, null);
  }
  window.dispatchEvent(new CustomEvent('seasonalchange'));
}

// The search's graduation row: the preview on or off; on a real graduation
// day, off for the rest of the day.
function toggleGraduation() {
  const today = milanDay();
  const realToday = !!graduationOn(today, graduationCampus() ?? document.getElementById('campus-picker')?.value);
  if (graduationShown()) {
    write(GRADUATION_PREVIEW_KEY, null);
    if (realToday) write(GRADUATION_OFF_KEY, today);
  } else {
    write(GRADUATION_OFF_KEY, null);
    if (!realToday) write(GRADUATION_PREVIEW_KEY, 'true');
    write(SEASONAL_KEY, 'true');
  }
  window.dispatchEvent(new CustomEvent('seasonalchange'));
}

// The search's Top Hit: turns a season on (any time of year) or off.
export function toggleSeason(id) {
  if (id === 'graduation') return toggleGraduation();
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
  if (GRADUATION.keywords.some((k) => norm(k) === q)) return 'graduation';
  return null;
}

// `owner` keeps the graduation layer's decorators apart from the season's,
// so either can come and go without the other.
export function setDecorator(kind, fn, owner = 'season') {
  (decorators[kind] ??= {})[owner] = fn;
  if (live[kind]) fn(...live[kind]);
}

function dropDecorators(owner) {
  for (const kind of Object.keys(decorators)) delete decorators[kind][owner];
}

// Called by the module that builds the element, right after building it.
export function decorate(kind, el, data) {
  for (const fn of Object.values(decorators[kind] ?? {})) fn(el, data);
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

// Graduation's banner when its layer is on, else the season's. The text
// comes from the layer's module (it names the campus); a season's from its
// locale keys.
function showBanner() {
  const host = document.querySelector('#available-classrooms-container > .favourites-section');
  if (!host || host.querySelector(':scope > .season-banner:not(.update-banner)')) return;
  let id, tint, icon, title, body;
  if (graduation && !graduation.preview) {
    id = `graduation:${graduation.campusId}`;
    ({ tint, icon } = GRADUATION);
    ({ title, body } = graduation.mod.bannerText());
  } else if (running) {
    id = running.id;
    const season = SEASONS[id];
    const variant = season.banner?.();
    const key = variant?.key ?? `season.${id}`;
    tint = season.tint;
    icon = variant?.icon ?? season.icon;
    // A message with numbers in it ({years}) is filled in here, as plain text
    // (rebuilt on a language switch, see initSeason), not by data-i18n
    const vars = variant?.vars;
    const fill = (k) => Object.entries(vars).reduce((str, [name, value]) => str.replaceAll(`{${name}}`, value), t(k));
    title = vars ? { text: fill(`${key}.bannerTitle`) } : { key: `${key}.bannerTitle` };
    body = vars ? { text: fill(`${key}.bannerText`) } : { key: `${key}.bannerText` };
  } else {
    return;
  }
  if (closedBanners.has(id)) return;
  // A {key} string retranslates on a language switch; graduation's plain
  // ones are rebuilt instead (see initSeason)
  const text = (cls, s) => (s.key
    ? `<p class="${cls}" data-i18n="${s.key}">${t(s.key)}</p>`
    : `<p class="${cls}">${escapeHtml(s.text)}</p>`);
  const el = document.createElement('div');
  // liquid-glass: Vitrium's press / stretch physics, like the app's other
  // glass; a press on the close button is left to the button
  el.className = 'season-banner lg-glass lg-glass--clear lg-glass--tinted lg-elevation-high liquid-glass';
  el.dataset.banner = id;
  el.style.setProperty('--season-tint', tint);
  el.innerHTML = `
    <i class="hgi-stroke ${icon} season-banner__icon" aria-hidden="true"></i>
    <div class="season-banner__text">
      ${text('season-banner__title', title)}
      ${text('season-banner__body', body)}
    </div>
    <button type="button" class="season-banner__close" data-i18n-attr="aria-label:season.bannerClose" aria-label="${t('season.bannerClose')}">
      <i class="hgi-stroke hgi-cancel-01" aria-hidden="true"></i>
    </button>
  `;
  el.querySelector('.season-banner__close').addEventListener('click', () => {
    closedBanners.add(id);
    el.remove();
  });
  // Under the update banner (components/update-banner.js) when that's up
  const update = host.querySelector(':scope > .update-banner');
  if (update) update.after(el);
  else host.prepend(el);
  decorate('banner', el);
}

function hideBanner() {
  document.querySelector('.season-banner:not(.update-banner)')?.remove();
}

function refreshBanner() {
  hideBanner();
  showBanner();
}

// ── On / off ──────────────────────────────────────────────────────────────

async function apply() {
  const season = currentSeason();
  if (season) document.documentElement.dataset.season = season;
  else delete document.documentElement.dataset.season;

  if (running && running.id !== season) {
    running.mod?.stop();
    dropDecorators('season');
    running = null;
    refreshBanner();
  }
  if (!season || running || !SEASONS[season]) return;
  // A light season has no module
  const mod = SEASONS[season].load ? await SEASONS[season].load() : null;
  // Turned off again while the module was loading
  if (activeSeason() !== season || running) return;
  running = { id: season, mod };
  mod?.start();
  if (!graduation) refreshBanner();
}

// The graduation layer, on top of the season: started for the campus
// graduating today, stopped when another campus is picked, the day's over or
// seasons are turned off.
let graduationLoading = null;

async function applyGraduation() {
  const next = currentGraduation();
  const root = document.documentElement;
  if (next) root.dataset.graduation = next.campusId;
  else delete root.dataset.graduation;

  if (graduation && (graduation.campusId !== next?.campusId || graduation.preview !== next?.preview)) {
    graduation.mod.stop();
    dropDecorators('graduation');
    graduation = null;
    refreshBanner();
    // The season's logo, which made way for graduation's
    running?.mod?.resumeLogo?.();
  }
  if (!next || graduation) return;
  graduationLoading ??= GRADUATION.load();
  const mod = await graduationLoading;
  // Another campus picked, or turned off, while the module was loading
  if (root.dataset.graduation !== next.campusId || graduation) return;
  graduation = { campusId: next.campusId, preview: next.preview, mod };
  mod.start(next);
  refreshBanner();
}

// The graduation layer's day ends at midnight, like everything else: checked
// again whenever the app comes back to the foreground.
const onVisible = () => { if (!document.hidden) applyGraduation(); };

export function initSeason() {
  apply();
  initGraduations();
  applyGraduation();
  document.addEventListener('graduationschange', applyGraduation);
  document.addEventListener('visibilitychange', onVisible);
  onLanguageSwitch(() => { if (graduation || (running && SEASONS[running.id].banner?.().vars)) refreshBanner(); });
  window.addEventListener('seasonalchange', () => {
    apply();
    applyGraduation();
    // Static strings with a seasonal variant ("…@halloween") swap back or in;
    // the ones built by components follow on their next render
    applyTranslations();
  });
}
