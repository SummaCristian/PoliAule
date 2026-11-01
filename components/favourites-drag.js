import { Spring, onSpringFrame } from 'vitrium';
import { springEasing } from '../utils/spring-easing.js';

// Reordering the favourites by dragging, in edit mode (components/favourites.js
// owns the strip and the edit session; this only moves cards around in it).
//
// The card that is picked up stays in the grid and is lifted off it with
// `translate`, `scale` and `rotate` alone, so the whole drag runs on the
// compositor and composes with the cards' own `transform` (hover, press).
// Two springs chase the pointer, a little behind it so the card has some mass,
// and its tilt follows how fast it is moved sideways. When the pointer crosses
// into a neighbour's middle the card takes that place in the DOM, the others
// glide over (the same spring as utils/layout-flip.js), and the card's own
// offset is corrected by the jump of its layout box in the same frame, so it
// never moves on screen. Letting go flings the springs the last velocity and
// they settle on the slot; only then is anything written.
//
// On desktop, dragging out of the section takes the card out of the flow
// (position: fixed, still under the pointer) so the gap closes, and dropping it
// there unstars it.
//
// A mouse or pen starts after a few pixels. A finger has to rest on a card for a
// moment first: a quicker move is the page scrolling, and is left alone.
//
// What the springs, the geometry and the hit-test are made of is exported for
// components/favourites-drop.js, which drags a card of the results in with the
// same feel.

export const MOUSE_SLOP = 5;   // px a mouse moves before the card is picked up
const HOLD_MS = 180;         // a finger rests this long to pick a card up
const TOUCH_SLOP = 8;        // px it may drift meanwhile; more is a scroll
export const LIFT = 0.05;           // how much bigger the card gets in the hand
export const TILT_MAX = 6;          // deg
export const TILT_PER_SPEED = 0.004;   // deg per px/s of sideways speed
export const VELOCITY_WINDOW = 80;  // ms of pointer samples the velocity is read from
export const MAX_RELEASE_SPEED = 2400;   // px/s
const ZONE = 0.25;           // how far from a card's middle the dragged one swaps places
export const EDGE = 64;             // px inside the visible band where the page scrolls
export const EDGE_SPEED = 900;      // px/s of scroll at the very edge
const OUT_MARGIN = 48;       // px past the section before the card counts as taken out
const IN_MARGIN = 12;        // and back inside it

// Stiff, but not rigid: the lag is what makes it feel carried.
export const FOLLOW = { stiffness: 1200, damping: 54, mass: 0.6 };
export const TILT = { stiffness: 260, damping: 20, mass: 1 };
export const LIFT_IN = { stiffness: 500, damping: 25, mass: 0.5 };
// Softer than following, so a flick overshoots its slot a little.
export const DROP = { stiffness: 420, damping: 32, mass: 1 };
export const DROP_TILT = { stiffness: 300, damping: 18, mass: 1 };
export const LIFT_OUT = { stiffness: 350, damping: 30, mass: 0.8 };

export const MOVE = springEasing({ stiffness: 240, damping: 30, mass: 1 });
const LEAVE = { duration: 220, easing: 'cubic-bezier(0.4, 0, 1, 1)' };

const _reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const _desktop = window.matchMedia('(min-width: 1100px)');

let _o = null;         // what favourites.js hands over, see initFavouritesDrag
let _enabled = false;
let _press = null;     // a pointer is down on a card, not yet a drag
let _s = null;         // the drag, from the pick-up until the card has landed
let _swallowClickUntil = 0;
let _locked = false;   // another drag (favourites-drop.js) has the pointer

// carousel     the strip
// items()      its cards, in order (the one being dragged included)
// canDrag()    whether a drag may start at all (edit mode)
// settled()    whether the layout has stopped moving (an enter morph is over)
// commit(keys) the order the drag ended with
// onEnd()      the drag is over and the strip is as the session has it
export function initFavouritesDrag(options) {
  _o = options;
}

export const isFavouritesDragging = () => !!_s;

