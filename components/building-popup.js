import { snapGeometry, morphGeometry, hideInnerBoxInstantly, unhideInnerBox, sheetPhysics } from 'vitrium';
import { t } from '../i18n.js';
import { escapeHtml } from '../utils/html.js';
import { createBuildingStarButton } from '../utils/favourites.js';
import { appendClassroomsByFloor } from './campus-buildings.js';
import { ownBack } from '../utils/back-stack.js';

// A favourite building, opened: its folder in the Favourites strip grows into
// a glass panel in the middle of the screen, holding every classroom card of
// the building floor by floor (the same grid as the Campus sheet's building
// page), and shrinks back into the folder on close.
//
// Built on Vitrium's morph popup pieces rather than createMorphPopup itself,
// which always places its panel next to its trigger: the .lg-morph glass shell,
// its transparent .lg-morph-overlay, and the FLIP helpers (the panel's real box
// is pinned to its final place and only a transform animates).
//
// The overlay is the backdrop, minus the look: it takes every tap outside the
// panel (which closes it, and goes no further) without dimming anything, since
// a painted full-screen layer upsets Safari's safe areas.
//
// Like Settings, dragging its header down dismisses it (wireDismissDrag).
//
// Opening a classroom from here keeps the panel: the detail page hides it
// (body.detail-open, see building-popup.css) instead of closing it, so the
// page's close zooms straight back into the card it came from, still in the
// panel.
//
// Back closes it (utils/back-stack.js). From a classroom opened out of it,
// Back closes the classroom page and leaves the panel up.

const MORPH_MS = 420;   // --lg-morph-panel-dur (vitrium/styles/morph-popup.css)
const EDGE = 12;        // px kept clear of the safe area, around the panel
const MAX_W = 560;      // the panel's width on a wide screen
const FOLDER_RADIUS = '18px';   // .bo-card-front
const PANEL_RADIUS = '28px';

// Swipe-to-dismiss, same numbers as Settings (components/settings.js).
const DISMISS_DISTANCE = 120;       // px dragged down commits to close
const DISMISS_FLING_VELOCITY = 0.5; // px/ms: a fast-enough flick commits regardless of distance
const DRAG_RUBBER_GIVE = 60;        // rubber-band give (px) dragging up, which never dismisses

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

let host, overlay, panel, inner, safeBox;
let isOpen = false;
let settled = false;
let seq = 0;
let cleanupTimer = 0;
let morphCleanup = null;
let current = null;     // { key, findTrigger }
let returnFocus = null;
const back = ownBack(() => close());

const detailOpen = () => document.body.classList.contains('detail-open');

function ensureHost() {
  if (host) return;
  host = document.createElement('div');
  host.className = 'lg-morph-host bpop-host';

  overlay = document.createElement('div');
  overlay.className = 'lg-morph-overlay';
  overlay.hidden = true;
  overlay.addEventListener('click', () => close());

  panel = document.createElement('div');
  panel.className = 'lg-morph bpop';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.tabIndex = -1;

  inner = document.createElement('div');
  inner.className = 'lg-morph__inner bpop-inner';
  panel.appendChild(inner);

  // The screen minus its safe areas and a margin: where the panel may go.
  safeBox = document.createElement('div');
  safeBox.className = 'bpop-safe';
  safeBox.setAttribute('aria-hidden', 'true');

  host.append(overlay, panel, safeBox);
  document.body.appendChild(host);

  panel.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', () => {
    if (isOpen && settled) snapGeometry(panel, target(), PANEL_RADIUS);
  });
  // A favourite toggled while the panel is open re-renders the Favourites
  // strip (components/favourites.js), replacing the folder it came from:
  // keep whichever folder stands for it now hidden behind the panel.
  window.addEventListener('favourites-changed', () => queueMicrotask(() => {
    if (isOpen) current?.findTrigger()?.classList.add('bo-card--popped');
  }));
}

function onKeydown(e) {
  if (detailOpen()) return;
  if (e.key === 'Escape') { e.preventDefault(); close(); return; }
  if (e.key !== 'Tab') return;
  const nodes = [...panel.querySelectorAll(FOCUSABLE)].filter(n => n.getClientRects().length);
  if (!nodes.length) { e.preventDefault(); return; }
  const first = nodes[0], last = nodes[nodes.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault(); first.focus();
  }
}

// ── Scroll lock ─────────────────────────────────────────────────────────
// The page behind doesn't scroll while the panel is up, except the panel's
// own list. Off while the detail page is over it: that page scrolls the window.
function preventScroll(e) {
  if (detailOpen()) return;
  const body = panel.querySelector('.bpop-body');
  if (body && e.composedPath().includes(body) && body.scrollHeight > body.clientHeight) return;
  e.preventDefault();
}

function lockScroll() {
  window.addEventListener('wheel', preventScroll, { passive: false });
  window.addEventListener('touchmove', preventScroll, { passive: false });
}

function unlockScroll() {
  window.removeEventListener('wheel', preventScroll);
  window.removeEventListener('touchmove', preventScroll);
}

