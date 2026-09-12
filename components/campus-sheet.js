// Glass sheet that floats over the campus map — inset on all sides at the
// bottom on mobile, pinned to the right on desktop (see campus-sheet.css).
// Apple Maps-style nested drag, from anywhere on the sheet (not just the
// handle), and from wheel/trackpad scroll as well as pointer drag:
//
//   - Three detents, mobile and desktop alike — collapsed "peek", half, and
//     full height. Short of full height, the gesture always resizes the
//     sheet, following the pointer/scroll 1:1 and snapping to the nearest
//     detent on release (or the next one in the gesture's direction, if it
//     was a fast flick).
//   - At full height, the gesture scrolls the sheet's own content instead —
//     unless that content doesn't need to scroll, or is already scrolled to
//     its top and the gesture keeps pulling further in the "collapse"
//     direction, in which case it hands off to resizing the sheet back down.
//   - The reverse handoff also holds: resizing past the full detent (there's
//     a little more headroom beyond it, used as rubber-band give normally)
//     hands off to scrolling the content instead of overshooting.
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
const HALF_FRAC = 0.5;          // fraction of the available vertical space
const FULL_FRAC = 0.85;
const GIVE = 40;                // rubber-band overshoot (px) past either end detent
const FLING_VELOCITY = 0.5;     // px/ms — a release faster than this commits a direction
const SCROLL_PROJECTION = 120;  // ms — how far a content-scroll flick projects before easing to a stop
const WHEEL_IDLE_MS = 150;      // gap between wheel ticks that ends a "burst"

// The mobile sheet's plain (full-height) left/right inset and corner radius
// — same 8px/28px it's always had. GAP is also the tabbar's own clearance
// below it (see bottom-nav.css's --bn-wrapper), reused here as the gap to
// keep concentric at the collapsed detent (see sheetGeometry() below).
const PLAIN_INSET = 8;
const PLAIN_RADIUS = 28;
const GAP = 8;
// A superellipse ("squircle", see campus-sheet.css's corner-shape) reads as
// less round than a circular arc at the same radius — it hugs the straight
// edges longer before curving in. Where it's actually supported, this scales
// the radius up to compensate, so it still reads roughly as round as the
// tabbar's true circular pill/circle ends. Where it's not (Safari, as of
// this writing — corner-shape is Chromium-only right now), the property is
// simply ignored and border-radius stays a plain circle, so scaling it up
// would just throw off the concentricity this was built for; keep it at 1
// there. Estimate for the supported case — nudge after an eyeball check.
const SQUIRCLE_RADIUS_SCALE = (typeof CSS !== 'undefined' && CSS.supports('corner-shape', 'superellipse')) ? 1.15 : 1;

// Asymptotic rubber-band (approaches ±give, never past it) — same falloff
// used by the bottom-nav pill and the liquid-glass press/drag deform.
const rubber = (x, give) => (x * give) / (give + Math.abs(x));

let sheet, handle, content;
let detent = 'collapsed';   // 'collapsed' | 'half' | 'full'
const size = new Spring(COLLAPSED);
const scrollPos = new Spring(0);

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
  // mobile bottom sheet's `full` caps short of the true full screen so the
  // map behind it stays reachable even at that detent. Both get a genuine
  // `half`, a fraction of their own available room either way.
  const full = desktopMQ.matches
    ? available
    : Math.min(available * FULL_FRAC, available - 40);
  const half = Math.min(available * HALF_FRAC, full);
  return {
    min: COLLAPSED,
    half: Math.max(COLLAPSED, half),
    max: Math.max(COLLAPSED, full),
  };
}

// The three detents as sorted { key, value } points, current viewport.
function detentPoints() {
  const b = bounds();
  return [
    { key: 'collapsed', value: b.min },
    { key: 'half', value: b.half },
    { key: 'full', value: b.max },
  ];
}

function detentValue(key) {
  const b = bounds();
  return key === 'collapsed' ? b.min : key === 'half' ? b.half : b.max;
}

