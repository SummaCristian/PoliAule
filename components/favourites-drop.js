import { Spring, onSpringFrame } from 'vitrium';
import {
  FOLLOW, TILT, DROP, DROP_TILT, LIFT, LIFT_IN, LIFT_OUT, MOVE, TILT_MAX, TILT_PER_SPEED,
  MAX_RELEASE_SPEED, EDGE, EDGE_SPEED, MOUSE_SLOP,
  pointerVelocity, measureBand, hitSlot, chase, centreOf, layoutCentreOf, cancelGlides, swallowClicksFor,
  setFavouritesDragLocked, isFavouritesDragging,
} from './favourites-drag.js';
import { hideCardDayPopover } from './card-day-popover.js';

// Starring a classroom by dragging its card from the results into the
// Favourites, at the place it is let go (desktop, mouse or pen; components/
// favourites.js owns the strip and hands over what this needs).
//
// The card stays where it is, dimmed, and a copy of it, the token, floats in a
// layer of its own above the page, following the pointer with the same springs
// as a card dragged inside the strip (components/favourites-drag.js). Over the
// Favourites the real favourite card is put in the strip at the place the token
// is held (the others make room, with the same glide as every other reflow)
// but kept invisible, and the token turns into it: the favourite card's own
// look fades in over the results card's, and its box grows to the favourite
// card's size. Let go there, and the token springs into the place, where it is
// swapped for the card in a single frame: it is the same picture, so nothing
// moves. Let go anywhere else, or press Escape, and it springs back onto the
// card it came from and fades into it.
//
// Like the reorder, the strip's cards are moved around with their `order` only
// and the DOM follows once the card has landed. A card that is a favourite
// already is its own place: it is the invisible one, and the drop moves it.
//
// The layer is only as big as the screen minus its safe areas, and sits under
// the header and the tab bar. The token is moved, scaled and turned from script
// with compositor properties alone, and nothing is read from the layout while
// it follows the pointer. Only once it has come to rest is it laid out like the
// card, for the one frame before the swap (see _arrived).

const IN_MARGIN = 24;        // px around the Favourites section where a drop is taken in
const OUT_MARGIN = 40;       // and where it is let go of again
const STRIP_EDGE = 48;       // px inside the strip's ends where it scrolls sideways
const HOLD = 0.12;           // how far (in cards) past the middle a card is held before it moves on
const FADE_OUT = 180;        // ms the token takes to fade into the card it returned to

// The look and the size of the token, between the results card and the favourite
const MORPH = { stiffness: 260, damping: 26, mass: 1 };

const _reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const _desktop = window.matchMedia('(min-width: 1100px)');

let _o = null;         // what favourites.js hands over, see initFavouritesDrop
let _press = null;     // a pointer is down on a results card, not yet a drag
let _s = null;         // the drag, from the pick-up until the token has landed or returned
let _snapRestore = null;   // gives the strip its snapping back, once it is scrolled again

// results         the results panel (#available-classrooms-results)
// carousel        the strip
// items()         its cards, in order
// existing(key)   the card of a favourite, or null
// build(key)      a new favourite card, or null for a classroom that is not in the directory
// settled()       whether the layout has stopped moving (a morph is over)
// isGrid()        whether the favourites are laid out as a grid (else the strip scrolls sideways)
// isEmpty()       whether there is no favourite at all (the section shows its empty line)
// setEmpty(bool)  switches the section between the empty line and the strip
// resizeSection(section, from, 'in' | 'out')   the section's own growing and shrinking
// commit({ key, keys, index })   the card is in its place: `keys` is the strip's order
// onEnd()         the drag is over and the strip is as it should be
export function initFavouritesDrop(options) {
  _o = options;
  _o.results.addEventListener('pointerdown', _onDown);
}

export const isFavouritesDropping = () => !!_s;

// Ends a drag at once, wherever it is, for what has to change the strip under
// it: the token goes back where it came from. One that has been let go lands
// (or finishes returning) where it was going.
export function cancelFavouritesDrop() {
  _cancelPress();
  const s = _s;
  if (!s) return;
  if (s.phase === 'drag') _cancel(s);
  else if (s.phase === 'landing') _land(s);
  else if (s.phase === 'returning') _returned(s);
}

// ── Pick-up ───────────────────────────────────────────────────────────────

