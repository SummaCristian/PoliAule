// Glass sheet that floats over the campus map — inset on all sides at the
// bottom on mobile, pinned to the right on desktop (see campus-sheet.css).
// Both breakpoints drag the same way: grab the handle on top and pull up/
// down, snapping to a collapsed "peek" or an expanded height, iOS Maps
// style. Empty shell for now — content lands in a later pass.
//
// Lives inside #search-classrooms-container, alongside the map (see
// components/campus-map.js) and above it (z-index), below the header /
// footer / bottom-nav chrome, same stacking story as the map's own controls.

import { Spring, onSpringFrame } from '../utils/spring.js';

const CONTAINER_ID = 'search-classrooms-container';
const desktopMQ = matchMedia('(min-width: 600px)');

// px, the "peek" height. Tall enough that the handle clears the floating
// bottom-nav pill (which sits ~16px above the true screen edge on mobile) —
// too short and the pill's own hit area sits right on top of the handle,
// swallowing the drag before it starts.
const COLLAPSED = 192;
const EXPANDED_FRAC = 0.5;      // fraction of the available vertical space
const MAX_FRAC = 0.85;
const GIVE = 40;                // rubber-band overshoot (px) past either snap point

// Asymptotic rubber-band (approaches ±give, never past it) — same falloff
// used by the bottom-nav pill and the liquid-glass press/drag deform.
const rubber = (x, give) => (x * give) / (give + Math.abs(x));

let sheet, handle;
let expanded = false;
const size = new Spring(COLLAPSED);

function headerHeightPx() {
  const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-height'));
  return Number.isFinite(n) ? n : 84;
}

// Vertical room the sheet has to expand into — the viewport height minus its
// own bottom margin on mobile (it floats inset on all sides now, not flush
// against the edges), the gap between the header and the bottom margin on
// desktop.
function availableHeight() {
  if (!desktopMQ.matches) return innerHeight - 8; // matches campus-sheet.css's mobile `bottom`
  const top = headerHeightPx() + 32 + 20;  // matches campus-sheet.css's `top` recipe
  return innerHeight - top - 20;
}

function bounds() {
  const available = availableHeight();
  // Desktop panel can grow to fill all its available vertical room; the
  // mobile bottom sheet caps short of the full screen so the map behind it
  // stays reachable even fully expanded.
  const max = desktopMQ.matches
    ? available
    : Math.min(available * MAX_FRAC, available - 40);
  const expanded = desktopMQ.matches ? max : Math.min(available * EXPANDED_FRAC, max);
  return { min: COLLAPSED, max: Math.max(COLLAPSED, max), expanded: Math.max(COLLAPSED, expanded) };
}

onSpringFrame(() => {
  if (!sheet) return;
  sheet.style.setProperty('--campus-sheet-size', `${size.value}px`);
});

function snapTo(wantExpanded) {
  expanded = wantExpanded;
  const b = bounds();
  size.to(expanded ? b.expanded : b.min, { stiffness: 420, damping: 38, mass: 0.9 });
}

/* --- Drag ---------------------------------------------------------------- */
let dragging = false;
let startSize = 0, startY = 0;
let samples = [];

function onDragStart(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  dragging = true;
  try { handle.setPointerCapture(e.pointerId); } catch { /* not fatal */ }
  size.stop();
  startSize = size.value;
  startY = e.clientY;
  samples = [{ y: startY, t: performance.now() }];
}

function onDragMove(e) {
  if (!dragging) return;
  const y = e.clientY;
  const now = performance.now();
  samples.push({ y, t: now });
  while (samples.length > 2 && now - samples[0].t > 100) samples.shift();

  // Dragging the handle up (negative delta) grows the sheet.
  const raw = startSize - (y - startY);
  const { min, max } = bounds();
  const clamped = raw < min
    ? min + rubber(raw - min, GIVE)
    : raw > max
      ? max + rubber(raw - max, GIVE)
      : raw;
  size.set(clamped);
}

function onDragEnd(e) {
  if (!dragging) return;
  dragging = false;
  try { handle.releasePointerCapture(e.pointerId); } catch { /* already gone */ }

  const a = samples[0], b = samples[samples.length - 1];
  const v = b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0;
  // A fast flick commits to a snap point regardless of how far it got
  // dragged; otherwise snap to whichever point the release position is
  // closer to.
  if (Math.abs(v) > 0.5) snapTo(v < 0);
  else {
    const bnd = bounds();
    snapTo(size.value > bnd.min + (bnd.expanded - bnd.min) / 2);
  }
}

function onViewportResize() {
  if (dragging) return;
  // The expanded height is a fraction of the available space, which moves
  // with the viewport (rotation, toolbar show/hide, breakpoint change).
  size.set(expanded ? bounds().expanded : bounds().min);
}
addEventListener('resize', onViewportResize);
desktopMQ.addEventListener('change', onViewportResize);

export function initCampusSheet() {
  const container = document.getElementById(CONTAINER_ID);
  if (!container || sheet) return;

  sheet = document.createElement('div');
  sheet.className = 'campus-sheet';

  handle = document.createElement('div');
  handle.className = 'campus-sheet-handle';
  handle.innerHTML = '<span class="campus-sheet-grabber"></span>';
  handle.addEventListener('pointerdown', onDragStart);
  handle.addEventListener('pointermove', onDragMove);
  handle.addEventListener('pointerup', onDragEnd);
  handle.addEventListener('pointercancel', onDragEnd);
  sheet.appendChild(handle);

  const content = document.createElement('div');
  content.className = 'campus-sheet-content';
  sheet.appendChild(content);

  container.appendChild(sheet);

  size.set(COLLAPSED);
  sheet.style.setProperty('--campus-sheet-size', `${size.value}px`);
}