function nearestDetentKey(value) {
  return detentPoints().reduce((best, p) => Math.abs(p.value - value) < Math.abs(best.value - value) ? p : best).key;
}

// The next detent in the given direction from `value` (+1 = up/larger,
// -1 = down/smaller) — how a fast flick commits, one step at a time rather
// than skipping straight to an end detent.
function nextDetentKey(value, dir) {
  const pts = detentPoints();
  if (dir > 0) {
    const above = pts.filter(p => p.value > value + 0.5);
    return (above[0] || pts[pts.length - 1]).key;
  }
  const below = pts.filter(p => p.value < value - 0.5).reverse();
  return (below[0] || pts[0]).key;
}

function contentMaxScroll() {
  return content ? Math.max(0, content.scrollHeight - content.clientHeight) : 0;
}

function contentScrollable() {
  return contentMaxScroll() > 1;
}

function tabbarHeightPx() {
  const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bn-tabbar-height'));
  return Number.isFinite(n) && n > 0 ? n : 76; // fallback ~= today's --bottom-nav-height minus its own top padding
}

function tabbarOuterInsetPx() {
  const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bn-tabbar-outer-inset'));
  return Number.isFinite(n) && n > 0 ? n : 28; // fallback ~= today's 1.75rem wrapper padding
}

// Mobile only — desktop's own media query hardcodes both properties outright
// (its panel doesn't sit over the tabbar the same way). Two independent
// quantities, both easing linearly back to the plain 8px/28px as the sheet
// grows, fully there by the full detent:
//
//  - inset: the sheet's straight edge needs to sit *outside* the pill/
//    circle's own outer edge (tabbarOuterInsetPx() from the viewport) by
//    GAP, to actually contain the tabbar rather than clip into it.
//  - radius: for the sheet's rounded corner to be concentric with the
//    pill's/circle's own rounded end (sharing the same arc centre), it
//    needs to equal that end's own radius (half the tabbar's height) plus
//    the *vertical* clearance the tabbar already keeps below it, which
//    happens to be the same GAP — then scaled up for the superellipse (see
//    SQUIRCLE_RADIUS_SCALE).
function sheetGeometry() {
  const compactInset = tabbarOuterInsetPx() - GAP;
  const compactRadius = (tabbarHeightPx() / 2 + GAP) * SQUIRCLE_RADIUS_SCALE;
  const b = bounds();
  const t = Math.max(0, Math.min(1, (size.value - COLLAPSED) / (b.max - COLLAPSED)));
  return {
    inset: compactInset + (PLAIN_INSET - compactInset) * t,
    radius: compactRadius + (PLAIN_RADIUS - compactRadius) * t,
  };
}

onSpringFrame(() => {
  if (!sheet) return;
  sheet.style.setProperty('--campus-sheet-size', `${size.value}px`);
  if (content) content.scrollTop = scrollPos.value;

  if (!desktopMQ.matches) {
    const g = sheetGeometry();
    sheet.style.setProperty('--campus-sheet-inset', `${g.inset}px`);
    sheet.style.setProperty('--campus-sheet-radius', `${g.radius}px`);
  }
});

// Shared by both springs so a released drag settles at one consistent feel —
// smooth (no visible bounce) but not sluggish. Both onPointerEnd handlers
// also seed the spring's own velocity from the drag's measured velocity
// right before calling .to() below, so the settle picks up exactly where
// the finger left off instead of starting from rest — that hand-off is what
// makes the drag and the "throw" feel like one continuous motion rather
// than two separate ones.
const SETTLE_SPRING = { stiffness: 260, damping: 30, mass: 1 };

function snapToDetent(key) {
  detent = key;
  size.to(detentValue(key), SETTLE_SPRING);
}

function settleScroll() {
  scrollPos.to(Math.min(contentMaxScroll(), Math.max(0, scrollPos.value)), SETTLE_SPRING);
}

/* --- Pointer drag (touch + mouse click-drag) ------------------------------
   Attached to the whole sheet, not just the handle: short of full height
   this always resizes; at full height it scrolls the content instead,
   deciding which on first movement and handing off mid-gesture at either
   boundary (see file header). */