function _onDown(e) {
  if (_s || _press || !_desktop.matches || e.pointerType === 'touch') return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const card = e.target.closest?.('.classroom-card[data-open-classroom]');
  if (!card || !_o.results.contains(card)) return;

  _press = { card, key: String(Number(card.dataset.openClassroom)), id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
  window.addEventListener('pointermove', _onMove);
  window.addEventListener('pointerup', _onUp);
  window.addEventListener('pointercancel', _onCancel);
  window.addEventListener('blur', _onBlur);
  // The browser's own drag of a photo, and the text selection that follows the
  // pointer across the page, would take the gesture over
  document.addEventListener('dragstart', _stopNative, true);
  document.addEventListener('selectstart', _stopNative, true);
}

function _stopNative(e) {
  e.preventDefault();
}

function _cancelPress() {
  if (!_press) return;
  _press = null;
  if (!_s) _removeWindowListeners();
}

function _removeWindowListeners() {
  window.removeEventListener('pointermove', _onMove);
  window.removeEventListener('pointerup', _onUp);
  window.removeEventListener('pointercancel', _onCancel);
  window.removeEventListener('blur', _onBlur);
  document.removeEventListener('dragstart', _stopNative, true);
  document.removeEventListener('selectstart', _stopNative, true);
}

function _onMove(e) {
  const p = _press;
  if (!p || e.pointerId !== p.id) return;
  p.x = e.clientX;
  p.y = e.clientY;
  if (_s) { _track(_s, e); return; }
  if (Math.hypot(p.x - p.x0, p.y - p.y0) > MOUSE_SLOP) _begin();
}

function _onUp(e) {
  if (!_press || e.pointerId !== _press.id) return;
  if (_s) _release(_s);
  else _cancelPress();
}

function _onCancel(e) {
  if (!_press || e.pointerId !== _press.id) return;
  if (_s) _cancel(_s);
  else _cancelPress();
}

// The window lost focus with the button down: no pointerup is coming.
function _onBlur() {
  if (_s && _s.phase === 'drag') _cancel(_s);
  else _cancelPress();
}

function _onKey(e) {
  if (e.key !== 'Escape' || !_s || _s.phase !== 'drag') return;
  // Not the edit mode's: only the drag is called off
  e.preventDefault();
  e.stopPropagation();
  _cancel(_s);
}

const _onResize = () => cancelFavouritesDrop();

// ── The token ─────────────────────────────────────────────────────────────

// A card to be shown in the token: a still copy of it, filling its box.
function _copyOf(card) {
  const c = card.cloneNode(true);
  for (const a of ['data-open-classroom', 'data-fav-star', 'data-fav-key', 'tabindex', 'role', 'aria-label']) c.removeAttribute(a);
  for (const p of ['view-transition-name', 'translate', 'scale', 'rotate', 'order', 'opacity', 'animation']) c.style.removeProperty(p);
  c.classList.remove('classroom-card--pressed', 'fav-placeholder');
  c.inert = true;
  c.querySelector(':scope > .fav-remove')?.style.setProperty('animation', 'none');
  Object.assign(c.style, { position: 'absolute', margin: '0', transition: 'none', contentVisibility: 'visible' });
  return c;
}

// Layout size, not the rounded offsetWidth: a grid track is a fraction of a pixel
// wider, and the token has to end up the card's exact size.
function _sizeOf(el) {
  const cs = getComputedStyle(el);
  return { w: parseFloat(cs.width), h: parseFloat(cs.height) };
}

// The label's text is fitted to the card's width a frame after it is built (see
// classroom-list.js), so a copy made earlier may still be showing the long form.
function _syncLabel(from, to) {
  const a = from.querySelector('.classroom-status-txt'), b = to.querySelector('.classroom-status-txt');
  if (a && b) { b.textContent = a.textContent; b.className = a.className; }
}

// The copy of the favourite card, laid over the results card's: its look fades
// in as the token turns into it. Made once the card has been laid out and fitted.
function _addFavouriteFace(s) {
  const ph = s.placeholder;
  if (s.faceTo || !ph?.isConnected) return;
  const face = s.faceTo = _copyOf(ph);
  Object.assign(face.style, {
    left: '50%', top: '50%', width: `${s.fw * s.W}px`, height: `${s.fh * s.H}px`,
    translate: '-50% -50%', scale: `${1 / s.fw} ${1 / s.fh}`, opacity: '0',
  });
  s.token.insertBefore(face, s.lift);
  _syncLabel(ph, face);
  _render(s);
}

// ── The drag ──────────────────────────────────────────────────────────────

function _begin() {
  const p = _press;
  if (!p || _s) return;
  // Pressed while the grid is still morphing into place: picked up by a later move
  if (!_o.settled()) return;
  if (isFavouritesDragging() || !p.card.isConnected) { _cancelPress(); return; }

  const card = p.card;
  const rect = card.getBoundingClientRect();
  const { w: W, h: H } = _sizeOf(card);
  // The card is a little smaller while it is held down, or bigger under the
  // pointer: the token starts out the size it is seen at
  const ratio = rect.width / W || 1;
  const vis = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };

  const layer = document.createElement('div');
  layer.className = 'fav-drop-layer';
  layer.setAttribute('aria-hidden', 'true');
  const token = document.createElement('div');
  token.className = 'fav-token';
  Object.assign(token.style, { width: `${W}px`, height: `${H}px` });
  const from = _copyOf(card);
  Object.assign(from.style, { left: '0', top: '0', width: '100%', height: '100%' });
  from.classList.add('fav-token-from');
  const lift = document.createElement('span');
  lift.className = 'fav-lift';
  token.append(from, lift);
  layer.appendChild(token);
  document.body.appendChild(layer);
  const origin = layer.getBoundingClientRect();

  const base = _o.items();
  const s = _s = {
    source: card, key: p.key, phase: 'drag', target: null, native: false, snapped: false,
    layer, token, from, lift, faceTo: null, ox: origin.left, oy: origin.top,
    W, H, fw: 1, fh: 1,
    px: p.x, py: p.y,
    // Where the pointer holds it, from its middle, in the card's own size
    gx: (p.x - vis.x) / ratio, gy: (p.y - vis.y) / ratio,
    samples: [{ t: performance.now(), x: p.x, y: p.y }],
    sx: new Spring(vis.x), sy: new Spring(vis.y), sr: new Spring(0), sk: new Spring(ratio), sm: new Spring(0),
    // The strip's cards as they are, and in the order the drag has them in. Only
    // their `order` changes meanwhile, and the DOM follows once the token has
    // landed.
    base, list: [...base], existing: base.find(el => el.dataset.favKey === p.key) ?? null,
    placeholder: null, isNew: false, index: -1, inZone: false, blocked: false,
    grown: false, growAnims: [],
    section: _o.carousel.closest('.favourites-section') ?? _o.carousel,
    scrollNow: window.scrollY, scrollLeft: _o.carousel.scrollLeft, scrollMaxX: 0, scrollMax: 0, scrollRest: 0,
    armedL: false, armedR: false, armedTop: false, armedBottom: false,
    lastT: 0, raf: 0, offFrame: null, el: null, slots: [], slotsAt: window.scrollY, snap: '',
  };
  s.sm.eps = s.sk.eps = 0.002;
  s.band = measureBand();
  s.strip = _o.carousel.parentElement.getBoundingClientRect();
  s.stripLeft = _o.carousel.getBoundingClientRect().left;
  _measureSlots(s);
  _measureZone(s);

  // From here on the card is not a button: no press, no preview, no hover, no
  // click when the pointer comes up
  card.classList.remove('classroom-card--pressed');
  hideCardDayPopover();
  card.classList.add('fav-drop-source');
  _o.results.closest('#available-classrooms-container')?.classList.add('fav-dropping');
  setFavouritesDragLocked(true);
  s.section.style.overflowAnchor = 'none';
  // Chrome would settle the strip on a card as it is scrolled sideways
  if (!_o.isGrid() && !_snapRestore) { s.snapped = true; s.snap = _o.carousel.style.scrollSnapType; _o.carousel.style.scrollSnapType = 'none'; }

  s.offFrame = onSpringFrame(() => _render(s));
  _render(s);
  // Next frame, so the shadow fades in from nothing
  requestAnimationFrame(() => { if (_s === s && s.phase === 'drag') token.classList.add('fav-dragging'); });
  s.sk.to(1 + LIFT, LIFT_IN);

  window.addEventListener('keydown', _onKey, true);
  window.addEventListener('resize', _onResize);
  window.addEventListener('scroll', s.onScroll = () => { s.scrollNow = window.scrollY; s.band = measureBand(); }, { passive: true });
  _o.carousel.addEventListener('scroll', s.onStripScroll = () => { s.scrollLeft = _o.carousel.scrollLeft; }, { passive: true });
  // Something resized (a banner sliding in, data landing): where things are is
  // not where they were measured
  const first = { skip: true };
  s.observer = new ResizeObserver(() => { if (first.skip) { first.skip = false; return; } if (_s === s && s.phase === 'drag') _remeasure(s); });
  s.observer.observe(document.getElementById('available-classrooms-container') ?? s.section);
  s.scrollMax = document.documentElement.scrollHeight - window.innerHeight;
  s.lastT = performance.now();
  s.raf = requestAnimationFrame((now) => _tick(s, now));
}

