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
const FLING_VELOCITY = 0.5;     // px/ms — a release faster than this commits to the next detent
const HARD_FLING_VELOCITY = 1.4; // px/ms — faster than this skips straight to the end detent
const SCROLL_PROJECTION = 120;  // ms — how far a content-scroll flick projects before easing to a stop
const WHEEL_IDLE_MS = 150;      // gap between wheel ticks that ends a "burst"

// Liquid-glass-style squash/stretch, ported (not reused directly — see the
// conversation this came from): liquid-glass.js drives its deform from raw
// pointer distance and owns the gesture itself (element-level pointer
// capture), neither of which fits here, where the drag *is* the resize and
// is already fully arbitrated (detents, mode handoffs, wheel). This instead
// reads the resize's own velocity (see resizeVelocity() below) — live drag,
// wheel, or the settle/fling spring, whichever's active — so it can't
// contend with any of that logic. STRETCH_GAIN converts px/ms of resize
// speed to a scale delta; STRETCH_MAX caps it so it stays a glass panel.
const STRETCH_GAIN = 0.12;
const STRETCH_MAX = 0.14;

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

let sheet, handle, content, guard;
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
// -1 = down/smaller) — a fast flick commits one step at a time rather than
// skipping straight to an end detent.
function nextDetentKey(value, dir) {
  const pts = detentPoints();
  if (dir > 0) {
    const above = pts.filter(p => p.value > value + 0.5);
    return (above[0] || pts[pts.length - 1]).key;
  }
  const below = pts.filter(p => p.value < value - 0.5).reverse();
  return (below[0] || pts[0]).key;
}

