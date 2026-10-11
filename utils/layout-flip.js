import { springEasing } from './spring-easing.js';

// Animates a layout change inside a list instead of letting it jump: what
// leaves fades away where it stands, whatever stays slides to its new place
// (FLIP, crossing paths and all), and what's new rises in where it lands.
//
// What leaves must be gone before anything else settles into its slot. When
// its own element can't stay around for that (a rebuild throws the old DOM
// away), a copy of it fades out in its place and stays faded until removed:
// copies that sprang back to full opacity once their fade ended sat in the
// slots the other cards were landing in.
// An arrival waits only while something is still sliding through or fading
// out of its slot.
//
// Only the leaves move (the elements matching `selector`: cards and section
// headers), never their containers, so no element's motion has to cancel out
// a parent's. And only the ones on screen before or after: the off-screen
// ones jump unseen. A moving card is kept rendered (`content-visibility`)
// for the whole motion, or a card sliding toward a spot below the fold would
// go blank on the way. Web Animations on translate/scale/opacity only, so it
// runs on the compositor and composes with the cards' own hover/press
// `transform`.

const _reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const MOVE = springEasing({ stiffness: 240, damping: 30, mass: 1 });
const LEAVE = { duration: 160, easing: 'cubic-bezier(0.4, 0, 1, 1)' };
const ENTER = { duration: 320, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' };
const MARGIN = 120; // px past the viewport that still counts as on screen

const _running = new WeakMap(); // root -> run

function _onScreen(r) {
  return r.width > 0 && r.bottom > -MARGIN && r.top < innerHeight + MARGIN;
}

function _finish(root) {
  const run = _running.get(root);
  if (!run) return;
  _running.delete(root);
  run.anims.forEach(a => a.cancel());
  run.cleanup();
}

// A run's bookkeeping: its animations, the elements it forced to render, and
// the layer its fading copies live in
function _startRun(root) {
  const run = {
    anims: [],
    rendered: [],
    layer: null,
    restorePosition: null,
    cleanup() {
      run.rendered.forEach(el => el.style.removeProperty('content-visibility'));
      run.rendered = [];
      run.layer?.remove();
      run.layer = null;
      if (run.restorePosition != null) root.style.position = run.restorePosition;
      run.restorePosition = null;
    },
  };
  _running.set(root, run);
  return run;
}

function _endWhenDone(root, run) {
  Promise.allSettled(run.anims.map(a => a.finished)).then(() => {
    if (_running.get(root) !== run) return;
    _running.delete(root);
    run.cleanup();
  });
}

function _keepRendered(run, el) {
  el.style.contentVisibility = 'visible';
  run.rendered.push(el);
}

// Fades out a copy of `el` at `rect` (viewport coordinates, taken before the
// change), laid over the content under it: the original has either moved or
// gone with the old DOM. The copies go in a layer at the start of `root`, so
// whatever comes after paints over them.
function _ghost(root, run, el, rect, { lift = false } = {}) {
  if (!run.layer) {
    if (getComputedStyle(root).position === 'static') {
      run.restorePosition = root.style.position;
      root.style.position = 'relative';
    }
    run.layer = document.createElement('div');
    run.layer.className = 'lf-ghosts';
    run.layer.setAttribute('aria-hidden', 'true');
    run.layer.style.cssText = 'position:absolute;inset:0 auto auto 0;width:0;height:0;pointer-events:none;';
    root.prepend(run.layer);
  }
  const origin = run.layer.getBoundingClientRect();
  const ghost = el.cloneNode(true);
  // Nothing that looks a card up (by room, by id) may find the copy
  for (const n of [ghost, ...ghost.querySelectorAll('[id], [data-open-classroom]')]) {
    n.removeAttribute('id');
    n.removeAttribute('data-open-classroom');
  }
  ghost.style.cssText += `;position:absolute;margin:0;left:${rect.left - origin.left}px;top:${rect.top - origin.top}px;` +
    `width:${rect.width}px;height:${rect.height}px;animation:none;translate:none;content-visibility:visible;`;
  run.layer.appendChild(ghost);
  // `lift`: the whole list is being replaced, and the old one drifts up as
  // it goes while the new one rises in from below
  const frames = lift
    ? { opacity: [1, 0], scale: [1, 0.97], translate: ['0 0', '0 -16px'] }
    : { opacity: [1, 0], scale: [1, 0.94] };
  run.anims.push(ghost.animate(frames, { ...LEAVE, fill: 'both' }));
}

const _enter = (el, delay) => el.animate({ opacity: [0, 1], scale: [0.94, 1] }, { ...ENTER, delay, fill: 'backwards' });

// `apply()` changes the layout in place (toggles a class, inserts or removes
// a few nodes). `isLeaving(el)` picks, before it, the elements it's about to
// hide: they shrink away where they stand first, and only then does the rest
// move. A second call while one is running snaps the first to its end state.
export function flipLayout(root, selector, apply, { isLeaving = () => false } = {}) {
  _finish(root);
  if (_reduceMotion.matches) { apply(); return; }

  const first = new Map();
  for (const el of root.querySelectorAll(selector)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0) first.set(el, r);
  }
  const leaving = [...first].filter(([el, r]) => _onScreen(r) && isLeaving(el)).map(([el]) => el);

  const run = _startRun(root);
  let applied = false;
  const cleanup = run.cleanup;
  run.cleanup = () => { cleanup(); if (!applied) { applied = true; apply(); } };

  const reflow = () => {
    if (_running.get(root) !== run) return;
    applied = true;
    apply();
    // The leavers' fade ends here: they're display:none now, and cancelling
    // keeps them from coming back at opacity 0 the next time they show
    run.anims.forEach(a => a.cancel());
    run.anims = [];

    const slides = [];
    const arrivals = [];
    for (const el of root.querySelectorAll(selector)) {
      const last = el.getBoundingClientRect();
      if (!(last.width > 0)) continue;
      const was = first.get(el);
      if (!was) { if (_onScreen(last)) arrivals.push([el, null]); continue; }
      const dx = was.left - last.left;
      const dy = was.top - last.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      if (!_onScreen(was) && !_onScreen(last)) continue;
      if (Math.abs(dy) < innerHeight) slides.push([el, dx, dy, last]);
      else arrivals.push([el, _onScreen(was) ? was : null]);
    }
    // Where something passes or fades out: an arrival landing on one of
    // these waits for it to clear, any other comes in right away
    const swept = [];
    for (const [el, dx, dy, r] of slides) {
      _keepRendered(run, el);
      run.anims.push(el.animate({ translate: [`${dx}px ${dy}px`, '0 0'] }, MOVE));
      swept.push({ wait: Math.round(MOVE.duration * 0.35),
        left: Math.min(r.left, r.left + dx), right: Math.max(r.right, r.right + dx),
        top: Math.min(r.top, r.top + dy), bottom: Math.max(r.bottom, r.bottom + dy) });
    }
    for (const [el, was] of arrivals) {
      if (!was) continue;
      _ghost(root, run, el, was);
      swept.push({ wait: Math.round(LEAVE.duration * 0.75), ...was.toJSON() });
    }
    let n = 0;
    for (const [el] of arrivals) {
      const r = el.getBoundingClientRect();
      if (!_onScreen(r)) continue;
      const wait = Math.max(0, ...swept
        .filter(s => s.left < r.right - 1 && s.right > r.left + 1 && s.top < r.bottom - 1 && s.bottom > r.top + 1)
        .map(s => s.wait));
      _keepRendered(run, el);
      run.anims.push(_enter(el, wait + Math.min(n++ * 25, 150)));
    }
    _endWhenDone(root, run);
  };

  if (!leaving.length) { reflow(); return; }
  run.anims = leaving.map(el => el.animate({ opacity: [1, 0], scale: [1, 0.9] }, { ...LEAVE, fill: 'forwards' }));
  Promise.all(run.anims.map(a => a.finished)).then(reflow, () => {});
}

