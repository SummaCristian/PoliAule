// Search overlay — the bottom-nav search FAB opens this as a sheet over
// whatever tab is currently showing, rather than switching to its own tab
// page. It owns only the presentation/UX; the actual classroom text search
// (data, index, card builders) lives in search-classrooms-script.js.

import { t, onLanguageSwitch } from '../i18n.js';
import { haptics, defaultPatterns } from './haptics.js';
import {
  ensureSearchData,
  runClassroomSearch,
  buildSearchResultCard,
  SEARCH_MAX_RESULTS,
} from '../search-classrooms-script.js';

const DEBOUNCE_MS = 200;

// Shared view-transition name: the bottom-nav search FAB morphs into the
// overlay's search bar on open, and back on close. Only ever assigned to one
// of the two elements at a time (cleared before it's handed over).
const MORPH_NAME = 'search-fab-morph';
const fabEl = () => document.getElementById('bn-search-btn');
const barEl = () => overlay.querySelector('.search-bar-wrapper');

// The translucent chrome (header blur layers, pill nav) can't keep a live
// backdrop-filter through a view transition — Safari doesn't rasterise it into
// the snapshot, so it flashes unblurred / resamples the wrong backdrop. While
// `html.search-vt` is set (only for the duration of the open/close VT) those
// surfaces drop their blur — see search-overlay.css.
function beginChromeVT() { document.documentElement.classList.add('search-vt'); }
// Restore the blur a couple of frames AFTER the VT resolves — snapping it back
// while the ::view-transition pseudo-elements are still tearing down double-
// exposes the FAB (unblurred snapshot + freshly-blurred live element).
function endChromeVT() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.documentElement.classList.remove('search-vt');
  }));
}

let overlay, panel, input, clearBtn, closeBtn, resultsEl;
let isOpen = false;
let debounce = null;
let savedScrollPos = 0;

function renderResults(query) {
  _renderResults(query);
  requestAnimationFrame(syncHeaderClearance);
}

function _renderResults(query) {
  const q = query.trim();
  resultsEl.innerHTML = '';

  if (!q) return; // idle: empty results area, placeholder styling handles the hint

  const { visible, capped } = runClassroomSearch(q);

  if (visible.length === 0) {
    const state = document.createElement('div');
    state.className = 'search-empty-state';
    state.innerHTML = `
      <span class="material-symbols-outlined empty-container-icon">search_off</span>
      <p class="empty-container-title">${t('search.emptyTitle')}</p>
      <p class="empty-container-subtitle">${t('search.emptySubtitle')}</p>
    `;
    resultsEl.appendChild(state);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'search-grid search-grid--classroom';
  visible.forEach(room => grid.appendChild(buildSearchResultCard(room, q)));
  resultsEl.appendChild(grid);

  if (capped) {
    const notice = document.createElement('p');
    notice.className = 'search-too-many-notice';
    notice.textContent = t('search.tooManyResults').replace('{n}', SEARCH_MAX_RESULTS);
    resultsEl.appendChild(notice);
  }

  requestAnimationFrame(() => setTimeout(() => grid.classList.add('appeared'), 400));
}

// Hide the header only once the results box has actually grown tall enough to
// reach up behind it (body.search-covers-header, consumed by the mobile CSS).
// opacity:0 on the header doesn't change its box, so this can't oscillate.
function syncHeaderClearance() {
  const header = document.querySelector('.header');
  if (!header || !panel || !isOpen) return;
  const covers = panel.getBoundingClientRect().top < header.getBoundingClientRect().bottom + 8;
  document.body.classList.toggle('search-covers-header', covers);
}

// Mobile pins the search field just above the on-screen keyboard. iOS Safari
// doesn't shrink the layout viewport for the keyboard, so `position: fixed;
// bottom` alone would sit behind it — track visualViewport and expose the
// keyboard height as --search-kb for the CSS to offset by.
function onViewportResize() {
  const vv = window.visualViewport;
  if (!vv) return;
  const kb = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
  overlay.style.setProperty('--search-kb', kb + 'px');
  requestAnimationFrame(syncHeaderClearance);
}

function startViewportTracking() {
  const vv = window.visualViewport;
  if (!vv) return;
  onViewportResize();
  vv.addEventListener('resize', onViewportResize);
  vv.addEventListener('scroll', onViewportResize);
}

function stopViewportTracking() {
  const vv = window.visualViewport;
  if (vv) {
    vv.removeEventListener('resize', onViewportResize);
    vv.removeEventListener('scroll', onViewportResize);
  }
  overlay.style.removeProperty('--search-kb');
}

function conceal() {
  overlay.classList.remove('visible');
  overlay.setAttribute('hidden', '');
  document.body.classList.remove('search-overlay-open');
  document.body.classList.remove('search-covers-header');
  stopViewportTracking();
  window.scrollTo(0, savedScrollPos);
}

// Land the caret in the field ready to type; select any leftover query so the
// first keystroke replaces it. Must run inside the FAB-tap callstack — iOS
// Safari only opens the keyboard for a focus() that's user-initiated.
function grabInput() {
  input.focus({ preventScroll: true });
  input.select();
}

export async function openSearchOverlay() {
  if (isOpen || !overlay) return;
  isOpen = true;
  haptics.trigger(defaultPatterns.light);
  savedScrollPos = window.scrollY;

  // Unhide + focus synchronously (still inside the FAB-tap callstack, so iOS
  // opens the keyboard). The overlay is only opacity:0 here, not display:none,
  // so focus() works. `search-overlay-open` (which hides the FAB/nav) is held
  // back until inside the VT callback so the FAB stays in the "old" snapshot
  // to morph from. The panel rides above the keyboard via the visualViewport
  // tracking below, so it doesn't matter that Safari resizes late.
  overlay.removeAttribute('hidden');
  grabInput();

  const fab = fabEl();
  if (document.startViewTransition && fab) {
    fab.style.viewTransitionName = MORPH_NAME;
    beginChromeVT();
    const vt = document.startViewTransition(() => {
      fab.style.viewTransitionName = '';
      document.body.classList.add('search-overlay-open');
      overlay.classList.add('visible');
      startViewportTracking();
      const bar = barEl();
      if (bar) bar.style.viewTransitionName = MORPH_NAME;
    });
    vt.finished.finally(() => {
      const bar = barEl();
      if (bar) bar.style.viewTransitionName = '';
      endChromeVT();
      // Re-grab only if the transition stole focus (some engines blur on the
      // DOM churn); avoids yanking the selection back if the user's already typing.
      if (isOpen && document.activeElement !== input) grabInput();
    });
  } else {
    document.body.classList.add('search-overlay-open');
    requestAnimationFrame(() => overlay.classList.add('visible'));
    startViewportTracking();
    grabInput();
  }

  await ensureSearchData();
  if (isOpen) renderResults(input.value);
}

export function closeSearchOverlay() {
  if (!isOpen || !overlay) return;
  isOpen = false;
  clearTimeout(debounce);
  input.blur();

  const fab = fabEl();
  if (document.startViewTransition && fab) {
    const bar = barEl();
    if (bar) bar.style.viewTransitionName = MORPH_NAME;
    beginChromeVT();
    const vt = document.startViewTransition(() => {
      if (bar) bar.style.viewTransitionName = '';
      conceal();
      fab.style.viewTransitionName = MORPH_NAME;
    });
    vt.finished.finally(() => {
      fab.style.viewTransitionName = '';
      endChromeVT();
    });
  } else {
    overlay.classList.remove('visible');
    const done = () => conceal();
    overlay.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 260); // fallback if transitionend doesn't fire
  }
}

