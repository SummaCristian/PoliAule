// Focus follows the in-app pages (classroom detail, Info, Changelog,
// Settings). Each is a full-screen overlay that appears by losing its
// `hidden` attribute, so keyboard focus would otherwise stay on the control
// that opened it, now underneath, and a screen reader would never learn that a
// new page is there. When one opens, focus moves to its title (or the overlay
// itself); when it closes, focus goes back to where it came from.

import { t } from '../i18n.js';

const PAGE_IDS = ['classroom-detail-overlay', 'info-page-overlay', 'changelog-overlay', 'settings-overlay'];

const origins = new Map(); // overlay -> the element that had focus before it opened

function focusInto(overlay) {
  // The page renders its content a moment after un-hiding
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (overlay.hidden) return;
    const target = overlay.querySelector('h1, h2') ?? overlay;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }));
}

function restoreFrom(overlay) {
  const origin = origins.get(overlay);
  origins.delete(overlay);
  const active = document.activeElement;
  // Only take focus back if it was lost with the page (or is still inside it)
  const lost = !active || active === document.body || overlay.contains(active);
  if (lost && origin?.isConnected && !origin.hidden) origin.focus({ preventScroll: true });
}

// The tab's title names the page on top (and so what a screen reader says
// when the page changes); the innermost open page wins
const BASE_TITLE = document.title;
function updateTitle() {
  const open = id => { const el = document.getElementById(id); return el && !el.hidden ? el : null; };
  let name = null;
  if (open('settings-overlay')) name = t('settings.title');
  else if (open('changelog-overlay')) {
    const version = location.hash.match(/^#changelog\/([\w.-]+)$/)?.[1];
    name = version ? `${t('changelog.title')} ${version}` : t('changelog.title');
  }
  else if (open('info-page-overlay')) name = t('info.about.title');
  else if (open('classroom-detail-overlay')) name = document.querySelector('#classroom-detail-overlay .detail-title')?.textContent?.trim();
  document.title = name ? `${name} · ${BASE_TITLE}` : BASE_TITLE;
}

function watch(overlay) {
  let wasHidden = overlay.hidden;
  new MutationObserver(() => {
    if (overlay.hidden === wasHidden) return;
    wasHidden = overlay.hidden;
    // The detail page fills its title a moment after un-hiding
    updateTitle();
    requestAnimationFrame(() => requestAnimationFrame(updateTitle));
    if (overlay.hidden) {
      restoreFrom(overlay);
    } else {
      const active = document.activeElement;
      if (active && active !== document.body && !overlay.contains(active)) origins.set(overlay, active);
      focusInto(overlay);
    }
  }).observe(overlay, { attributes: true, attributeFilter: ['hidden'] });
  if (!overlay.hidden) { focusInto(overlay); requestAnimationFrame(() => requestAnimationFrame(updateTitle)); }
}

export function initPageFocus() {
  // A changelog version opens inside the overlay that's already showing
  window.addEventListener('hashchange', () => requestAnimationFrame(updateTitle));
  for (const id of PAGE_IDS) {
    const overlay = document.getElementById(id);
    if (overlay) watch(overlay);
  }
}