// For content that `render()` throws away and builds anew (the results after
// a date or time change), matched across the two by `key(el)`. A match on
// screen slides from where the old one was, with `keptClass` so it skips its
// own entrance animation; what's new runs that entrance; what's gone (and a
// match coming from or going to more than a screen away) fades out as a copy
// where it was, and a new element landing on such a copy holds its entrance
// (the `--lf-wait` it adds to its animation-delay) until the copy is gone.
// `swap` is for a new list with nothing in common with the old one (another
// campus): all of the old one drifts up and away, and all of the new one
// rises in after it, with the stronger entrance `root.lf-swapping` gives it.
const GHOST_WAIT = `${Math.round(LEAVE.duration * 0.75)}ms`;

export function morphRender(root, selector, key, render, { keptClass = 'lf-kept', swap = false } = {}) {
  // A rebuild right after another campus's (a campus change can search twice
  // in a row) lands on a list that hasn't risen in yet: carry the swap on
  // rather than measure cards still on their way up
  if (_running.get(root)?.swap) { render(); return; }
  root.classList.remove('lf-swapping');
  root.style.removeProperty('--lf-wait');
  if (_reduceMotion.matches || !root.checkVisibility?.()) { _finish(root); render(); return; }

  // Measured before the last run is snapped, so a rebuild landing during the
  // previous one's fade starts from what's on screen
  const first = new Map();
  for (const el of root.querySelectorAll(selector)) {
    if (el.closest('.lf-ghosts')) continue;
    // A card still rising in (its entrance offsets it by a few px) would
    // read as moved: these are thrown away anyway, so end it first
    for (const a of el.getAnimations()) if (a.animationName === 'card-appear' || a.animationName === 'card-swap-in') a.finish();
    const r = el.getBoundingClientRect();
    const k = key(el);
    if (k != null && r.width > 0) first.set(k, { el, r });
  }
  _finish(root);

  render();

  const run = _startRun(root);
  if (swap) {
    run.swap = true;
    // Kept running until the new list has risen in (stagger up to 300ms,
    // the wait, the 400ms entrance): an empty animation as the clock
    run.anims.push(root.animate([], { duration: 300 + LEAVE.duration + 400 }));
    for (const { el, r } of first.values()) if (_onScreen(r)) _ghost(root, run, el, r, { lift: true });
    root.classList.add('lf-swapping');
    root.style.setProperty('--lf-wait', GHOST_WAIT);
    _endWhenDone(root, run);
    return;
  }

  const moved = new Set();
  const fresh = [];
  for (const el of root.querySelectorAll(selector)) {
    const k = key(el);
    const was = first.get(k);
    const last = el.getBoundingClientRect();
    if (!was || !(last.width > 0) || Math.abs(was.r.top - last.top) >= innerHeight) {
      if (_onScreen(last)) fresh.push([el, last]);
      continue;
    }
    const dx = was.r.left - last.left;
    const dy = was.r.top - last.top;
    el.classList.add(keptClass);
    moved.add(k);
    if ((Math.abs(dx) >= 1 || Math.abs(dy) >= 1) && (_onScreen(was.r) || _onScreen(last))) {
      _keepRendered(run, el);
      run.anims.push(el.animate({ translate: [`${dx}px ${dy}px`, '0 0'] }, MOVE));
    }
  }
  const ghosts = [];
  for (const [k, { el, r }] of first) {
    if (moved.has(k) || !_onScreen(r)) continue;
    _ghost(root, run, el, r);
    ghosts.push(r);
  }
  for (const [el, r] of fresh) {
    if (ghosts.some(g => g.left < r.right - 1 && g.right > r.left + 1 && g.top < r.bottom - 1 && g.bottom > r.top + 1)) {
      el.style.setProperty('--lf-wait', GHOST_WAIT);
    }
  }
  _endWhenDone(root, run);
}
