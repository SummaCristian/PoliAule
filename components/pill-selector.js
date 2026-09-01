// Shared drag/spring behavior for a horizontal ".date-picker-container" row
// of ".date-element-container" cells with a sliding ".date-indicator"
// background — ported from bottom-nav.js's draggable tab pill (pillHit +
// spring-driven position/scale, and the grow/blur/mask "lifted" look via
// bn-pill-outer/inner/active-row + updateMask()). Used by both the
// Available tab's date picker (date-picker.js) and the details page's
// mobile day-chip selector (classroom-detail.js), which share the same
// markup/CSS but otherwise have independent selection logic (hidden
// <select> vs. schedule row highlight).
import { Spring, onSpringFrame } from '../utils/spring.js';
import { haptics, defaultPatterns } from './haptics.js';

const TAP_SCALE = 1.6;
const DRAG_OVERSHOOT = 8;      // hard clamp used only for the release projection
const LIFT_THRESHOLD = 1.001;
const RAIL_GIVE = 11;          // elastic px the pill can be pulled past the end anchors
const CROSS_GIVE = 5;         // elastic px the pill can be pulled off its rail (vertical)
const STRETCH_GAIN = 0.9;      // pill speed (px/ms) → deform ratio
const STRETCH_MAX = 0.26;      // cap on that ratio
const CONTAINER_FOLLOW = 0.12;     // fraction of the drag the whole row trails by
const CONTAINER_GIVE = 8;          // px cap along the row (wide, so more than the tab bar)
const CONTAINER_GIVE_CROSS = 5;    // px cap across it (vertical)

// Asymptotic rubber-band: x can grow without bound, the result approaches
// ±give but never reaches it. Matches the swipe-deform falloff in
// liquid-glass.js.
const rubber = (x, give) => (x * give) / (give + Math.abs(x));