// ── Geometry ────────────────────────────────────────────────────────────

// The panel's resting box: as wide as the screen allows up to MAX_W, as tall
// as its content up to the safe area's height, centred in the safe area.
function target() {
  const band = safeBox.getBoundingClientRect();
  const width = Math.min(MAX_W, band.width);
  panel.style.setProperty('--lg-morph-width', `${width}px`);
  const s = panel.style;
  const prevTransition = s.transition;
  s.transition = 'none';
  s.width = `${width}px`;
  s.height = 'auto';
  const header = inner.querySelector('.bpop-header');
  const body = inner.querySelector('.bpop-body');
  const height = Math.min(band.height, (header?.offsetHeight ?? 0) + (body?.scrollHeight ?? 0));
  s.transition = prevTransition;
  return {
    left: band.left + (band.width - width) / 2,
    top: band.top + (band.height - height) / 2,
    width, height,
  };
}

// The glass front of the folder: what the panel grows out of and back into.
function triggerRect(folder) {
  const r = (folder.querySelector('.bo-card-front') ?? folder).getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

const visibleTrigger = () => {
  const el = current?.findTrigger();
  return el && el.getClientRects().length ? el : null;
};

function onMorphEnd(mySeq, cb) {
  morphCleanup?.();
  const done = () => { morphCleanup?.(); if (mySeq === seq) cb(); };
  const fallback = setTimeout(done, MORPH_MS + 60);
  const handler = (e) => {
    if (e.target === panel && e.propertyName === 'transform') done();
  };
  panel.addEventListener('transitionend', handler);
  morphCleanup = () => {
    clearTimeout(fallback);
    panel.removeEventListener('transitionend', handler);
    morphCleanup = null;
  };
}

function beginOp() {
  clearTimeout(cleanupTimer);
  cleanupTimer = 0;
  morphCleanup?.();
  return ++seq;
}

// ── Content ─────────────────────────────────────────────────────────────

function render(campusId, building) {
  const n = building.classrooms.length;
  inner.innerHTML = `
    <div class="bpop-header">
      <div class="bpop-titles">
        <span class="bpop-kicker">${escapeHtml(t('building.prefix'))}</span>
        <h3 class="bpop-name">${escapeHtml(building.name)}</h3>
        ${building.altName ? `<span class="bpop-alt">${escapeHtml(building.altName)}</span>` : ''}
        <span class="bpop-total secondary">${escapeHtml(t('overview.subtitle').replace('{n}', n))}</span>
      </div>
      <div class="bpop-actions">
        <button class="header-button bpop-btn bpop-close liquid-glass" type="button" aria-label="${escapeHtml(t('favourites.closeBuilding'))}">
          <i class="hgi-stroke hgi-cancel-01" aria-hidden="true"></i>
        </button>
      </div>
    </div>
    <div class="bpop-body">
      <div class="bo-grid campus-sheet-classroom-grid bpop-grid"></div>
    </div>
  `;
  inner.querySelector('.bpop-actions')
    .prepend(createBuildingStarButton(campusId, building.name, 'header-button bpop-btn'));
  inner.querySelector('.bpop-close').addEventListener('click', () => close());
  inner.querySelector('.bpop-header').addEventListener('pointerdown', onDragPointerDown);
  appendClassroomsByFloor(inner.querySelector('.bpop-grid'), building);
  panel.setAttribute('aria-label', `${t('building.prefix')} ${building.name}`);
}

// ── Swipe-to-dismiss ────────────────────────────────────────────────────
// From the header, which never scrolls, so there's no telling a drag from a
// scroll of the list to do. Down follows the finger and closes past a
// distance or on a flick, straight into the morph back (close() starts from
// wherever the drag left the panel); up only rubber-bands.

let dragPointerId = null;
let dragStartY = 0;
let dragSamples = [];

function pushDragSample(y) {
  const now = performance.now();
  dragSamples.push({ y, t: now });
  while (dragSamples.length > 2 && now - dragSamples[0].t > 100) dragSamples.shift();
}

function dragVelocity() {
  // px/ms, positive = moving down.
  const a = dragSamples[0], b = dragSamples[dragSamples.length - 1];
  return a && b && b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0;
}

function onDragPointerDown(e) {
  if (!isOpen || !settled || dragPointerId !== null) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (e.target.closest('button')) return;   // the star and × keep their clicks
  dragPointerId = e.pointerId;
  dragStartY = e.clientY;
  dragSamples = [];
  pushDragSample(e.clientY);
  panel.style.transition = 'none';
  window.addEventListener('pointermove', onDragPointerMove);
  window.addEventListener('pointerup', onDragPointerEnd);
  window.addEventListener('pointercancel', onDragPointerEnd);
}

function onDragPointerMove(e) {
  if (e.pointerId !== dragPointerId) return;
  pushDragSample(e.clientY);
  const dy = e.clientY - dragStartY;
  const applied = dy > 0 ? dy : sheetPhysics.rubber(dy, DRAG_RUBBER_GIVE);
  panel.style.transform = `translateY(${applied}px)`;
}

function onDragPointerEnd(e) {
  if (e.pointerId !== dragPointerId) return;
  window.removeEventListener('pointermove', onDragPointerMove);
  window.removeEventListener('pointerup', onDragPointerEnd);
  window.removeEventListener('pointercancel', onDragPointerEnd);
  dragPointerId = null;

  const dy = e.clientY - dragStartY;
  if (e.type === 'pointerup' && dy > 0 && (dy > DISMISS_DISTANCE || dragVelocity() > DISMISS_FLING_VELOCITY)) {
    panel.style.transition = '';
    close();
    return;
  }
  // Not far or fast enough: spring back.
  panel.style.transition = 'transform 0.32s cubic-bezier(0.34, 1.4, 0.64, 1)';
  panel.style.transform = '';
  const mySeq = seq;
  setTimeout(() => { if (mySeq === seq && isOpen) panel.style.transition = ''; }, 340);
}

// ── Open / close ────────────────────────────────────────────────────────

// `folder` is the favourite's folder in the strip; `findTrigger()` finds the
// one standing for the same building later (the strip may have re-rendered).
export function openBuildingPopup({ campusId, building, folder, findTrigger }) {
  ensureHost();
  if (isOpen) return;
  const mySeq = beginOp();
  isOpen = true;
  settled = false;
  current = { findTrigger };
  returnFocus = document.activeElement;
  back.push();

  panel.classList.remove('lg-morph--open', 'lg-morph--closing');
  unhideInnerBox(inner);
  render(campusId, building);

  overlay.hidden = false;
  overlay.classList.add('is-active');
  panel.style.display = 'flex';
  lockScroll();

  const to = target();
  const done = () => {
    if (mySeq !== seq) return;
    settled = true;
    panel.focus({ preventScroll: true });
  };

  if (reduceMotion.matches || !folder) {
    snapGeometry(panel, to, PANEL_RADIUS);
    folder?.classList.add('bo-card--popped');
    panel.classList.add('lg-morph--open');
    done();
    return;
  }

  const from = triggerRect(folder);
  snapGeometry(panel, from, FOLDER_RADIUS);
  folder.classList.add('bo-card--popped');
  requestAnimationFrame(() => {
    if (mySeq !== seq) return;
    morphGeometry(panel, from, to, {
      fromRadius: FOLDER_RADIUS,
      toRadius: PANEL_RADIUS,
      onSettle: () => {
        if (mySeq !== seq) return;
        panel.classList.add('lg-morph--open');
        onMorphEnd(mySeq, done);
      },
    });
  });
}

export function closeBuildingPopup() { close(); }

function close() {
  if (!isOpen) return;
  const mySeq = beginOp();
  isOpen = false;
  settled = false;
  back.release();

  const folder = visibleTrigger();
  const focusBack = panel.contains(document.activeElement) ? returnFocus : null;
  panel.classList.remove('lg-morph--open');
  overlay.classList.remove('is-active');
  overlay.hidden = true;
  unlockScroll();

  const clear = () => {
    if (mySeq !== seq) return;
    panel.classList.remove('lg-morph--closing');
    panel.style.display = 'none';
    for (const p of ['left', 'top', 'width', 'height', 'borderRadius', 'transform', 'transition', 'transformOrigin']) panel.style[p] = '';
    inner.replaceChildren();
    unhideInnerBox(inner);
    document.querySelectorAll('.bo-card--popped').forEach(el => el.classList.remove('bo-card--popped'));
    current = null;
  };
  const restoreFocus = () => {
    if (focusBack?.isConnected) focusBack.focus({ preventScroll: true });
    else if (folder?.isConnected) folder.focus({ preventScroll: true });
  };

  // No folder to go back into (unstarred meanwhile, or scrolled out of
  // reach): fade out where it is.
  if (reduceMotion.matches || !folder) {
    panel.classList.add('lg-morph--closing');
    document.querySelectorAll('.bo-card--popped').forEach(el => el.classList.remove('bo-card--popped'));
    restoreFocus();
    cleanupTimer = setTimeout(clear, reduceMotion.matches ? 0 : 240);
    return;
  }

  // Cut the content's fade short before the box jumps to the folder's size
  // (see hideInnerBoxInstantly in vitrium's flip-morph.js).
  hideInnerBoxInstantly(inner);
  panel.style.transition = '';
  const visualRect = panel.getBoundingClientRect();
  requestAnimationFrame(() => {
    if (mySeq !== seq) return;
    const to = triggerRect(folder);
    morphGeometry(panel, visualRect, to, {
      toRadius: FOLDER_RADIUS,
      onSettle: () => {
        if (mySeq !== seq) return;
        onMorphEnd(mySeq, () => {
          // Hand over to the folder: its front sits exactly under the
          // shrunken panel, which cross-fades out as the folder's back and
          // cards fade back in around it.
          folder.classList.remove('bo-card--popped');
          panel.classList.add('lg-morph--closing');
          restoreFocus();
          cleanupTimer = setTimeout(clear, 240);
        });
      },
    });
  });
}