function _track(s, e) {
  s.px = e.clientX;
  s.py = e.clientY;
  const now = performance.now();
  s.samples.push({ t: now, x: s.px, y: s.py });
  while (s.samples.length > 2 && now - s.samples[0].t > 160) s.samples.shift();
  if (e.pointerType === 'mouse' && !(e.buttons & 1)) _release(s);
}

// How big the token is now: the hand's lift, and the growth into the favourite card's size.
const _scaleX = (s) => s.sk.value * (1 + (s.fw - 1) * s.sm.value);
const _scaleY = (s) => s.sk.value * (1 + (s.fh - 1) * s.sm.value);

// Where the token's middle is held, not where its spring has got to.
const _held = (s) => ({ x: s.px - _scaleX(s) * s.gx, y: s.py - _scaleY(s) * s.gy });

const _ramp = (n) => Math.min(1, Math.max(0, n)) ** 2;

function _render(s) {
  const k = s.token.style;
  k.translate = `${(s.sx.value - s.W / 2 - s.ox).toFixed(2)}px ${(s.sy.value - s.H / 2 - s.oy).toFixed(2)}px`;
  k.scale = `${_scaleX(s).toFixed(4)} ${_scaleY(s).toFixed(4)}`;
  k.rotate = `${s.sr.value.toFixed(3)}deg`;
  // Neither look is ever see-through for long: one fades in over the other, which
  // goes later, and only the favourite card's is left at the end
  const m = s.sm.value;
  if (s.faceTo) s.faceTo.style.opacity = Math.min(1, Math.max(0, m / 0.65)).toFixed(3);
  s.from.style.opacity = (1 - Math.min(1, Math.max(0, (m - 0.35) / 0.65))).toFixed(3);
  if ((s.phase === 'landing' || s.phase === 'returning') && !s.native && _atRest(s)) _arrived(s);
}

