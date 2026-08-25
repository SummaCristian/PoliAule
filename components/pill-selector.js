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
const DRAG_OVERSHOOT = 8;
const LIFT_THRESHOLD = 1.001;

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
  const scale = new Spring(1);

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
    // The shake keyframes (date-indicator-shake in date-picker.css) read
    // --indicator-x to know the base position to rotate/jitter around.
    indicator.style.setProperty('--indicator-x', `${pos.value}px`);
    indicator.style.transform = `translateX(${pos.value}px) scale(${scale.value})`;
    indicator.style.opacity = activeIndex >= 0 ? '1' : '0';
    indicator.classList.toggle('date-indicator--lifted', scale.value > LIFT_THRESHOLD);
    hit.style.transform = `translateX(${pos.value}px)`;
    activeRow.style.transform = `translateX(${-pos.value}px)`;
    updateMask();
  }
  onSpringFrame(render);

  // Cuts a pill-shaped hole out of `items` (the real cells) matching the
  // indicator's live position + grown size, so the enlarged colored
  // duplicate underneath reads as one continuous piece of content instead
  // of the flat-sized real text showing through/around it. Mirrors
  // bottom-nav.js's updateMask() exactly, minus the vertical axis (this
  // picker only ever slides horizontally).
  function updateMask() {
    if (!cellW || !cellH) return;
    const w = cellW * scale.value;
    const h = cellH * scale.value;
    const r = Math.min(w, h) / 2;
    const cx = pos.value + cellW / 2;
    const cy = cellH / 2;
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

  // --- Drag, mirrors bottom-nav.js's pillHit/pillPos -------------------
  // `hit` sits exactly over the active cell's current position (see render()
  // above), so a plain tap on the active cell also flows through here rather
  // than the delegated click listener.
  let dragging = false, startX = 0, grantTime = 0, dragOriginPos = 0;
  let samples = [];

  const clampDragPos = p => anchors.length
    ? Math.max(anchors[0] - DRAG_OVERSHOOT, Math.min(anchors[anchors.length - 1] + DRAG_OVERSHOOT, p))
    : p;

  hit.addEventListener('pointerdown', e => {
    if (!anchors.length) return;
    hit.setPointerCapture(e.pointerId);
    dragging = true;
    startX = e.clientX;
    grantTime = performance.now();
    samples = [{ p: e.clientX, t: grantTime }];
    pos.stop();
    dragOriginPos = pos.value;
    scale.to(TAP_SCALE, { stiffness: 500, damping: 25, mass: 0.5 });
  });

  hit.addEventListener('pointermove', e => {
    if (!dragging) return;
    const now = performance.now();
    samples.push({ p: e.clientX, t: now });
    while (samples.length > 2 && now - samples[0].t > 100) samples.shift();
    if (now - grantTime < 50) return;
    pos.to(clampDragPos(dragOriginPos + (e.clientX - startX)), { stiffness: 1000, damping: 70, mass: 0.5 });
  });

  function release(e, terminated) {
    if (!dragging) return;
    dragging = false;
    scale.to(1, { stiffness: 350, damping: 30, mass: 0.8 });

    const dMain = e.clientX - startX;
    if (terminated || Math.abs(dMain) < 8) {
      returnToActive();
      return;
    }

    const a = samples[0], b = samples[samples.length - 1];
    const v = b.t > a.t ? (b.p - a.p) / (b.t - a.t) : 0;
    const projected = clampDragPos(dragOriginPos + dMain + v * 80);
    const nearest = nearestIndex(projected);
    const el = elements[nearest];

    // A forbidden or unchanged target: just spring back to the last
    // selection, faster than a real move — no shake for a drag (unlike a
    // direct tap on it).
    if (isSkipped(el) || nearest === activeIndex) {
      returnToActive();
      return;
    }

    selectElement(el);
  }
  hit.addEventListener('pointerup', e => release(e, false));
  hit.addEventListener('pointercancel', e => release(e, true));

  return {
    refresh,
    selectElement,
    get activeElement() { return elements[activeIndex]; },
  };
}