// container: the `.date-picker-container` element (already position:relative,
// already holding a `.date-indicator` child and some `.date-element-container`
// children — those may be regenerated later; call refresh() after doing so).
//
// isSkipped(el): predicate for "not a selectable day" (shakes on tap, and a
// drag that settles on it snaps back to the last selection instead).
// onSelect(el, { silent }): called whenever a *new* cell commits as the
// active one, whether by tap, drag, or a programmatic selectElement() call.
// `silent` is true only for a caller-initiated selectElement(el, { silent: true })
// (e.g. an initial auto-select) — callers use it to skip haptics/side effects
// that shouldn't fire on page load.
export function createPillSelector(container, { isSkipped = el => el.classList.contains('date-skipped'), onSelect } = {}) {
  // container's own parent — .date-picker / .detail-schedule-day-selector,
  // both already position:relative. The indicator (+ hit overlay) live here
  // as container's siblings, not its children — same relationship as
  // .bn-pill-outer/.bn-pill-hit being siblings of .bn-tabbar rather than
  // nested inside it, and already marked up that way (not reparented at
  // runtime): Safari doesn't reliably recompute an element's backdrop-filter
  // root after it's moved out from under a backdrop-filter'd ancestor via
  // JS, which silently killed the indicator's lift-blur there.
  const wrapper = container.parentElement;

  const indicator = wrapper.querySelector(':scope > .date-indicator');
  wrapper.appendChild(indicator); // move after `container` in case of re-init (refresh() re-runs this)

  // Wrap the real cells in their own layer so a pill-shaped hole can be
  // clipped out of them while the indicator is lifted (see updateMask()
  // below) — same reason .bn-tabbar-items exists in bottom-nav.css/js.
  // Idempotent across repeated createPillSelector() calls on the same
  // container (setupDatePicker can re-run): reuse an existing wrapper and
  // just re-adopt whatever cells currently sit as direct children.
  let items = container.querySelector(':scope > .date-picker-items');
  if (!items) {
    items = document.createElement('div');
    items.className = 'date-picker-items';
    container.insertBefore(items, container.firstChild);
  }
  Array.from(container.querySelectorAll(':scope > .date-element-container')).forEach(el => items.appendChild(el));

  // (Re)build the indicator's own child structure: an overflow:hidden inner
  // layer (blurs while lifted, same as .bn-pill-inner) holding a row of
  // accent-colored cell duplicates (.bn-active-row's equivalent) that only
  // becomes visible through the hole clipped into `items`.
  indicator.querySelector(':scope > .date-indicator-inner')?.remove();
  const inner = document.createElement('div');
  inner.className = 'date-indicator-inner';
  const activeRow = document.createElement('div');
  activeRow.className = 'date-indicator-active-row';
  inner.appendChild(activeRow);
  indicator.appendChild(inner);

  wrapper.querySelector(':scope > .date-indicator-hit')?.remove();
  const hit = document.createElement('div');
  hit.className = 'date-indicator-hit';
  wrapper.appendChild(hit); // after indicator too

  let elements = [];
  let anchors = [];
  let activeIndex = -1;
  let cellW = 0, cellH = 0;
  // The indicator/hit now live in `wrapper`'s coordinate space, not
  // `container`'s — origin is container's own position within wrapper plus
  // its padding, recomputed on refresh() alongside everything else.
  let originX = 0, originY = 0;

  const pos = new Spring(0);
  const posCross = new Spring(0); // off-rail (vertical) offset, springs back to 0 on release
  const containerOff = new Spring(0);   // whole-row trail along the row
  const containerCross = new Spring(0); // ...and across it (soft springs, they lag fast scrolls)
  const scale = new Spring(1);

  // Per-frame velocity of the rendered pill → an inertia squash-and-stretch
  // while it's lifted (faster move = more deformed, stretched along the
  // direction of travel). Smoothed frame-to-frame so it eases rather than
  // jitters; zeroed whenever the pill isn't lifted.
  let lastRenderT = performance.now();
  let lastPosX = 0, lastPosY = 0, smoothStretch = 0;

  // Recompute anchors from the current `.date-element-container` children.
  // Call after (re)generating the cells, and whenever their layout can shift
  // (window resize, a hide-sundays toggle collapsing some cells).
  function refresh() {
    // Cells regenerated elsewhere (date-picker.js clears + re-appends) land
    // as direct children of `container` again — keep them inside `items`.
    Array.from(container.querySelectorAll(':scope > .date-element-container')).forEach(el => items.appendChild(el));

    const style = getComputedStyle(container);
    const pl = parseFloat(style.paddingLeft) || 0;
    const pt = parseFloat(style.paddingTop) || 0;
    // The indicator/hit now live in `wrapper`, not `container` — this is
    // container's own offset within wrapper's coordinate space, so the
    // indicator can be positioned as if it were still `container`'s child.
    originX = container.offsetLeft + pl;
    originY = container.offsetTop + pt;
    indicator.style.left = `${originX}px`;
    indicator.style.top = `${originY}px`;
    hit.style.left = `${originX}px`;
    hit.style.top = `${originY}px`;

    // offsetWidth > 0 excludes display:none cells (e.g. hidden Sundays) so
    // they don't leave a stray zero-width anchor in the list.
    elements = Array.from(items.querySelectorAll('.date-element-container')).filter(el => el.offsetWidth > 0);
    anchors = elements.map(el => el.offsetLeft - pl);

    cellW = elements[0]?.offsetWidth ?? 0;
    cellH = elements[0]?.offsetHeight ?? 0;
    indicator.style.width = `${cellW}px`;
    indicator.style.height = `${cellH}px`;
    hit.style.width = `${cellW}px`;
    hit.style.height = `${cellH}px`;

    rebuildActiveRow();

    if (activeIndex >= 0 && elements[activeIndex]) {
      pos.set(anchors[activeIndex]);
    }
    render();
  }

  // One accent-colored duplicate per real cell, each pinned to that cell's
  // own anchor — not laid out via flex, so it can't drift from the real
  // layout's (space-between) gaps even by a sub-pixel.
  function rebuildActiveRow() {
    activeRow.style.width = `${items.offsetWidth}px`;
    activeRow.innerHTML = elements.map((el, i) => `
      <div class="date-indicator-cell" style="left:${anchors[i]}px;width:${cellW}px;height:${cellH}px">${el.innerHTML}</div>
    `).join('');
  }

  function render() {
    const nowT = performance.now();
    const gap = nowT - lastRenderT;
    lastRenderT = nowT;
    // The shared RAF loop pauses when nothing's animating; on the first frame
    // after it restarts there's no meaningful velocity, so re-sync instead of
    // dividing a stale delta.
    if (gap > 100 || gap <= 0) {
      lastPosX = pos.value;
      lastPosY = posCross.value;
      smoothStretch = 0;
    }
    const dt = Math.min(Math.max(gap, 1), 64);
    const vx = (pos.value - lastPosX) / dt;
    const vy = (posCross.value - lastPosY) / dt;
    lastPosX = pos.value;
    lastPosY = posCross.value;

    const lifted = scale.value > LIFT_THRESHOLD;
    const speed = Math.hypot(vx, vy);
    const targetStretch = lifted ? Math.min(speed * STRETCH_GAIN, STRETCH_MAX) : 0;
    smoothStretch = lifted ? smoothStretch + (targetStretch - smoothStretch) * 0.3 : 0;
    const ux = speed > 1e-3 ? Math.abs(vx) / speed : 1;
    const uy = speed > 1e-3 ? Math.abs(vy) / speed : 0;
    const stX = smoothStretch * ux;
    const stY = smoothStretch * uy;

    const s = scale.value;
    const sx = s * (1 + stX - 0.5 * stY);
    const sy = s * (1 + stY - 0.5 * stX);

    // The shake keyframes (date-indicator-shake in date-picker.css) read
    // --indicator-x to know the base position to rotate/jitter around.
    indicator.style.setProperty('--indicator-x', `${pos.value}px`);
    indicator.style.transform =
      `translate(${pos.value}px, ${posCross.value}px) scale(${sx}, ${sy})`;
    indicator.style.opacity = activeIndex >= 0 ? '1' : '0';
    indicator.classList.toggle('date-indicator--lifted', lifted);
    hit.style.transform = `translate(${pos.value}px, ${posCross.value}px)`;
    activeRow.style.transform = `translate(${-pos.value}px, ${-posCross.value}px)`;
    // The whole row (indicator + cells together) trails the drag a touch, both axes.
    const cx = containerOff.value, cy = containerCross.value;
    wrapper.style.transform = (cx || cy) ? `translate(${cx}px, ${cy}px)` : '';
    updateMask(sx, sy);
  }
  onSpringFrame(render);

  // Cuts a pill-shaped hole out of `items` (the real cells) matching the
  // indicator's live position + grown size, so the enlarged colored
  // duplicate underneath reads as one continuous piece of content instead
  // of the flat-sized real text showing through/around it. Mirrors
  // bottom-nav.js's updateMask() exactly, minus the vertical axis (this
  // picker only ever slides horizontally).
  function updateMask(sx = scale.value, sy = scale.value) {
    if (!cellW || !cellH) return;
    const w = cellW * sx;
    const h = cellH * sy;
    const r = Math.min(w, h) / 2;
    const cx = pos.value + cellW / 2;
    const cy = cellH / 2 + posCross.value;
    const x = cx - w / 2, y = cy - h / 2;
    const itemsW = items.offsetWidth, itemsH = items.offsetHeight;
    const d = `M0 0H${itemsW}V${itemsH}H0Z ` +
      `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
    const clip = `path(evenodd, "${d}")`;
    items.style.clipPath = clip;
    items.style.webkitClipPath = clip;
  }

  function nearestIndex(p) {
    let best = 0, bestDist = Infinity;
    anchors.forEach((a, i) => {
      const d = Math.abs(p - a);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  }

  function shake() {
    indicator.classList.remove('shake');
    void indicator.offsetWidth; // force reflow to restart the animation
    indicator.classList.add('shake');
    indicator.addEventListener('animationend', () => indicator.classList.remove('shake'), { once: true });
    haptics.trigger(defaultPatterns.error);
  }

  // Bounces the indicator back to wherever it's already settled — a
  // rejected drag target (skipped day, or the same day it started on) or an
  // under-threshold tap. Faster/snappier than a real selection's spring
  // (higher stiffness+damping): this is a correction, not a move, so it
  // shouldn't linger.
  function returnToActive() {
    if (activeIndex < 0) return;
    pos.to(anchors[activeIndex], { stiffness: 700, damping: 50, mass: 0.7 });
  }

  // Springs the indicator onto anchors[index] and marks that cell active,
  // without touching onSelect — used for the initial/instant placement path
  // only (selectElement's animate:false branch); the interactive tap/drag
  // paths below animate position themselves.
  function settle(index, { animate = true } = {}) {
    if (index < 0 || index >= elements.length) return;
    activeIndex = index;
    if (animate) pos.to(anchors[index], { stiffness: 400, damping: 38, mass: 0.8 });
    else pos.set(anchors[index]);
  }

  function selectElement(el, { silent = false, animate = true } = {}) {
    const index = elements.indexOf(el);
    if (index === -1) {
      // el isn't part of the currently laid-out set — most commonly because
      // the whole container is display:none (e.g. the mobile-only day
      // selector while on desktop). onSelect still needs to fire so callers
      // reacting to *which* cell is logically selected (not just the
      // indicator's position) stay correct; refresh() + a follow-up
      // selectElement() once the container is visible again will place the
      // indicator properly.
      onSelect?.(el, { silent });
      return;
    }

    if (!animate) {
      settle(index, { animate: false });
      onSelect?.(el, { silent });
      return;
    }

    // Same lift-then-slide-then-settle beat as bottom-nav.js's
    // animateGroupTap: grow first, *then* (50ms later) spring into the new
    // anchor while still lifted, then shrink back down.
    activeIndex = index;
    onSelect?.(el, { silent });
    scale.to(TAP_SCALE, { stiffness: 500, damping: 25, mass: 0.5 });
    setTimeout(() => pos.to(anchors[index], { stiffness: 400, damping: 38, mass: 0.8 }), 50);
    setTimeout(() => scale.to(1, { stiffness: 350, damping: 30, mass: 0.8 }), 250);
  }

  // Click handling for cells the drag hit-overlay doesn't cover (anything
  // other than the currently active cell — see the hit-overlay comment
  // below for why that one's handled through pointer events instead).
  items.addEventListener('click', e => {
    const el = e.target.closest('.date-element-container');
    if (!el || !elements.includes(el)) return;
    if (isSkipped(el)) { shake(); return; }
    selectElement(el);
  });

  // --- Drag, mirrors bottom-nav.js -----------------------------------------
  // Two ways in: grab the indicator via `hit` (relative — moves by your drag
  // delta) or press-and-hold on an unselected cell (absolute — the indicator
  // lifts and glides under your finger, then tracks it). A quick tap on a
  // cell still just selects, via the `items` click listener above.
  const HOLD_MS = 130;
  const ENGAGE_MOVE = 6;
  let dragging = false, grabbed = false, absoluteDrag = false;
  let startX = 0, startY = 0, grantTime = 0, dragOriginPos = 0, originScreenX = 0;
  let holdTimer = 0, captureEl = null;
  let samples = [];

  const clampDragPos = p => anchors.length
    ? Math.max(anchors[0] - DRAG_OVERSHOOT, Math.min(anchors[anchors.length - 1] + DRAG_OVERSHOOT, p))
    : p;

  // Live drag position: elastic past the first/last anchor rather than a hard
  // stop, so the pill can be pulled a bit further off the rail.
  const railDragPos = raw => {
    if (!anchors.length) return raw;
    const lo = anchors[0], hi = anchors[anchors.length - 1];
    if (raw < lo) return lo + rubber(raw - lo, RAIL_GIVE);
    if (raw > hi) return hi + rubber(raw - hi, RAIL_GIVE);
    return raw;
  };

  // Indicator leading edge (anchor units) that centres it under the pointer.
  const cellEdgeAtPointer = e => (e.clientX - originScreenX) - cellW / 2;

  function engage(e) {
    if (grabbed) return;
    grabbed = true;
    clearTimeout(holdTimer); holdTimer = 0;
    pos.stop(); posCross.stop();
    dragOriginPos = pos.value;
    scale.to(TAP_SCALE, { stiffness: 500, damping: 25, mass: 0.5 });
    if (absoluteDrag) {
      pos.to(railDragPos(cellEdgeAtPointer(e)), { stiffness: 700, damping: 42, mass: 0.55 });
    }
  }

  function onDragStart(e) {
    if (!anchors.length) return;
    const onHit = e.currentTarget === hit;
    captureEl = onHit ? hit : e.target.closest('.date-element-container');
    if (!captureEl) return;
    captureEl.setPointerCapture(e.pointerId);
    dragging = true;
    grabbed = false;
    absoluteDrag = !onHit;
    startX = e.clientX;
    startY = e.clientY;
    grantTime = performance.now();
    samples = [{ x: e.clientX, y: e.clientY, t: grantTime }];
    originScreenX = wrapper.getBoundingClientRect().left + originX;
    if (absoluteDrag) holdTimer = setTimeout(() => engage(e), HOLD_MS);
    else engage(e);
  }

  function onDragMove(e) {
    if (!dragging) return;
    const now = performance.now();
    samples.push({ x: e.clientX, y: e.clientY, t: now });
    while (samples.length > 2 && now - samples[0].t > 100) samples.shift();

    if (!grabbed) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > ENGAGE_MOVE) engage(e);
      else return;
    }
    if (!absoluteDrag && now - grantTime < 50) return;

    const raw = absoluteDrag ? cellEdgeAtPointer(e) : dragOriginPos + (e.clientX - startX);
    pos.to(railDragPos(raw), { stiffness: 1000, damping: 70, mass: 0.5 });
    posCross.to(rubber(e.clientY - startY, CROSS_GIVE), { stiffness: 700, damping: 42, mass: 0.5 });
    containerOff.to(rubber((e.clientX - startX) * CONTAINER_FOLLOW, CONTAINER_GIVE),
      { stiffness: 260, damping: 26, mass: 1 });
    containerCross.to(rubber((e.clientY - startY) * CONTAINER_FOLLOW, CONTAINER_GIVE_CROSS),
      { stiffness: 260, damping: 26, mass: 1 });
  }

  function release(e, terminated) {
    if (!dragging) return;
    dragging = false;
    clearTimeout(holdTimer); holdTimer = 0;
    try { captureEl?.releasePointerCapture(e.pointerId); } catch { /* already gone */ }

    // Never engaged → a quick tap on a cell; leave it to the click listener.
    if (!grabbed) { captureEl = null; return; }

    if (absoluteDrag) {
      const swallow = ev => ev.stopImmediatePropagation();
      items.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => items.removeEventListener('click', swallow, { capture: true }), 0);
    }
    captureEl = null;

    scale.to(1, { stiffness: 350, damping: 30, mass: 0.8 });
    posCross.to(0, { stiffness: 480, damping: 26, mass: 0.6 });
    containerOff.to(0, { stiffness: 320, damping: 24, mass: 0.8 });
    containerCross.to(0, { stiffness: 320, damping: 24, mass: 0.8 });

    const dMain = e.clientX - startX;
    if (terminated || (!absoluteDrag && Math.abs(dMain) < 8)) {
      returnToActive();
      return;
    }

    const a = samples[0], b = samples[samples.length - 1];
    const v = b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0;
    const from = absoluteDrag ? cellEdgeAtPointer(e) : dragOriginPos + dMain;
    const projected = clampDragPos(from + v * 80);
    const nearest = nearestIndex(projected);
    const el = elements[nearest];

    // A forbidden or unchanged target: just spring back to the last
    // selection, faster than a real move — no shake for a drag.
    if (isSkipped(el) || nearest === activeIndex) {
      returnToActive();
      return;
    }

    selectElement(el);
  }

  for (const el of [hit, items]) {
    el.addEventListener('pointerdown', onDragStart);
    el.addEventListener('pointermove', onDragMove);
    el.addEventListener('pointerup', e => release(e, false));
    el.addEventListener('pointercancel', e => release(e, true));
  }

  return {
    refresh,
    selectElement,
    get activeElement() { return elements[activeIndex]; },
  };
}