const _atRest = (s) => s.sx.resting && s.sy.resting && s.sr.resting && s.sk.resting && s.sm.resting;

function _tick(s, now) {
  if (_s !== s || s.phase !== 'drag') return;
  const dt = Math.min(0.05, (now - s.lastT) / 1000);
  s.lastT = now;
  // A refresh of the results has replaced the card it was picked up from
  if (!s.source.isConnected) { _cancel(s); return; }
  _checkZone(s);
  if (s.inZone) {
    _autoScroll(s, dt);
    _place(s);
  }
  _follow(s);
  s.raf = requestAnimationFrame((t) => _tick(s, t));
}

function _follow(s) {
  chase(s.sx, s.px - _scaleX(s) * s.gx, FOLLOW);
  chase(s.sy, s.py - _scaleY(s) * s.gy, FOLLOW);
  if (!_reduceMotion.matches) {
    const tilt = Math.max(-TILT_MAX, Math.min(TILT_MAX, pointerVelocity(s.samples).x * TILT_PER_SPEED));
    chase(s.sr, tilt, TILT);
  }
}

// ── Over the Favourites ───────────────────────────────────────────────────

// The section the token is taken in at: its rect, down to the strip's own
// bottom when the section is still growing to it (it was empty).
function _measureZone(s) {
  const r = s.section.getBoundingClientRect();
  const c = _o.carousel;
  let bottom = r.bottom;
  if (!c.hidden) bottom = Math.max(bottom, c.getBoundingClientRect().bottom - (parseFloat(getComputedStyle(c).paddingBottom) || 0));
  s.zone = { left: r.left, right: r.right, top: r.top, bottom };
  s.zoneAt = window.scrollY;
}

// The cards' places in the grid, in order, taken without any glide on them.
function _measureSlots(s, centres) {
  s.slots = s.list.map(el => {
    const c = centres?.get(el) ?? layoutCentreOf(el);
    return { el, x: c.x, y: c.y, w: el.offsetWidth, h: el.offsetHeight };
  });
  s.slotsAt = s.scrollNow = window.scrollY;
}

function _remeasure(s) {
  s.band = measureBand();
  s.strip = _o.carousel.parentElement.getBoundingClientRect();
  s.stripLeft = _o.carousel.getBoundingClientRect().left;
  s.scrollNow = window.scrollY;
  _measureSlots(s);
  _measureZone(s);
  _measureStrip(s);
}