// A release/commit's actual target: the adjacent detent for an ordinary
// flick, but the *end* detent (skipping past "half" entirely) for a hard
// enough one — so a strong throw from collapsed can land straight on full.
function flungDetentKey(value, dir, speed) {
  if (speed > HARD_FLING_VELOCITY) {
    const pts = detentPoints();
    return (dir > 0 ? pts[pts.length - 1] : pts[0]).key;
  }
  return nextDetentKey(value, dir);
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

// The resize's own signed velocity (px/ms, + = growing) — whichever of the
// three phases is actually driving it right now: a live pointer drag, a
// live (not yet committed) wheel drag, or the settle/fling spring. Reading
// this instead of raw pointer distance is what lets the squash/stretch
// below react without contending with any of the resize logic itself; it's
// ~0 outside a resize (idle, or a pure content-scroll drag), so the effect
// naturally only shows for resize motion.
function resizeVelocity() {
  if (activePointerId != null && dragMode === 'resize') return -velocity(); // velocity() is +down; size tracks -dy
  if (wheelMode === 'resize' && !wheelCommitted) return wheelVel;
  return size.v / 1000; // px/s → px/ms
}

// Guards the map from a gesture/animation still in progress on the sheet
// (see the wheel-guard element itself, created in initCampusSheet), and
// drives the sheet's own liquid-glass-style reactive feel (a "lit"
// brightness/saturation boost — see .campus-sheet.lg-active in
// campus-sheet.css — plus the squash/stretch transform below, from
// resizeVelocity()). Driven by its own dedicated rAF chain rather than
// piggybacking on the shared spring loop above: that loop only runs (and so
// only recomputes anything) while some spring is actually mid-animation,
// and stops the instant everything's resting — including, for a plain tap
// that never calls .to()/.set() again after release, potentially stopping
// *before* ever re-checking activePointerId's just-cleared null. Polling
// independently here guarantees a check the frame after any such state
// change, with no dependency on whether the shared loop happens to still be
// running then.
let guardWatchQueued = false;
function watchGuard() {
  guardWatchQueued = false;
  const busy = activePointerId != null || wheelMode != null || !size.resting || !scrollPos.resting;

  if (guard) guard.classList.toggle('busy', busy);

  if (sheet) {
    // The glow reads as "you're touching the glass," so it should start
    // fading the moment the gesture itself ends — release, or a wheel fling
    // committing — rather than lingering through the settle/fling animation
    // that follows (which is still `busy`, and still drives the
    // squash/stretch below; just not the glow).
    const gesturing = activePointerId != null || (wheelMode != null && !wheelCommitted);
    sheet.classList.toggle('lg-active', gesturing);
    const v = resizeVelocity();
    const mag = Math.min(Math.abs(v) * STRETCH_GAIN, STRETCH_MAX);
    if (mag > 0.002) {
      const dir = v >= 0 ? 1 : -1;
      // Stretch taller (and squash a touch narrower, the perpendicular
      // axis) when growing fast; the reverse when collapsing fast.
      sheet.style.transform = `scaleY(${(1 + dir * mag).toFixed(4)}) scaleX(${(1 - dir * mag * 0.4).toFixed(4)})`;
    } else {
      sheet.style.transform = '';
    }
  }

  if (busy) requestGuardWatch();
}
function requestGuardWatch() {
  if (guardWatchQueued) return;
  guardWatchQueued = true;
  requestAnimationFrame(watchGuard);
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

  // A committed wheel-fling's spring runs on its own from here — release
  // the "gesture in progress" state for real once it actually settles,
  // rather than on some fixed timeout (see onWheel's early-return above).
  if (wheelCommitted && size.resting) {
    wheelMode = null;
    wheelCommitted = false;
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
  watchGuard();
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
    // A fast flick commits to the next detent in that direction (or skips
    // straight to the end one, hard enough) regardless of how far it got
    // dragged; otherwise snap to whichever detent the release position is
    // closer to.
    snapToDetent(Math.abs(v) > FLING_VELOCITY ? flungDetentKey(size.value, v < 0 ? 1 : -1, Math.abs(v)) : nearestDetentKey(size.value));
  } else if (mode === 'scroll') {
    // Project the flick a little ahead and ease there, rather than a true
    // momentum simulation — same trick as the sheet's own snap, and
    // consistent with the rest of the app's spring-driven gestures. Same
    // velocity hand-off as above.
    const max = contentMaxScroll();
    scrollPos.v = -v * 1000;
    scrollPos.to(Math.min(max, Math.max(0, scrollPos.value - v * SCROLL_PROJECTION)), SETTLE_SPRING);
  }
  watchGuard();
}

/* --- Wheel / trackpad ------------------------------------------------------
   Same resize/scroll arbitration as the pointer drag above, but driven by
   discrete wheel ticks: each tick nudges size or scrollTop directly (no
   dead zone — a single tick is already an intentional gesture).

   For resize specifically: a trackpad fling arrives as many ticks with
   OS-supplied momentum (shrinking deltas), so tracking them 1:1 would coast
   to a stop on its own, and only *then* — once the burst goes idle — did a
   separate, freshly-started snap animation kick in, reading as two
   disjointed motions back to back. Instead, track this burst's own
   velocity, and the moment it crosses FLING_VELOCITY, commit immediately:
   stop tracking raw deltas and ease straight to the next detent in that
   direction, seeded with that same measured velocity (same seamless
   hand-off trick as onPointerEnd) so the fling continues into the snap
   as one motion instead of two. A slower, deliberate scroll never crosses
   the threshold and still just settles to the nearest detent once idle,
   as before. */
let wheelMode = null;
let wheelIdleTimer = null;
let wheelCommitted = false;
let wheelLastT = null;
let wheelVel = 0; // smoothed px/ms, same sign as deltaY (size += deltaY)

function onWheel(e) {
  e.preventDefault();

  // Once committed, the spring is flying on its own and no longer needs
  // this burst's ticks — and, critically, must stop treating them as signs
  // of life: trackpad momentum keeps sending shrinking-delta wheel events
  // for a while after the fingers lift, and continuing to poke the idle
  // timer on every one of them kept the "gesture in progress" state alive
  // far past the actual animation, silently swallowing the user's next,
  // genuinely new scroll until they moved the cursor (which happens to
  // reset WebKit's own stale wheel-target tracking). onSpringFrame below
  // clears wheelCommitted/wheelMode for real, once the spring actually
  // settles, so there's nothing left to do with these ticks but consume
  // them.
  if (wheelCommitted) return;

  clearTimeout(wheelIdleTimer);

  if (wheelMode === null) {
    wheelMode = detent !== 'full'
      ? 'resize'
      : ((!contentScrollable() || scrollPos.value <= 0) && e.deltaY < 0 ? 'resize' : 'scroll');
    wheelCommitted = false;
    wheelLastT = null;
    wheelVel = 0;
    size.stop();
    scrollPos.stop();
    watchGuard();
  }

  // dt is only meaningful from this burst's second tick on — the first
  // tick's "elapsed time" is however long it's been since the *previous*
  // burst ended, not a real inter-tick interval, and would otherwise read
  // as an enormous, spurious velocity.
  const now = performance.now();
  const dt = wheelLastT != null ? Math.max(1, now - wheelLastT) : null;
  wheelLastT = now;

  if (wheelMode === 'resize') {
    if (dt != null) {
      const instVel = e.deltaY / dt;
      wheelVel = wheelVel === 0 ? instVel : wheelVel * 0.7 + instVel * 0.3;
    }
    if (dt != null && Math.abs(wheelVel) > FLING_VELOCITY) {
      wheelCommitted = true;
      size.v = wheelVel * 1000; // px/ms → px/s
      snapToDetent(flungDetentKey(size.value, wheelVel > 0 ? 1 : -1, Math.abs(wheelVel)));
      // No idle timer to schedule here — see onSpringFrame, which takes
      // over from this point and clears wheelCommitted/wheelMode once the
      // spring actually settles. Scheduling one anyway would race it: if it
      // fires before the (often longer) settle animation finishes, it'd
      // clear wheelCommitted early and let a stray leftover momentum tick
      // treat it as a brand-new gesture, yanking the animation mid-flight.
      return;
    } else {
      const { min, max } = bounds();
      const next = size.value + e.deltaY;
      if (next > max && contentScrollable()) {
        size.set(max);
        wheelMode = 'scroll';
      } else {
        size.set(next < min ? min + rubber(next - min, GIVE) : next > max ? max + rubber(next - max, GIVE) : next);
      }
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
    if (wheelMode === 'resize' && !wheelCommitted) snapToDetent(nearestDetentKey(size.value));
    else if (wheelMode === 'scroll') settleScroll();
    wheelMode = null;
    wheelCommitted = false;
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

  // The sheet shrinks/grows under the cursor mid-gesture, so the cursor can
  // easily end up over the map while a drag or fling is still live. Rather
  // than chasing that in JS (event redirection, state tracked across
  // bursts, all of it fighting stray trailing wheel ticks), just put a
  // plain element between the map and the sheet that becomes the actual
  // hit-test target for that whole area while busy — invisible, and its
  // one job is to swallow wheel events so they can't reach the map (or
  // trigger the page's own — deliberately overflowing, see
  // campus-map.css — scroll). `pointer-events` toggles with `.busy` (see
  // watchGuard() above): off at rest, so idle clicks/scrolls reach the
  // map normally; the sheet itself sits above this at the same z-index
  // (appended after it, in DOM-order tie-break) so it keeps getting events
  // directly regardless of this guard's state.
  guard = document.createElement('div');
  guard.className = 'campus-sheet-wheel-guard';
  guard.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
  container.appendChild(guard);

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