// Drop the overlay with no transition of its own — for when the click that
// dismisses it also navigates somewhere that runs its own transition (info
// page, classroom detail), so the two don't fight.
function dismissInstant() {
  if (!isOpen) return;
  isOpen = false;
  clearTimeout(debounce);
  input.blur();
  const fab = fabEl();
  if (fab) fab.style.viewTransitionName = '';
  document.documentElement.classList.remove('search-vt');
  conceal();
}

export function initSearchOverlay() {
  overlay = document.getElementById('search-overlay');
  if (!overlay) return;
  panel = overlay.querySelector('.search-overlay-panel');
  input = document.getElementById('classroom-search-input');
  clearBtn = document.getElementById('classroom-search-clear');
  closeBtn = document.getElementById('search-overlay-close');
  resultsEl = document.getElementById('search-overlay-results');

  closeBtn.addEventListener('click', () => {
    haptics.trigger(defaultPatterns.light);
    closeSearchOverlay();
  });

  // Tap the blurred backdrop (outside the panel) to dismiss.
  overlay.addEventListener('click', (e) => {
    if (!panel.contains(e.target)) closeSearchOverlay();
  });

  document.addEventListener('keydown', (e) => {
    if (isOpen && e.key === 'Escape') closeSearchOverlay();
  });

  // Opening a result navigates to the classroom detail page — get the
  // overlay out of the way so the card → page morph isn't behind the blur.
  resultsEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-open-classroom]')) closeSearchOverlay();
  });

  // The header sits above the overlay (z-index), so its controls stay
  // clickable while search is open. Any such click (info page, settings, …)
  // should take the overlay down first — the destination runs its own
  // transition. Capture phase so this beats the buttons' own handlers.
  document.querySelector('.header')?.addEventListener('click', () => {
    if (isOpen) dismissInstant();
  }, true);

  // Safety net: any other hash route opened while we're open takes it down too
  // (isOpen is already false by here for the result-card path above).
  window.addEventListener('hashchange', () => {
    if (isOpen && location.hash) dismissInstant();
  });

  clearBtn.addEventListener('click', () => {
    haptics.trigger(defaultPatterns.light);
    input.value = '';
    input.dispatchEvent(new Event('input'));
    input.focus();
  });

  input.addEventListener('input', () => {
    clearTimeout(debounce);
    const query = input.value;
    if (!query.trim()) { renderResults(''); return; }
    debounce = setTimeout(() => renderResults(query), DEBOUNCE_MS);
  });

  onLanguageSwitch(() => { if (isOpen) renderResults(input.value); });
}