// One drag at a time: while the drop from the results is under way, no card
// of the strip is picked up.
export function setFavouritesDragLocked(on) {
  _locked = on;
  if (on) _cancelPress();
}

// The click that ends a drag is not a tap on whatever is under it.
export const swallowClicksFor = (ms) => { _swallowClickUntil = performance.now() + ms; };

// Drags are only picked up while editing. The touchmove listener must exist
// before a touch starts (one added mid-gesture can't cancel the scroll).
export function setFavouritesDragEnabled(on) {
  if (on === _enabled || !_o) return;
  _enabled = on;
  const c = _o.carousel;
  const method = on ? 'addEventListener' : 'removeEventListener';
  c[method]('pointerdown', _onDown, true);
  c[method]('touchmove', _onTouchMove, { passive: false });
  c[method]('contextmenu', _onContextMenu);
  c[method]('dragstart', _onNativeDrag);
  if (!on) cancelFavouritesDrag();
}

// Ends a drag at once, wherever it is, for what has to change the strip under
// it (undo, leaving the edit, a refresh): the card goes back to where it was
// picked up. One that was already let go is let land where it was dropped.
export function cancelFavouritesDrag() {
  _cancelPress();
  const s = _s;
  if (!s) return;
  if (s.phase === 'landing') { _finish(s, { commit: true }); return; }
  _stopFollowing(s);
  _cancelGlides(s.list);
  s.list = [...s.startList];
  _finish(s, { commit: false });
}

// ── Pick-up ───────────────────────────────────────────────────────────────

function _onDown(e) {
  if (_s || _press || _locked || !_o.canDrag()) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (e.target.closest?.('.fav-remove')) return;
  const el = e.target.closest?.('[data-fav-key]');
  if (!el || !_o.carousel.contains(el) || el.classList.contains('fav-leaving')) return;

  _press = { el, key: el.dataset.favKey, id: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, timer: 0 };
  window.addEventListener('pointermove', _onMove);
  window.addEventListener('pointerup', _onUp);
  window.addEventListener('pointercancel', _onCancel);
  window.addEventListener('blur', _onBlur);
  if (e.pointerType === 'touch') {
    _press.timer = setTimeout(() => { _press.timer = 0; _begin(); }, HOLD_MS);
  }
}

function _cancelPress() {
  if (!_press) return;
  clearTimeout(_press.timer);
  _press = null;
  if (!_s) _removeWindowListeners();
}

function _removeWindowListeners() {
  window.removeEventListener('pointermove', _onMove);
  window.removeEventListener('pointerup', _onUp);
  window.removeEventListener('pointercancel', _onCancel);
  window.removeEventListener('blur', _onBlur);
}

function _onMove(e) {
  const p = _press;
  if (!p || e.pointerId !== p.id) return;
  p.x = e.clientX;
  p.y = e.clientY;
  if (_s) { _track(_s, e); return; }
  const moved = Math.hypot(p.x - p.x0, p.y - p.y0);
  if (p.type === 'touch') {
    // Moved before the hold was up: the page is being scrolled
    if (moved > TOUCH_SLOP) _cancelPress();
  } else if (moved > MOUSE_SLOP) {
    _begin();
  }
}

function _onUp(e) {
  if (!_press || e.pointerId !== _press.id) return;
  if (_s) _release(_s);
  else _cancelPress();
}

function _onCancel(e) {
  if (!_press || e.pointerId !== _press.id) return;
  if (_s) _abort(_s);
  else _cancelPress();
}

// The window lost focus with the button down: no pointerup is coming.
function _onBlur() {
  if (_s && _s.phase === 'drag') _abort(_s);
  else _cancelPress();
}

// A finger that has held still long enough scrolls nothing from here on.
function _onTouchMove(e) {
  if (_s && _s.phase === 'drag' && e.cancelable) e.preventDefault();
}

// The long press of a finger would open the system menu; so would a released
// drag's click.
function _onContextMenu(e) {
  if (_press || _s) e.preventDefault();
}

function _onNativeDrag(e) {
  if (e.target.closest?.('[data-fav-key]')) e.preventDefault();
}