// What the strip's cards are spaced by, for the index the token is held at
// (they are all the same width, and in a row).
function _measureStrip(s) {
  const el = s.placeholder?.isConnected ? s.placeholder : s.base[0];
  if (!el || _o.isGrid()) return;
  const c = _o.carousel, cs = getComputedStyle(c);
  const w = _sizeOf(el).w;
  s.pitch = w + (parseFloat(cs.columnGap) || 0);
  s.x0 = (parseFloat(cs.paddingLeft) || 0) + w / 2;
  s.scrollMaxX = c.scrollWidth - c.clientWidth;
  s.scrollLeft = c.scrollLeft;
}

function _checkZone(s) {
  if (s.blocked) return;
  const z = s.zone, shift = s.scrollNow - s.zoneAt;
  const m = s.inZone ? OUT_MARGIN : IN_MARGIN;
  const inside = s.px >= z.left - m && s.px <= z.right + m && s.py >= z.top - shift - m && s.py <= z.bottom - shift + m;
  if (inside && !s.inZone) _enter(s);
  else if (!inside && s.inZone) _leave(s);
}

// The index (in the strip without the card) the token is held at, in the strip.
function _stripIndex(s, mid, n, current = -1) {
  if (!s.pitch) return 0;
  const f = (mid.x - s.stripLeft + s.scrollLeft - s.x0) / s.pitch;
  // The card stays where it is until it has gone a little past the middle
  if (current >= 0 && Math.abs(f - current) < 0.5 + HOLD) return current;
  return Math.max(0, Math.min(n, Math.round(f)));
}

// Where a card that is not in the strip yet goes: the number of cards it is
// after, reading the grid row by row.
function _firstIndex(s) {
  const mid = _held(s);
  const n = s.base.length - (s.existing ? 1 : 0);
  if (!_o.isGrid()) return _stripIndex(s, mid, n);
  const shift = window.scrollY - s.slotsAt;
  let count = 0;
  for (const sl of s.slots) {
    if (sl.el === s.existing) continue;
    const y = sl.y - shift;
    if (mid.y > y + sl.h / 2 || (mid.y >= y - sl.h / 2 && mid.x > sl.x)) count++;
  }
  return count;
}

function _enter(s) {
  let ph = s.existing;
  const isNew = !ph;
  if (isNew) {
    ph = _o.build(s.key);
    if (!ph) { s.blocked = true; return; }
  }
  // The wiggle (edit mode) is off on it until it lands. A new card's badge has
  // already popped in by then: it never plays it again.
  ph.style.animation = 'none';
  if (isNew) ph.querySelector(':scope > .fav-remove')?.style.setProperty('animation', 'none');
  s.placeholder = s.el = ph;
  s.isNew = isNew;
  s.inZone = true;
  if (!_o.isGrid()) _measureStrip(s);
  const index = _firstIndex(s);
  const grow = isNew && _o.isEmpty();
  const sectionFrom = grow ? s.section.getBoundingClientRect() : null;

  _reflow(s, () => {
    if (grow) _o.setEmpty(false);
    ph.classList.add('fav-placeholder');
    if (isNew) _o.carousel.appendChild(ph);
    const list = s.base.filter(el => el !== ph);
    list.splice(index, 0, ph);
    s.list = list;
    _setOrder(s);
  });
  s.index = index;
  if (grow) {
    s.grown = true;
    s.growAnims = _o.resizeSection(s.section, sectionFrom, 'in');
  }

  // Its size, now that it is laid out, is what the token grows to
  const size = _sizeOf(ph);
  s.fw = size.w / s.W;
  s.fh = size.h / s.H;
  // The photo is decoded before it is shown (a card that was never painted
  // would otherwise decode it in the very frame it appears)
  ph.querySelector('.classroom-card-photo')?.decode?.().catch(() => {});
  s.sm.to(1, MORPH);
  if (_o.isGrid()) { s.armedTop = s.py >= s.band.top + EDGE; s.armedBottom = s.py <= s.band.bottom - EDGE; }
  else { s.armedL = s.px >= s.strip.left + STRIP_EDGE; s.armedR = s.px <= s.strip.right - STRIP_EDGE; }
  // A frame later, when the card has been fitted
  if (!s.faceTo) requestAnimationFrame(() => { if (_s === s && s.placeholder === ph) _addFavouriteFace(s); });
}

