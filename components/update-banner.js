// The update banner: for a week from a release's day, a banner at the top of
// the Favourites section announces the version this site runs (APP_VERSION:
// the newest stable on poliaule.com, the newest of all elsewhere) and opens
// its changelog page.
//
// Same look as the season's banner (utils/season.js), and stacked above it
// when both are up. Unlike that one, closing it is remembered: the version
// closed is stored, so it stays gone until a newer one comes out. Seeing the
// version's page, from the banner or any other way, counts as closing it
// (markUpdateSeen, called by components/changelog-page.js).
import { getLocale, onLanguageSwitch, t } from '../i18n.js';
import { escapeHtml } from '../utils/html.js';
import { APP_VERSION } from '../utils/env.js';

const DISMISSED_KEY = 'poliAule_updateBannerDismissed';
const SHOW_DAYS = 7;
const TINT = { stable: '#1f9d4a', beta: '#1a7fe0' };

function dismissed() {
  try { return localStorage.getItem(DISMISSED_KEY); } catch { return null; }
}

function dismiss(version) {
  try { localStorage.setItem(DISMISSED_KEY, version); } catch { /* storage unavailable */ }
}

// From the release's day (local midnight) for a week
function inWindow({ date }, now = new Date()) {
  const [y, m, d] = date.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m - 1, d + SHOW_DAYS);
  return now >= start && now < end;
}

function build(release) {
  const href = `#changelog/${release.version}`;
  const el = document.createElement('div');
  // The button is the action; a tap anywhere else on the banner does the
  // same, so the glass (which leaves presses on controls inside it to them)
  // still reacts to one
  el.className = 'season-banner update-banner lg-glass lg-glass--clear lg-glass--tinted liquid-glass';
  el.style.setProperty('--season-tint', TINT[release.channel] ?? TINT.stable);
  el.innerHTML = `
    <img class="update-banner__icon" src="/favicons/${release.channel === 'stable' ? 'main' : 'beta'}/icon-128.webp" width="34" height="34" alt="" draggable="false">
    <div class="season-banner__text">
      <p class="season-banner__title">${escapeHtml(t('updateBanner.title').replace('{version}', release.version))}</p>
      <p class="season-banner__body">${escapeHtml(release.title?.[getLocale()] ?? release.title?.en ?? '')}</p>
    </div>
    <button type="button" class="season-banner__close" aria-label="${escapeHtml(t('season.bannerClose'))}">
      <i class="hgi-stroke hgi-cancel-01" aria-hidden="true"></i>
    </button>
    <div class="update-banner__actions">
      <button type="button" class="update-banner__cta">
        <span>${escapeHtml(t('updateBanner.cta'))}</span>
        <i class="hgi-stroke hgi-arrow-right-01" aria-hidden="true"></i>
      </button>
    </div>
  `;
  const close = () => {
    dismiss(release.version);
    el.remove();
  };
  // Opening it counts as closing it: the version's page marks it seen
  // (markUpdateSeen), and it's removed once the page has covered it
  el.querySelector('.season-banner__close').addEventListener('click', close);
  const open = () => {
    location.hash = href;
  };
  el.addEventListener('click', (e) => {
    if (!e.target.closest('.season-banner__close')) open();
  });
  return el;
}

function show() {
  const release = APP_VERSION;
  const host = document.querySelector('#available-classrooms-container > .favourites-section');
  host?.querySelector(':scope > .update-banner')?.remove();
  if (!host || !release?.date || dismissed() === release.version || !inWindow(release)) return;
  // Always first: above the season's banner when that one is up too
  host.prepend(build(release));
}

// The announced version's changelog page was shown, by whatever route (the
// banner, Info, the list, a link): it's been seen, so the banner goes
export function markUpdateSeen(version) {
  if (!APP_VERSION || version !== APP_VERSION.version) return;
  dismiss(version);
  document.querySelector('.update-banner')?.remove();
}

export function initUpdateBanner() {
  show();
  onLanguageSwitch(show);
}