let activePointerId = null;
let dragMode = null;   // null (undecided) | 'resize' | 'scroll'
let dragStartY = 0;
let dragStartSize = 0;
let dragStartScroll = 0;
let samples = [];

function pushSample(y) {
  const now = performance.now();
  samples.push({ y, t: now });
  while (samples.length > 2 && now - samples[0].t > 100) samples.shift();
}

function velocity() {
  // px/ms, positive = pointer moving down.
  const a = samples[0], b = samples[samples.length - 1];
  return b && a && b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0;
}

function onPointerDown(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  activePointerId = e.pointerId;
  dragStartY = e.clientY;
  dragStartSize = size.value;
  dragStartScroll = scrollPos.value;
  // Short of full height, any touch on the sheet resizes it, no ambiguity.
  // At full height, wait for the first real movement to tell resize from
  // content-scroll intent (see onPointerMove).
  dragMode = detent === 'full' ? null : 'resize';
  samples = [];
  pushSample(e.clientY);
  size.stop();
  scrollPos.stop();
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerEnd);
  window.addEventListener('pointercancel', onPointerEnd);
}

function onPointerMove(e) {
  if (e.pointerId !== activePointerId) return;
  const y = e.clientY;
  pushSample(y);

  if (dragMode === null) {
    const dy = y - dragStartY;
    if (Math.abs(dy) < 4) return; // dead zone — don't commit to a mode on a near-tap
    const atTop = !contentScrollable() || scrollPos.value <= 0;
    if (atTop && dy > 0) {
      dragMode = 'resize';
      dragStartY = y;
      dragStartSize = size.value;
    } else {
      dragMode = 'scroll';
      dragStartY = y;
      dragStartScroll = scrollPos.value;
    }
  }

  e.preventDefault();

  if (dragMode === 'resize') {
    const dy = y - dragStartY;
    const { min, max } = bounds();
    const raw = dragStartSize - dy;
    if (raw > max && contentScrollable()) {
      // Handoff: pulling past full height spills into scrolling the content.
      size.set(max);
      dragMode = 'scroll';
      dragStartY = y;
      dragStartScroll = scrollPos.value;
      return;
    }
    size.set(raw < min ? min + rubber(raw - min, GIVE) : raw > max ? max + rubber(raw - max, GIVE) : raw);
  } else {
    const dy = y - dragStartY;
    const max = contentMaxScroll();
    const raw = dragStartScroll - dy;
    if (raw < 0 && dy > 0) {
      // Handoff: content is at its top and still being pulled down — start
      // collapsing the sheet instead of rubber-banding the content.
      scrollPos.set(0);
      dragMode = 'resize';
      dragStartY = y;
      dragStartSize = size.value;
      return;
    }
    scrollPos.set(raw > max ? max + rubber(raw - max, GIVE) : Math.max(0, raw));
  }
}

function onPointerEnd(e) {
  if (e.pointerId !== activePointerId) return;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerEnd);
  window.removeEventListener('pointercancel', onPointerEnd);
  activePointerId = null;

  const v = velocity(); // px/ms, + = down
  const mode = dragMode;
  dragMode = null;

  if (mode === 'resize') {
    // size tracks -dy (see onPointerMove), so its own rate of change is -v.
    // Seeding the spring with it before .to() (which, unlike .set(), leaves
    // velocity alone) means the settle continues the drag's actual motion
    // instead of starting from a standstill.
    size.v = -v * 1000; // v is px/ms; Spring integrates in px/s
    // A fast flick commits to the next detent in that direction regardless
    // of how far it got dragged; otherwise snap to whichever detent the
    // release position is closer to.
    snapToDetent(Math.abs(v) > FLING_VELOCITY ? nextDetentKey(size.value, v < 0 ? 1 : -1) : nearestDetentKey(size.value));
  } else if (mode === 'scroll') {
    // Project the flick a little ahead and ease there, rather than a true
    // momentum simulation — same trick as the sheet's own snap, and
    // consistent with the rest of the app's spring-driven gestures. Same
    // velocity hand-off as above.
    const max = contentMaxScroll();
    scrollPos.v = -v * 1000;
    scrollPos.to(Math.min(max, Math.max(0, scrollPos.value - v * SCROLL_PROJECTION)), SETTLE_SPRING);
  }
}