// The token leaves the Favourites: the place made for it closes again.
function _leave(s) {
  const ph = s.placeholder;
  s.inZone = false;
  s.sm.to(0, MORPH);
  if (s.isNew) {
    const grown = s.grown;
    const sectionFrom = grown ? s.section.getBoundingClientRect() : null;
    s.growAnims.forEach(a => a.cancel());
    s.growAnims = [];
    _reflow(s, () => {
      ph.remove();
      s.list = [...s.base];
      _setOrder(s);
      if (grown) _o.setEmpty(true);
    });
    if (grown) {
      s.grown = false;
      s.growAnims = _o.resizeSection(s.section, sectionFrom, 'out');
    }
  } else {
    // A favourite card goes back to where it was, and shows again
    _reflow(s, () => {
      s.list = [...s.base];
      _setOrder(s);
      ph.classList.remove('fav-placeholder');
    });
    ph.style.removeProperty('animation');
    if (!_reduceMotion.matches) ph.animate({ opacity: [0, 1] }, { duration: 180, easing: 'ease-out' });
  }
  s.placeholder = s.el = null;
  s.index = -1;
}

// Moves the place to the slot the token is held over.
function _place(s) {
  const mid = _held(s);
  let to;
  if (!_o.isGrid()) to = _stripIndex(s, mid, s.base.length - (s.existing ? 1 : 0), s.index);
  else to = hitSlot(s, mid);
  if (to === s.index || to < 0) return;
  _moveTo(s, to);
}

function _moveTo(s, to) {
  s.index = to;
  _reflow(s, () => {
    const list = s.list.filter(el => el !== s.placeholder);
    list.splice(to, 0, s.placeholder);
    s.list = list;
    _setOrder(s);
  });
}

const _setOrder = (s) => s.list.forEach((el, i) => {
  if (el.style.order !== String(i)) el.style.order = i;
});

// Runs `change`, which puts the place in the strip, takes it out or moves it,
// then glides every other card from where it was seen to where it is now.
function _reflow(s, change) {
  const ph = s.placeholder;
  const others = s.list.filter(el => el !== ph);
  const from = others.map(centreOf);
  cancelGlides(others);

  change();

  // All the reads before anything is written again
  const to = others.map(centreOf);
  const centres = new Map(others.map((el, i) => [el, to[i]]));
  if (ph?.isConnected) centres.set(ph, centreOf(ph));
  _measureSlots(s, centres);
  _measureZone(s);
  if (!_o.isGrid()) _measureStrip(s);

  if (!_reduceMotion.matches) {
    others.forEach((el, i) => {
      const dx = from[i].x - to[i].x, dy = from[i].y - to[i].y;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      el.animate({ translate: [`${dx}px ${dy}px`, '0 0'] }, MOVE);
    });
  }
}

// ── Edge scroll ───────────────────────────────────────────────────────────

function _autoScroll(s, dt) {
  if (!dt) return;
  let v = 0;
  if (_o.isGrid()) {
    // The page: the grid may be taller than the screen
    const { top, bottom } = s.band;
    const zoneTop = top + EDGE, zoneBottom = bottom - EDGE;
    if (s.py >= zoneTop) s.armedTop = true;
    if (s.py <= zoneBottom) s.armedBottom = true;
    if (s.armedTop && s.py < zoneTop && s.scrollNow > 0) v = -EDGE_SPEED * _ramp((zoneTop - s.py) / EDGE);
    else if (s.armedBottom && s.py > zoneBottom && s.scrollMax - s.scrollNow > 1) v = EDGE_SPEED * _ramp((s.py - zoneBottom) / EDGE);
  } else {
    // The strip: sideways
    const a = s.strip.left + STRIP_EDGE, b = s.strip.right - STRIP_EDGE;
    if (s.px >= a) s.armedL = true;
    if (s.px <= b) s.armedR = true;
    if (s.armedL && s.px < a && s.scrollLeft > 0) v = -EDGE_SPEED * _ramp((a - s.px) / STRIP_EDGE);
    else if (s.armedR && s.px > b && s.scrollMaxX - s.scrollLeft > 1) v = EDGE_SPEED * _ramp((s.px - b) / STRIP_EDGE);
  }
  if (!v) { s.scrollRest = 0; return; }

  // Scroll positions are whole pixels on a 1x screen: keep what is left over
  s.scrollRest += v * dt;
  const step = Math.trunc(s.scrollRest);
  if (!step) return;
  s.scrollRest -= step;
  if (_o.isGrid()) {
    window.scrollBy({ top: step, behavior: 'instant' });
    s.scrollNow = window.scrollY;
  } else {
    _o.carousel.scrollTo({ left: s.scrollLeft + step, behavior: 'instant' });
    s.scrollLeft = _o.carousel.scrollLeft;
  }
}