// The click that follows the end of a drag is not a tap on whatever is under it.
function _swallowClick(e) {
  if (performance.now() < _swallowClickUntil) {
    e.stopPropagation();
    e.preventDefault();
  }
}
window.addEventListener('click', _swallowClick, true);

// ── Geometry ──────────────────────────────────────────────────────────────

const _translateOf = (el) => {
  const [x = 0, y = 0] = getComputedStyle(el).translate.split(' ').map(parseFloat);
  return { x: x || 0, y: y || 0 };
};

// Where an element is on screen, whatever its wiggle and hover do to its box
// (they turn and grow it about its middle).
function _centre(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

// Where its layout box is, not counting a glide that is still running on it.
function _layoutCentre(el) {
  const c = _centre(el), t = _translateOf(el);
  return { x: c.x - t.x, y: c.y - t.y };
}

// The glides this module (or favourites.js's list animation) runs on translate
const _glidesOf = (el) => el.getAnimations().filter(a =>
  !(a instanceof CSSAnimation || a instanceof CSSTransition) &&
  a.effect?.getKeyframes?.().some(k => k.translate !== undefined));

// All the reads first, then the cancels: each cancel would make the next
// getAnimations() restyle again.
const _cancelGlides = (els) => els.flatMap(_glidesOf).forEach(a => a.cancel());

export { _centre as centreOf, _layoutCentre as layoutCentreOf, _cancelGlides as cancelGlides };

// The cards' places in the grid, in order, taken without any glide on them.
function _measureSlots(s) {
  s.slots = s.list.filter(el => !el.classList.contains('fav-out')).map(el => {
    const c = _layoutCentre(el);
    return { el, x: c.x, y: c.y, w: el.offsetWidth, h: el.offsetHeight };
  });
  s.slotsAt = s.scrollNow = window.scrollY;
}

// The same, from the centres a reflow has just read.
function _setSlots(s, centres) {
  s.slots = s.list.filter(el => !el.classList.contains('fav-out')).map(el => {
    const c = centres.get(el);
    return { el, x: c.x, y: c.y, w: el.offsetWidth, h: el.offsetHeight };
  });
  s.slotsAt = s.scrollNow = window.scrollY;
}

// The section the card is taken out of: its top and sides, and the strip's own
// bottom (the section is taller than its cards when it spans the column).
function _measureZone(s) {
  const r = s.section.getBoundingClientRect();
  s.zone = { left: r.left, right: r.right, top: r.top, bottom: _o.carousel.getBoundingClientRect().bottom };
  s.zoneAt = window.scrollY;
}

// The part of the screen where a card can be put down: under the fixed header
// (and the pickers riding under it), above the tab bar when it is a row.
export function measureBand() {
  const header = document.querySelector('.header');
  let top = header ? header.getBoundingClientRect().bottom : 0;
  const form = document.getElementById('available-classrooms-form');
  if (form && getComputedStyle(form).position === 'sticky') {
    const r = form.getBoundingClientRect();
    if (r.top <= top + 2 && r.bottom > top) top = r.bottom;
  }
  let bottom = window.innerHeight;
  const nav = document.getElementById('bn-wrapper');
  const bar = nav?.querySelector('.lg-tabbar__bar');
  if (bar && !nav.classList.contains('lg-tabbar--vertical')) {
    const barTop = bar.getBoundingClientRect().top;
    if (barTop > top) bottom = Math.min(bottom, barTop);
  }
  return { top, bottom };
}

const _measureBand = (s) => { s.band = measureBand(); };

// ── The drag ──────────────────────────────────────────────────────────────

function _begin() {
  const p = _press;
  if (!p || _s) return;
  p.timer = 0;
  // Pressed while the grid is still morphing into place: the card is on its way,
  // and cancelling its glide would leave the morph unfinished. Pick it up as
  // soon as it has landed.
  if (!_o.settled()) {
    if (!p.waiting) {
      p.waiting = true;
      p.timer = setTimeout(() => { p.waiting = false; p.timer = 0; _begin(); }, 40);
    }
    return;
  }
  // The strip may have been rebuilt under the finger (fresh data landing): the
  // card pressed is then its replacement, found by its key.
  const el = p.el.isConnected ? p.el : _o.items().find(i => i.dataset.favKey === p.key);
  if (!el) { _cancelPress(); return; }

  // Where it visibly is right now: it may be mid-glide from a reflow, and the
  // wiggle is turning it.
  const cs = getComputedStyle(el);
  const t0 = _translateOf(el);
  const rot0 = parseFloat(cs.rotate) || 0;
  for (const a of el.getAnimations()) if (!(a instanceof CSSAnimation || a instanceof CSSTransition)) a.finish();
  _cancelGlides([el]);

  const vis = _centre(el);
  const items = _o.items();
  const s = _s = {
    el, id: p.id, type: p.type, phase: 'drag',
    key: el.dataset.favKey,
    startKeys: items.map(i => i.dataset.favKey),
    // The order the cards are in as the drag goes: only their `order` changes
    // meanwhile, and the DOM follows once the card has landed. (Moving a card
    // in the DOM rebuilds its whole box tree, ~10 ms, on every reorder.)
    list: items, startList: [...items],
    hadFocus: document.activeElement === el,
    section: _o.carousel.closest('.favourites-section') ?? _o.carousel,
    px: p.x, py: p.y,
    // Where the pointer holds it, from its middle. The card grows in the hand,
    // so this is scaled by it, and the grabbed spot stays under the pointer.
    gx: p.x - vis.x, gy: p.y - vis.y,
    c0: { x: vis.x - t0.x, y: vis.y - t0.y }, c0At: window.scrollY, scrollNow: window.scrollY, fixed: false,
    samples: [{ t: performance.now(), x: p.x, y: p.y }],
    sx: new Spring(t0.x), sy: new Spring(t0.y), sr: new Spring(rot0), sl: new Spring(0),
    out: false,
    canOut: p.type !== 'touch' && _desktop.matches,
    armedTop: false, armedBottom: false, scrollRest: 0, lastT: 0, raf: 0,
    fx: null, offFrame: null,
  };
  s.sl.eps = 0.002;
  _setOrder(s);
  _measureSlots(s);
  _measureBand(s);
  if (s.canOut) _measureZone(s);
  s.armedTop = s.py >= s.band.top + EDGE;
  s.armedBottom = s.py <= s.band.bottom - EDGE;

  // The wiggle can't be overridden from an inline style, only switched off.
  // The card turns from wherever the wiggle had it.
  el.style.animation = 'none';
  el.classList.add('fav-held');
  s.fx = document.createElement('span');
  s.fx.className = 'fav-lift';
  s.fx.setAttribute('aria-hidden', 'true');
  s.fx.innerHTML = '<span class="fav-lift-veil"><i class="hgi-stroke hgi-minus-sign"></i></span>';
  el.appendChild(s.fx);
  // Chrome would "fix" the scroll position as the cards reflow under the finger
  s.section.style.overflowAnchor = 'none';

  s.offFrame = onSpringFrame(() => _render(s));
  _render(s);
  // Next frame, so the shadow fades in from nothing
  requestAnimationFrame(() => { if (_s === s && s.phase === 'drag') el.classList.add('fav-dragging'); });
  s.sl.to(1, LIFT_IN);

  window.addEventListener('resize', _onResize);
  // The band can change as the page scrolls: the pickers turn sticky below the header
  window.addEventListener('scroll', s.onScroll = () => { s.scrollNow = window.scrollY; _measureBand(s); }, { passive: true });
  // Something above resized (a banner sliding in, data landing): where the cards are
  // is not where they were measured
  const first = { skip: true };
  s.observer = new ResizeObserver(() => { if (first.skip) { first.skip = false; return; } if (_s === s && s.phase === 'drag') _remeasure(s); });
  s.observer.observe(document.getElementById('available-classrooms-container') ?? s.section);
  s.scrollMax = document.documentElement.scrollHeight - window.innerHeight;
  s.lastT = performance.now();
  s.raf = requestAnimationFrame((now) => _tick(s, now));
}

const _onResize = () => cancelFavouritesDrag();

function _track(s, e) {
  s.px = e.clientX;
  s.py = e.clientY;
  const now = performance.now();
  s.samples.push({ t: now, x: s.px, y: s.py });
  while (s.samples.length > 2 && now - s.samples[0].t > VELOCITY_WINDOW * 2) s.samples.shift();
  if (e.pointerType === 'mouse' && !(e.buttons & 1)) _release(s);
}

// Pointer speed (px/s) over the last stretch of samples; none if it has rested.
export function pointerVelocity(samples) {
  const now = performance.now();
  const recent = samples.filter(m => now - m.t <= VELOCITY_WINDOW);
  if (recent.length < 2) return { x: 0, y: 0 };
  const a = recent[0], b = recent.at(-1);
  const dt = (b.t - a.t) / 1000;
  return dt > 0 ? { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt } : { x: 0, y: 0 };
}

const _scale = (s) => 1 + LIFT * s.sl.value;

// The card's layout centre on screen now: it moves with the page, unless it
// has been taken out of it.
function _origin(s) {
  return { x: s.c0.x, y: s.fixed ? s.c0.y : s.c0.y - (s.scrollNow - s.c0At) };
}

function _render(s) {
  const st = s.el.style;
  st.translate = `${s.sx.value.toFixed(2)}px ${s.sy.value.toFixed(2)}px`;
  st.scale = _scale(s).toFixed(4);
  st.rotate = `${s.sr.value.toFixed(3)}deg`;
  if (s.phase === 'landing' && s.sx.resting && s.sy.resting && s.sr.resting && s.sl.resting) _land(s);
}

const _chase = (spring, target, config) => {
  if (spring.resting && spring.target === target) return;
  spring.to(target, config);
};
export { _chase as chase };

function _tick(s, now) {
  if (_s !== s || s.phase !== 'drag') return;
  const dt = Math.min(0.05, (now - s.lastT) / 1000);
  s.lastT = now;
  _autoScroll(s, dt);
  _follow(s);
  s.raf = requestAnimationFrame((t) => _tick(s, t));
}

function _follow(s) {
  const sc = _scale(s);
  const o = _origin(s);
  _chase(s.sx, s.px - sc * s.gx - o.x, FOLLOW);
  _chase(s.sy, s.py - sc * s.gy - o.y, FOLLOW);
  if (!_reduceMotion.matches) {
    const tilt = Math.max(-TILT_MAX, Math.min(TILT_MAX, pointerVelocity(s.samples).x * TILT_PER_SPEED));
    _chase(s.sr, tilt, TILT);
  }

  if (s.canOut && _checkOut(s)) return;
  if (s.out) return;
  // Where the card's middle is held, not where the spring has got to
  const to = hitSlot(s, { x: s.px - sc * s.gx, y: s.py - sc * s.gy });
  if (to !== s.slots.findIndex(sl => sl.el === s.el)) _moveTo(s, to);
}

// ── Where it goes ─────────────────────────────────────────────────────────

// The slot index the card at `mid` (viewport) belongs in: the one whose middle
// it has come into, or the ends when it is past them. Its own slot otherwise,
// so there is a dead band between two cards and a card never flickers at the
// boundary.
export function hitSlot(s, mid) {
  const slots = s.slots, shift = s.scrollNow - s.slotsAt;
  const own = slots.findIndex(sl => sl.el === s.el);
  for (let i = 0; i < slots.length; i++) {
    if (i === own) continue;
    const sl = slots[i];
    if (Math.abs(mid.x - sl.x) <= ZONE * sl.w && Math.abs(mid.y - (sl.y - shift)) <= ZONE * sl.h) return i;
  }
  const n = slots.length;
  if (n < 2) return own;
  const first = slots[0], last = slots[n - 1];
  const top = Math.min(...slots.map(sl => sl.y - sl.h / 2)) - shift;
  const bottom = Math.max(...slots.map(sl => sl.y + sl.h / 2)) - shift;
  if (mid.y > bottom) return n - 1;
  if (mid.y < top) return 0;
  const inRow = (sl) => Math.abs(mid.y - (sl.y - shift)) <= sl.h / 2 + 8;
  if (mid.x > last.x + last.w / 2 && inRow(last)) return n - 1;
  if (mid.x < first.x - first.w / 2 && inRow(first)) return 0;
  return own;
}

// Puts the card at slot `to` in the DOM. The others glide to where that leaves
// them.
function _moveTo(s, to) {
  _reflow(s, () => {
    const list = s.list.filter(el => el !== s.el);
    list.splice(to, 0, s.el);
    s.list = list;
    _setOrder(s);
  });
}

const _setOrder = (s) => s.list.forEach((el, i) => {
  if (el.style.order !== String(i)) el.style.order = i;
});

// Takes the card's place and everything measured from it afresh, without
// moving it on screen.
function _remeasure(s) {
  _render(s);
  if (!s.fixed) {
    const was = _origin(s);
    const now = _centre(s.el);
    const c = { x: now.x - s.sx.value, y: now.y - s.sy.value };
    s.sx.value -= c.x - was.x; s.sy.value -= c.y - was.y;
    s.sx.target -= c.x - was.x; s.sy.target -= c.y - was.y;
    s.c0 = c;
    s.c0At = s.scrollNow = window.scrollY;
    _render(s);
  }
  _measureSlots(s);
  _measureBand(s);
  if (s.canOut) _measureZone(s);
}

// Runs `change`, which moves the dragged card in the DOM or in or out of the
// flow, then glides every other card from where it was seen to where it is now,
// and corrects the dragged card's offset by what its box jumped, so on screen
// it stays exactly where it was.
function _reflow(s, change) {
  const others = s.list.filter(el => el !== s.el);
  _render(s);
  const was = _origin(s);
  const from = others.map(_centre);
  _cancelGlides(others);

  change();

  // Centres of the others' boxes, and the card's own, in their new places. All
  // read before anything is written again.
  const to = others.map(_centre);
  const now = _centre(s.el);
  const c = { x: now.x - s.sx.value, y: now.y - s.sy.value };
  // The springs' targets are in the same frame of reference, and the spring loop
  // may step before the next tick sets them again: left alone, it would pull the
  // card toward where the target was.
  s.sx.value -= c.x - was.x;
  s.sy.value -= c.y - was.y;
  s.sx.target -= c.x - was.x;
  s.sy.target -= c.y - was.y;
  s.c0 = c;
  s.c0At = s.scrollNow = window.scrollY;
  const centres = new Map(others.map((el, i) => [el, to[i]]));
  centres.set(s.el, c);
  _setSlots(s, centres);
  if (s.canOut) _measureZone(s);
  _render(s);

  if (!_reduceMotion.matches) {
    others.forEach((el, i) => {
      const dx = from[i].x - to[i].x, dy = from[i].y - to[i].y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      el.animate({ translate: [`${dx}px ${dy}px`, '0 0'] }, MOVE);
    });
  }
}

// ── Out of the section (desktop): the card is taken out, to be removed ────

function _checkOut(s) {
  const z = s.zone, shift = s.scrollNow - s.zoneAt;
  const m = s.out ? IN_MARGIN : OUT_MARGIN;
  const inside = s.px >= z.left - m && s.px <= z.right + m && s.py >= z.top - shift - m && s.py <= z.bottom - shift + m;
  if (!s.out && !inside) { _takeOut(s); return true; }
  if (s.out && inside) { _bringBack(s); return true; }
  return false;
}

function _takeOut(s) {
  const el = s.el;
  _reflow(s, () => {
    const o = _origin(s);
    Object.assign(el.style, {
      position: 'fixed', margin: '0',
      left: `${o.x - el.offsetWidth / 2}px`, top: `${o.y - el.offsetHeight / 2}px`,
      width: `${el.offsetWidth}px`, height: `${el.offsetHeight}px`,
    });
    el.classList.add('fav-out');
    s.fixed = true;
  });
  s.out = true;
}

function _bringBack(s) {
  const el = s.el;
  // Back in the DOM where it was taken out at; the pointer finds its place
  // among the others on the next frames.
  _reflow(s, () => {
    for (const p of ['position', 'margin', 'left', 'top', 'width', 'height']) el.style.removeProperty(p);
    el.classList.remove('fav-out');
    s.fixed = false;
  });
  s.out = false;
}

// ── Edge scroll ───────────────────────────────────────────────────────────

function _autoScroll(s, dt) {
  if (!dt) return;
  const { top, bottom } = s.band;
  const zoneTop = top + EDGE, zoneBottom = bottom - EDGE;
  // A card picked up inside a zone doesn't start scrolling until it has left it
  if (s.py >= zoneTop) s.armedTop = true;
  if (s.py <= zoneBottom) s.armedBottom = true;

  const room = s.scrollMax - s.scrollNow;
  let v = 0;
  if (s.armedTop && s.py < zoneTop && s.scrollNow > 0) {
    v = -EDGE_SPEED * Math.min(1, (zoneTop - s.py) / EDGE) ** 2;
  } else if (s.armedBottom && s.py > zoneBottom && room > 1) {
    v = EDGE_SPEED * Math.min(1, (s.py - zoneBottom) / EDGE) ** 2;
  }
  if (!v) { s.scrollRest = 0; return; }

  // Scroll positions are whole pixels on a 1x screen: keep what is left over
  s.scrollRest += v * dt;
  const step = Math.trunc(s.scrollRest);
  if (!step) return;
  s.scrollRest -= step;
  window.scrollBy({ top: step, behavior: 'instant' });
  const was = s.scrollNow;
  s.scrollNow = window.scrollY;
  // The cards move up with the page; this one is to stay where it is on screen,
  // not trail behind the finger by the spring's lag
  if (!s.fixed) {
    s.sy.value += s.scrollNow - was;
    // In this frame, with the scroll: the spring loop may not run until the next
    _render(s);
  }
}

// ── Letting go ────────────────────────────────────────────────────────────

function _stopFollowing(s) {
  cancelAnimationFrame(s.raf);
  s.phase = 'ending';
}

function _release(s) {
  if (s.phase !== 'drag') return;
  _stopFollowing(s);
  _removeWindowListeners();
  window.removeEventListener('resize', _onResize);
  _press = null;
  // The click that comes with the button going up, right away
  _swallowClickUntil = performance.now() + 120;

  if (s.out) { _drop(s); return; }

  _settle(s, pointerVelocity(s.samples));
}

// A pointer that is cancelled (a scroll took the touch, the window lost focus)
// puts the card back where it was picked up, with the same reflow.
function _abort(s) {
  if (s.phase !== 'drag') return;
  _stopFollowing(s);
  _removeWindowListeners();
  window.removeEventListener('resize', _onResize);
  _press = null;
  if (s.out) _bringBack(s);
  if (s.list.some((el, i) => el !== s.startList[i])) {
    _reflow(s, () => { s.list = [...s.startList]; _setOrder(s); });
  }
  s.aborted = true;
  _settle(s, { x: 0, y: 0 });
}

// The card springs onto its slot with the speed it was let go with, and the
// tilt and the lift settle with it.
function _settle(s, v) {
  s.phase = 'landing';
  s.el.classList.remove('fav-dragging');
  if (_reduceMotion.matches) {
    const from = `${s.sx.value}px ${s.sy.value}px`;
    s.sl.set(0); s.sr.set(0);
    _render(s);
    s.snap = s.el.animate({ translate: [from, '0 0'] }, { duration: 140, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
    s.snap.finished.then(() => _land(s), () => _land(s));
    return;
  }
  const cap = (n) => Math.max(-MAX_RELEASE_SPEED, Math.min(MAX_RELEASE_SPEED, n));
  s.sx.v = cap(v.x);
  s.sy.v = cap(v.y);
  s.sx.to(0, DROP);
  s.sy.to(0, DROP);
  s.sr.to(0, DROP_TILT);
  s.sl.to(0, LIFT_OUT);
}

function _land(s) {
  if (_s !== s || s.phase !== 'landing') return;
  _finish(s, { commit: !s.aborted });
}

// Dropped outside the section: it shrinks away where it was let go, and the
// list loses it.
function _drop(s) {
  const el = s.el;
  const rest = s.list.map(i => i.dataset.favKey).filter(k => k !== s.key);
  _render(s);
  _teardown(s, { keepLook: true });
  // Cleared first: committing may bring the strip to rerender
  _s = null;
  const scale = getComputedStyle(el).scale;
  const frames = { opacity: [1, 0], scale: [scale === 'none' ? '1' : scale, '0.8'] };
  if (rest.length) {
    // The strip no longer counts it, so it can leave on its own
    el.classList.add('fav-leaving');
    el.inert = true;
    _o.commit(rest);
    el.animate(frames, { ...LEAVE, fill: 'forwards' }).finished.then(() => el.remove(), () => el.remove());
  } else {
    // The last one goes the strip's own way (it is still a card of it), which
    // would take it back to its place: put it where it was let go, and shrink
    // from there.
    const held = {};
    for (const p of ['position', 'margin', 'left', 'top', 'width', 'height', 'translate', 'scale', 'rotate']) held[p] = el.style.getPropertyValue(p);
    _o.commit(rest);
    if (el.isConnected) {
      Object.assign(el.style, held);
      for (const a of el.getAnimations()) {
        if (a.effect?.getKeyframes?.().some(k => k.scale !== undefined)) a.effect.setKeyframes(frames);
      }
    }
  }
  _o.onEnd();
}

// Everything the drag put on the page, and on the card too unless it is about
// to leave where it is.
function _teardown(s, { keepLook = false } = {}) {
  cancelAnimationFrame(s.raf);
  s.offFrame?.();
  s.offFrame = null;
  s.snap?.cancel();
  for (const sp of [s.sx, s.sy, s.sr, s.sl]) sp.dispose();
  window.removeEventListener('resize', _onResize);
  window.removeEventListener('scroll', s.onScroll);
  s.observer?.disconnect();
  _removeWindowListeners();
  _press = null;
  // Anchoring stays off a little longer: moving the card in the DOM, as the
  // drag ends, would otherwise have the page scroll to "keep" its old place.
  const section = s.section;
  requestAnimationFrame(() => requestAnimationFrame(() => { if (!_s) section.style.removeProperty('overflow-anchor'); }));
  s.list.forEach(el => el.style.removeProperty('order'));
  if (keepLook) return;
  s.fx?.remove();
  s.el.classList.remove('fav-dragging', 'fav-held', 'fav-out');
  for (const p of ['translate', 'scale', 'rotate', 'animation', 'position', 'margin', 'left', 'top', 'width', 'height']) {
    s.el.style.removeProperty(p);
  }
}

// It has landed: the styles come off in this very frame, the order is written.
function _finish(s, { commit }) {
  if (_s !== s) return;
  const el = s.el;
  // The wiggle takes over from a card at rest, so it starts where the angle is 0
  // (half an iteration in) instead of snapping to some other angle.
  const dur = parseFloat(el.style.getPropertyValue('--fav-wiggle-dur')) || 280;
  _teardown(s);
  if (el.isConnected && el.style.getPropertyValue('--fav-wiggle-dur')) {
    el.style.setProperty('--fav-wiggle-delay', `${-dur / 2}ms`);
  }
  const keys = s.list.map(i => i.dataset.favKey);
  const changed = keys.some((k, i) => k !== s.startKeys[i]);
  // The card takes its place in the DOM too, in the same frame the `order`s
  // come off, so nothing moves
  if (changed && el.isConnected) {
    const next = s.list[s.list.indexOf(el) + 1];
    _o.carousel.insertBefore(el, next?.isConnected ? next : null);
  }
  _s = null;
  if (s.hadFocus && el.isConnected) el.focus({ preventScroll: true });
  if (commit && changed) _o.commit(keys);
  _o.onEnd();
}