/* --- Wheel / trackpad ------------------------------------------------------
   Same resize/scroll arbitration as the pointer drag above, but driven by
   discrete wheel ticks: each tick nudges size or scrollTop directly (no
   dead zone — a single tick is already an intentional gesture), and a
   short idle gap after the last tick in a burst stands in for "release". */
let wheelMode = null;
let wheelIdleTimer = null;

function onWheel(e) {
  e.preventDefault();
  clearTimeout(wheelIdleTimer);
  size.stop();
  scrollPos.stop();

  if (wheelMode === null) {
    wheelMode = detent !== 'full'
      ? 'resize'
      : ((!contentScrollable() || scrollPos.value <= 0) && e.deltaY < 0 ? 'resize' : 'scroll');
  }

  if (wheelMode === 'resize') {
    const { min, max } = bounds();
    const next = size.value + e.deltaY;
    if (next > max && contentScrollable()) {
      size.set(max);
      wheelMode = 'scroll';
    } else {
      size.set(next < min ? min + rubber(next - min, GIVE) : next > max ? max + rubber(next - max, GIVE) : next);
    }
  } else {
    const max = contentMaxScroll();
    const next = scrollPos.value + e.deltaY;
    if (next < 0 && e.deltaY < 0) {
      scrollPos.set(0);
      wheelMode = 'resize';
    } else {
      scrollPos.set(next > max ? max + rubber(next - max, GIVE) : Math.max(0, next));
    }
  }

  wheelIdleTimer = setTimeout(() => {
    if (wheelMode === 'resize') snapToDetent(nearestDetentKey(size.value));
    else if (wheelMode === 'scroll') settleScroll();
    wheelMode = null;
  }, WHEEL_IDLE_MS);
}

function onViewportResize() {
  // Also skip while a wheel gesture is live or the size spring is still
  // easing to a detent: on Safari, scrolling the trackpad/mouse over the
  // sheet animates the toolbar's show/hide (changing `innerHeight`, and so
  // `resize` events) even though the scroll itself is fully consumed by
  // onWheel below and nothing on the page actually moves. Reacting to that
  // mid-gesture with an immediate `.set()` yanked the sheet to a new target
  // and killed its in-flight velocity, which is what read as a snap-back.
  // A real resize (rotation, breakpoint change) that happens to land while
  // idle still applies instantly, same as before.
  if (activePointerId != null || wheelMode != null || !size.resting) return;
  // Detent sizes are fractions of the available space, which moves with the
  // viewport (rotation, toolbar show/hide, breakpoint change).
  size.set(detentValue(detent));
  const max = contentMaxScroll();
  if (scrollPos.value > max) scrollPos.set(max);
}
addEventListener('resize', onViewportResize);
desktopMQ.addEventListener('change', onViewportResize);

export function initCampusSheet() {
  const container = document.getElementById(CONTAINER_ID);
  if (!container || sheet) return;

  sheet = document.createElement('div');
  sheet.className = 'campus-sheet';
  sheet.addEventListener('pointerdown', onPointerDown);
  sheet.addEventListener('wheel', onWheel, { passive: false });

  handle = document.createElement('div');
  handle.className = 'campus-sheet-handle';
  handle.innerHTML = '<span class="campus-sheet-grabber"></span>';
  sheet.appendChild(handle);

  content = document.createElement('div');
  content.className = 'campus-sheet-content';
  sheet.appendChild(content);

  container.appendChild(sheet);

  size.set(COLLAPSED);
  scrollPos.set(0);
  sheet.style.setProperty('--campus-sheet-size', `${size.value}px`);
}