// ── Letting go ────────────────────────────────────────────────────────────

function _stopFollowing(s) {
  cancelAnimationFrame(s.raf);
  _removeWindowListeners();
  window.removeEventListener('keydown', _onKey, true);
  window.removeEventListener('resize', _onResize);
  _press = null;
}

function _release(s) {
  if (s.phase !== 'drag') return;
  _stopFollowing(s);
  // The click that comes with the button going up, right away
  swallowClicksFor(150);
  const v = pointerVelocity(s.samples);
  if (s.inZone && s.placeholder) {
    if (_o.isGrid()) _toNearest(s);
    _settle(s, 'landing', centreOf(s.placeholder), v);
  } else {
    _return(s, v);
  }
}

// In the grid the place only moves while the token is over the middle of a
// card (so it doesn't flicker on a boundary), which leaves gaps between them.
// Let go in one, it takes the nearest place instead of springing back to the
// last one it had, perhaps far off.
function _toNearest(s) {
  const mid = _held(s), shift = window.scrollY - s.slotsAt;
  let to = -1, best = Infinity;
  s.slots.forEach((sl, i) => {
    const d = Math.hypot(mid.x - sl.x, mid.y - (sl.y - shift));
    if (d < best) { best = d; to = i; }
  });
  if (to >= 0 && to !== s.index) _moveTo(s, to);
}

// Escape, a pointer that is cancelled, the window losing focus, a resize, a
// refresh of the results: nothing changes, and the token goes home.
function _cancel(s) {
  if (s.phase !== 'drag') return;
  _stopFollowing(s);
  if (s.inZone) _leave(s);
  _return(s, { x: 0, y: 0 });
}

// The token springs back onto the card it came from. One that a refresh has
// replaced is looked for again by its classroom; with none, the token just
// fades where it is.
function _return(s, v) {
  if (!s.source.isConnected) {
    const again = _o.results.querySelector(`.classroom-card[data-open-classroom="${CSS.escape(s.key)}"]`);
    if (again) s.target = again;
  }
  const home = s.target ?? s.source;
  if (!home.isConnected) { _returned(s); return; }
  _settle(s, 'returning', centreOf(home), v);
}

// The token springs to `target` with the speed it was let go with, and the
// lift, the tilt and the look settle with it.
function _settle(s, phase, target, v) {
  s.phase = phase;
  s.token.classList.remove('fav-dragging');
  if (phase === 'landing' && s.faceTo) _syncLabel(s.placeholder, s.faceTo);
  window.addEventListener('scroll', s.onLandScroll = () => {
    // The page moved under it: the place it is going to has moved too
    const el = phase === 'landing' ? s.placeholder : (s.target ?? s.source);
    if (!el?.isConnected) return;
    const c = centreOf(el);
    s.sx.to(c.x, DROP);
    s.sy.to(c.y, DROP);
  }, { passive: true });
  const cap = (n) => Math.max(-MAX_RELEASE_SPEED, Math.min(MAX_RELEASE_SPEED, n));
  s.sx.v = cap(v.x);
  s.sy.v = cap(v.y);
  s.sx.to(target.x, DROP);
  s.sy.to(target.y, DROP);
  s.sr.to(0, DROP_TILT);
  s.sk.to(1, LIFT_OUT);
  s.sm.to(phase === 'landing' ? 1 : 0, MORPH);
  // Under reduced motion every spring has already jumped
  _render(s);
}

// The token has come to rest on the card's place. A box that is scaled and moved
// is drawn at a fraction of a pixel (every edge anti-aliased), a laid-out one
// is snapped to the pixel grid, so for the last frame the token is laid out
// like the card: its own size and place, nothing but the card's look inside,
// and the swap that follows changes not one pixel.
function _arrived(s) {
  s.native = true;
  const el = s.phase === 'landing' ? s.placeholder : (s.target ?? s.source);
  const r = el.getBoundingClientRect();
  Object.assign(s.token.style, {
    translate: 'none', scale: 'none', rotate: 'none',
    left: `${r.left - s.ox}px`, top: `${r.top - s.oy}px`, width: `${r.width}px`, height: `${r.height}px`,
  });
  const face = s.phase === 'landing' ? s.faceTo : s.from;
  if (face) Object.assign(face.style, { left: '0', top: '0', width: '100%', height: '100%', translate: 'none', scale: 'none', opacity: '1' });
  (s.phase === 'landing' ? s.from : s.faceTo)?.style.setProperty('visibility', 'hidden');
  s.lift.style.display = 'none';
  // The next frame, once this one has been drawn
  requestAnimationFrame(() => (s.phase === 'landing' ? _land(s) : _returned(s)));
}

// It has landed: the card takes the token's place in this very frame.
function _land(s) {
  if (_s !== s || s.phase !== 'landing') return;
  const ph = s.placeholder;
  const keys = s.list.map(el => el.dataset.favKey);
  const index = s.list.indexOf(ph);
  const next = s.list[index + 1] ?? null;
  s.list.forEach(el => el.style.removeProperty('order'));
  // In the DOM where it is shown, so nothing moves when the orders go
  if (ph.nextElementSibling !== next) _o.carousel.insertBefore(ph, next);
  ph.classList.remove('fav-placeholder');
  ph.style.removeProperty('animation');
  // The wiggle takes over from a card at rest, so it starts where the angle is 0
  // (half an iteration in) instead of snapping to some other angle.
  const dur = parseFloat(ph.style.getPropertyValue('--fav-wiggle-dur'));
  if (dur) ph.style.setProperty('--fav-wiggle-delay', `${-dur / 2}ms`);
  s.layer.remove();
  s.source.classList.remove('fav-drop-source');
  _end(s);
  // Persisted last: it may bring the strip to rerender
  _o.commit({ key: s.key, keys, index });
  _o.onEnd();
}

// It is back on its card: the two are the same picture, so the token fades
// into it while the card takes up its colour again.
function _returned(s) {
  if (_s !== s || (s.phase !== 'returning' && s.phase !== 'drag')) return;
  const layer = s.layer;
  s.source.classList.remove('fav-drop-source');
  if (_reduceMotion.matches) layer.remove();
  else layer.animate({ opacity: [1, 0] }, { duration: FADE_OUT, easing: 'ease-out' }).finished.then(() => layer.remove(), () => layer.remove());
  _end(s);
  _o.onEnd();
}

// The strip's snapping stays off after the drop, until it is next scrolled or
// pressed: Chrome settles a strip that gets it back on a card at once, which
// would move every card in the frame the token is swapped for its card. Then
// the jump is taken back and played as a glide.
function _deferSnap(s) {
  if (!s.snapped || _snapRestore) return;
  const c = _o.carousel;
  const value = s.snap;
  const events = ['wheel', 'pointerdown', 'keydown'];
  const restore = () => {
    for (const type of events) c.removeEventListener(type, restore, true);
    _snapRestore = null;
    const was = c.scrollLeft;
    c.style.scrollSnapType = value;
    const delta = c.scrollLeft - was;
    if (Math.abs(delta) < 0.5 || _reduceMotion.matches) return;
    for (const el of c.children) el.animate({ translate: [`${delta}px 0`, '0 0'] }, { ...MOVE, composite: 'add' });
  };
  for (const type of events) c.addEventListener(type, restore, { capture: true, passive: true });
  _snapRestore = restore;
}

// Everything the drag put on the page, except the token's layer.
function _end(s) {
  cancelAnimationFrame(s.raf);
  s.offFrame?.();
  s.offFrame = null;
  for (const sp of [s.sx, s.sy, s.sr, s.sk, s.sm]) sp.dispose();
  window.removeEventListener('resize', _onResize);
  window.removeEventListener('keydown', _onKey, true);
  window.removeEventListener('scroll', s.onScroll);
  window.removeEventListener('scroll', s.onLandScroll);
  _o.carousel.removeEventListener('scroll', s.onStripScroll);
  s.observer?.disconnect();
  _removeWindowListeners();
  _press = null;
  s.base.forEach(el => el.style.removeProperty('order'));
  s.growAnims = [];
  _deferSnap(s);
  _o.results.closest('#available-classrooms-container')?.classList.remove('fav-dropping');
  // Anchoring stays off a little longer: moving the card in the DOM, as the
  // drag ends, would otherwise have the page scroll to "keep" its old place.
  const section = s.section;
  requestAnimationFrame(() => requestAnimationFrame(() => { if (!_s) section.style.removeProperty('overflow-anchor'); }));
  _s = null;
  setFavouritesDragLocked(false);
}
