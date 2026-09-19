// Spring-driven "glass pill" tap + drag behavior, extracted from
// bottom-nav.js's group tab pill (horizontal axis only, for now).
//
// The core owns everything that isn't markup/styling: the springs, the lift
// (grow) on tap/grab, the inertia squash-and-stretch, the rubber-banded rail,
// the whole-control trail, press-and-hold-to-grab on an unselected cell, the
// release projection, and the clip-path hole that hides the un-highlighted
// label under the lifted pill. Consumers supply the DOM and decide what a
// selection means (see segmented-control.js).
//
// Expected DOM (positions are set from JS, the rest is the consumer's CSS):
//   root       position:relative; gets the "trail" transform while dragging
//     items    position:relative; flex row of cells; gets the clip-path hole
//     pill     position:absolute; translated/scaled/resized by the core
//       activeRow  position:absolute; holds one duplicate of every cell
//     hit      position:absolute; invisible grab target laid over the pill
//
// Measurement uses offset* (not getBoundingClientRect) so it stays correct
// while an ancestor is mid-transform, e.g. the settings popup's morph-open.
import { Spring, onSpringFrame } from '../utils/spring.js';
import { haptics, defaultPatterns } from './haptics.js';

const RAIL_GIVE = 11;             // elastic px the pill can be pulled past the end anchors
const CROSS_GIVE = 5;             // elastic px the pill can be pulled off its rail
const STRETCH_GAIN = 0.9;         // pill speed (px/ms) → inertia deform ratio
const STRETCH_MAX = 0.26;
const TRAIL = {
  follow: 0.09,                   // fraction of the drag the whole control trails by
  give: 5,                        // px cap along the rail
  giveCross: 4,                   // px cap across it
};
const DRAG_OVERSHOOT = 8;
const HOLD_MS = 130;              // press-and-hold before an unselected cell grabs the pill
const ENGAGE_MOVE = 6;            // ...or this much finger travel, whichever comes first
const LIFT_THRESHOLD = 1.001;

// Asymptotic rubber-band (approaches ±give, never past it).
const rubber = (x, give) => (x * give) / (give + Math.abs(x));

// onChange(index, { silent }) fires whenever a *different* cell becomes the
// selected one. `silent` is true only for a programmatic select(..., { silent }).
//
// Optional hooks:
//   canSelect(index)   false → that cell can't be chosen: a tap calls
//                      onReject(index) instead, a drag released over it
//                      springs back to the current cell.
//   haptic             called on a committed tap/drag (default: light tick;
//                      pass null when onChange already buzzes on its own).
//   trail              overrides TRAIL, how far the whole control follows a drag.
//   onPillTap()        a grab of the pill itself that barely moved (a tap on
//                      the pill; without this it just settles back).
//   onRender({ pos })  after every frame's transforms are written.
export function createPillDragCore({
  root, items, pill, hit, activeRow,
  cellSelector,
  activeCellClass = 'pill-active-cell',
  liftedClass = 'pill--lifted',
  tapScale = 1.3,
  trail = TRAIL,
  canSelect,
  onReject,
  haptic = () => haptics.trigger(defaultPatterns.light),
  onRender,
  onPillTap,
  onChange,
}) {
  let cells = [];
  let anchors = [];               // [{ pos, size }] — the pill's {x, w} sitting on each cell
  let index = -1;
  let itemsW = 0, itemsH = 0;
  let didInit = false;
  let timers = [];

  const pillPos = new Spring(0);
  const pillMain = new Spring(0);
  const crossOff = new Spring(0);
  const containerOff = new Spring(0);
  const containerCross = new Spring(0);
  const scale = new Spring(1);

  let lastRenderT = performance.now();
  let lastMainVal = 0, lastCrossVal = 0, smoothStretch = 0;

  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

  /* --- Layout ------------------------------------------------------ */
  function sizeForPos(pos) {
    const n = anchors.length;
    const clamped = Math.max(anchors[0].pos, Math.min(anchors[n - 1].pos, pos));
    for (let i = 0; i < n - 1; i++) {
      const a = anchors[i], b = anchors[i + 1];
      if (clamped >= a.pos && clamped <= b.pos) {
        const f = (clamped - a.pos) / (b.pos - a.pos);
        return a.size + f * (b.size - a.size);
      }
    }
    return anchors[n - 1].size;
  }

  // Re-measure everything. Call after cells are added/removed/relabelled;
  // `snap` places the pill instantly instead of springing (use when the
  // control was hidden or is about to be shown).
  function refresh({ snap = false } = {}) {
    // offsetWidth > 0 skips display:none cells and non-cell children.
    cells = Array.from(items.querySelectorAll(cellSelector)).filter(el => el.offsetWidth > 0);
    itemsW = items.offsetWidth;
    itemsH = items.offsetHeight;
    if (!cells.length || !itemsW || !itemsH) return;   // not laid out (yet)

    const left = itemsOffsetIn(root, 'offsetLeft');
    const top = itemsOffsetIn(root, 'offsetTop');
    for (const el of [pill, hit]) {
      el.style.left = left + 'px';
      el.style.top = top + 'px';
      el.style.height = itemsH + 'px';
    }
    activeRow.style.width = itemsW + 'px';

    // Cells are usually positioned against `items` itself, but may share an
    // offsetParent with it (e.g. a padded container) — normalize to items' origin.
    anchors = cells.map(el => ({
      pos: el.offsetLeft - (el.offsetParent === items ? 0 : items.offsetLeft),
      size: el.offsetWidth,
    }));

    // One duplicate per cell, centered on that cell's own anchor midpoint
    // rather than laid out by flex — see .bn-tab-active in bottom-nav.css
    // for why sub-pixel drift between two flow layouts is worth avoiding.
    activeRow.innerHTML = '';
    cells.forEach((el, i) => {
      const dup = document.createElement('span');
      dup.className = activeCellClass;
      dup.innerHTML = el.innerHTML;
      dup.style.left = (anchors[i].pos + anchors[i].size / 2) + 'px';
      dup.style.transform = 'translateX(-50%)';
      dup.style.height = '100%';
      // Auto width on an abs-positioned box shrinks to the room right of `left`,
      // squeezing the last cell's duplicate; max-content keeps it its natural size.
      dup.style.width = 'max-content';
      activeRow.appendChild(dup);
    });

    // A cell that disappeared (e.g. hidden) can leave `index` out of range.
    if (index >= anchors.length) index = anchors.length - 1;
    if (index >= 0) {
      const a = anchors[index];
      if (!didInit || snap) {
        pillPos.set(a.pos); pillMain.set(a.size); didInit = true;
      } else {
        pillPos.to(a.pos, { stiffness: 1000, damping: 100 });
        pillMain.to(a.size, { stiffness: 1000, damping: 100 });
      }
    }
    render();
  }

  // Offset of `items` within `ancestor`, summed up the offsetParent chain
  // (items usually sits inside an intermediate positioned track element).
  function itemsOffsetIn(ancestor, prop = 'offsetLeft') {
    let sum = 0, el = items;
    while (el && el !== ancestor) { sum += el[prop]; el = el.offsetParent; }
    return sum;
  }

  /* --- Render ------------------------------------------------------ */
  function updateMask(scMain = scale.value, scCross = scale.value) {
    if (!itemsW || !itemsH || index < 0) return;
    const w = pillMain.value * scMain;
    const h = itemsH * scCross;
    const r = Math.min(w, h) / 2;
    const cx = pillPos.value + pillMain.value / 2;
    const cy = itemsH / 2 + crossOff.value;
    const x = cx - w / 2, y = cy - h / 2;
    const d = `M0 0H${itemsW}V${itemsH}H0Z ` +
      `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
    const clip = `path(evenodd, "${d}")`;
    items.style.clipPath = clip;
    items.style.webkitClipPath = clip;
  }

  function render() {
    const nowT = performance.now();
    const gap = nowT - lastRenderT;
    lastRenderT = nowT;
    // The shared RAF loop pauses when idle; skip the velocity calc on the
    // first frame after it restarts rather than dividing a stale delta.
    if (gap > 100 || gap <= 0) {
      lastMainVal = pillPos.value;
      lastCrossVal = crossOff.value;
      smoothStretch = 0;
    }
    const dt = Math.min(Math.max(gap, 1), 64);
    const vMain = (pillPos.value - lastMainVal) / dt;
    const vCross = (crossOff.value - lastCrossVal) / dt;
    lastMainVal = pillPos.value;
    lastCrossVal = crossOff.value;

    const lifted = scale.value > LIFT_THRESHOLD;
    const speed = Math.hypot(vMain, vCross);
    const targetStretch = lifted ? Math.min(speed * STRETCH_GAIN, STRETCH_MAX) : 0;
    smoothStretch = lifted ? smoothStretch + (targetStretch - smoothStretch) * 0.3 : 0;
    const um = speed > 1e-3 ? Math.abs(vMain) / speed : 1;
    const uc = speed > 1e-3 ? Math.abs(vCross) / speed : 0;
    const stMain = smoothStretch * um;
    const stCross = smoothStretch * uc;
    const s = scale.value;
    const scMain = s * (1 + stMain - 0.5 * stCross);
    const scCross = s * (1 + stCross - 0.5 * stMain);

    pill.style.width = pillMain.value + 'px';
    hit.style.width = pillMain.value + 'px';
    const posStr = `translateX(${pillPos.value}px) translateY(${crossOff.value}px)`;
    pill.style.transform = `${posStr} scale(${scMain}, ${scCross})`;
    hit.style.transform = posStr;
    pill.style.opacity = index >= 0 ? '1' : '0';
    // Full glass look only while lifted; flat at rest. Checking scale.value
    // (not scale.resting) also covers reduced-motion, where to() snaps.
    pill.classList.toggle(liftedClass, lifted);
    activeRow.style.transform = `translateX(${-pillPos.value}px) translateY(${-crossOff.value}px)`;
    // The whole control (pill + chrome together) trails the drag a touch.
    const cx = containerOff.value, cy = containerCross.value;
    root.style.transform = (cx || cy) ? `translate(${cx}px, ${cy}px)` : '';
    updateMask(scMain, scCross);
    onRender?.({ pos: pillPos.value });
  }
  onSpringFrame(render);

  /* --- Selection --------------------------------------------------- */
  // Tap / programmatic select: lift, slide, settle. With animate:false the
  // pill is just placed (initial state), and with silent:true onChange is
  // skipped for callers reacting to their own change.
  function select(i, { animate = true, silent = false } = {}) {
    if (i < 0) return;
    const changed = i !== index;
    index = i;
    clearTimers();
    if (!animate) {
      const a = anchors[i];
      if (a) { pillPos.set(a.pos); pillMain.set(a.size); }
      scale.set(1);
      render();
      if (changed) onChange?.(i, { silent });
      return;
    }
    if (changed) onChange?.(i, { silent });
    const a = anchors[i];
    if (!a) return;
    scale.to(tapScale, { stiffness: 500, damping: 25, mass: 0.5 });
    later(() => {
      pillPos.to(a.pos, { stiffness: 400, damping: 35, mass: 0.8 });
      pillMain.to(a.size, { stiffness: 400, damping: 35, mass: 0.8 });
    }, 50);
    later(() => scale.to(1, { stiffness: 350, damping: 30, mass: 0.8 }), 250);
  }

  items.addEventListener('click', (e) => {
    const i = cells.indexOf(e.target.closest(cellSelector));
    if (i === -1 || i === index) return;
    if (canSelect && !canSelect(i)) { onReject?.(i); return; }
    haptic?.();
    select(i);
  });

  /* --- Drag -------------------------------------------------------- */
  // Two ways in: grab the pill itself (relative — it moves by your drag
  // delta), or press-and-hold on an unselected cell (absolute — the pill
  // lifts and glides under your finger, then tracks it). A quick tap on a
  // cell still just selects, via the click listener above.
  let dragging = false, grabbed = false, absoluteDrag = false;
  let startX = 0, startY = 0, grantTime = 0, dragOriginPos = 0, itemsOrigin = 0;
  let holdTimer = 0, captureEl = null;
  let samples = [];

  const clampDragPos = (pos) => Math.max(anchors[0].pos - DRAG_OVERSHOOT,
    Math.min(anchors[anchors.length - 1].pos + DRAG_OVERSHOOT, pos));

  const railDragPos = (raw) => {
    const lo = anchors[0].pos, hi = anchors[anchors.length - 1].pos;
    if (raw < lo) return lo + rubber(raw - lo, RAIL_GIVE);
    if (raw > hi) return hi + rubber(raw - hi, RAIL_GIVE);
    return raw;
  };

  const pillEdgeAtPointer = (e) => (e.clientX - itemsOrigin) - pillMain.value / 2;

  function engage(e) {
    if (grabbed) return;
    grabbed = true;
    clearTimeout(holdTimer); holdTimer = 0;
    clearTimers();
    pillPos.stop(); pillMain.stop(); crossOff.stop();
    dragOriginPos = pillPos.value;
    scale.to(tapScale, { stiffness: 500, damping: 25, mass: 0.5 });
    if (absoluteDrag) {
      const raw = pillEdgeAtPointer(e);
      pillPos.to(railDragPos(raw), { stiffness: 700, damping: 42, mass: 0.55 });
      pillMain.to(sizeForPos(raw), { stiffness: 700, damping: 42, mass: 0.55 });
    }
  }

  function onDragStart(e) {
    if (!anchors.length || index < 0) return;
    const onHit = e.currentTarget === hit;
    captureEl = onHit ? hit : e.target.closest(cellSelector);
    if (!captureEl) return;
    captureEl.setPointerCapture(e.pointerId);
    dragging = true;
    grabbed = false;
    absoluteDrag = !onHit;
    startX = e.clientX; startY = e.clientY;
    grantTime = performance.now();
    samples = [{ x: e.clientX, t: grantTime }];
    itemsOrigin = items.getBoundingClientRect().left;

    if (absoluteDrag) holdTimer = setTimeout(() => engage(e), HOLD_MS);
    else engage(e); // grabbing the pill itself: no wait
  }

  function onDragMove(e) {
    if (!dragging) return;
    const now = performance.now();
    samples.push({ x: e.clientX, t: now });
    while (samples.length > 2 && now - samples[0].t > 100) samples.shift();

    const dMain = e.clientX - startX, dCross = e.clientY - startY;
    if (!grabbed) {
      if (Math.hypot(dMain, dCross) > ENGAGE_MOVE) engage(e);
      else return;
    }
    if (!absoluteDrag && now - grantTime < 50) return;

    const raw = absoluteDrag ? pillEdgeAtPointer(e) : dragOriginPos + dMain;
    pillPos.to(railDragPos(raw), { stiffness: 1000, damping: 70, mass: 0.5 });
    pillMain.to(sizeForPos(raw), { stiffness: 1000, damping: 70, mass: 0.5 });
    crossOff.to(rubber(dCross, CROSS_GIVE), { stiffness: 700, damping: 42, mass: 0.5 });
    containerOff.to(rubber(dMain * trail.follow, trail.give),
      { stiffness: 260, damping: 26, mass: 1 });
    containerCross.to(rubber(dCross * trail.follow, trail.giveCross),
      { stiffness: 260, damping: 26, mass: 1 });
  }

  function release(e, terminated) {
    if (!dragging) return;
    dragging = false;
    clearTimeout(holdTimer); holdTimer = 0;
    try { captureEl?.releasePointerCapture(e.pointerId); } catch { /* already gone */ }

    // Never engaged → a quick tap on a cell; let its click select it.
    if (!grabbed) { captureEl = null; return; }

    // We drove the pill, so suppress the cell's click (whichever cell the
    // browser routes it to) — the selection is decided below.
    if (absoluteDrag) {
      const swallow = (ev) => ev.stopImmediatePropagation();
      items.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => items.removeEventListener('click', swallow, { capture: true }), 0);
    }
    captureEl = null;

    crossOff.to(0, { stiffness: 480, damping: 26, mass: 0.6 });
    containerOff.to(0, { stiffness: 320, damping: 24, mass: 0.8 });
    containerCross.to(0, { stiffness: 320, damping: 24, mass: 0.8 });
    const dMain = e.clientX - startX, dCross = e.clientY - startY;

    // A barely-moved grab of the pill itself is a tap on it.
    if (!terminated && !absoluteDrag && onPillTap && Math.abs(dMain) < 8 && Math.abs(dCross) < 8) {
      onPillTap();
      return;
    }

    // Cancelled, or a barely-moved grab of the pill itself → just settle back.
    if (terminated || (!absoluteDrag && Math.abs(dMain) < 8 && Math.abs(dCross) < 8)) {
      scale.to(1, { stiffness: 350, damping: 30, mass: 0.8 });
      const a = anchors[index];
      pillPos.to(a.pos, { stiffness: 400, damping: 38, mass: 0.8 });
      pillMain.to(a.size, { stiffness: 400, damping: 38, mass: 0.8 });
      return;
    }

    const a = samples[0], b = samples[samples.length - 1];
    const v = b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0;
    const from = absoluteDrag ? pillEdgeAtPointer(e) : dragOriginPos + dMain;
    const projectedPos = clampDragPos(from + v * 80);
    let nearest = 0, bestDist = Infinity;
    anchors.forEach((anchor, i) => {
      const d = Math.abs(projectedPos - anchor.pos);
      if (d < bestDist) { bestDist = d; nearest = i; }
    });
    // (With canSelect) a forbidden or unchanged target: spring back to the current cell,
    // snappier than a real move — it's a correction, not a selection.
    if (canSelect && (nearest === index || !canSelect(nearest))) {
      scale.to(1, { stiffness: 350, damping: 30, mass: 0.8 });
      const cur = anchors[index];
      pillPos.to(cur.pos, { stiffness: 700, damping: 50, mass: 0.7 });
      pillMain.to(cur.size, { stiffness: 700, damping: 50, mass: 0.7 });
      return;
    }
    const target = anchors[nearest];
    pillPos.to(target.pos, { stiffness: 400, damping: 38, mass: 0.8 });
    pillMain.to(target.size, { stiffness: 400, damping: 38, mass: 0.8 });
    later(() => scale.to(1, { stiffness: 350, damping: 30, mass: 0.8 }), 200);
    if (nearest !== index) {
      index = nearest;
      onChange?.(nearest, { silent: false });
      haptic?.();
    }
  }

  for (const el of [hit, items]) {
    el.addEventListener('pointerdown', onDragStart);
    el.addEventListener('pointermove', onDragMove);
    el.addEventListener('pointerup', (e) => release(e, false));
    el.addEventListener('pointercancel', (e) => release(e, true));
  }

  /* --- Keyboard (arrows cycle) ------------------------------------- */
  root.addEventListener('keydown', (e) => {
    const step = (e.key === 'ArrowRight' || e.key === 'ArrowDown') ? 1
      : (e.key === 'ArrowLeft' || e.key === 'ArrowUp') ? -1 : 0;
    if (!step || index < 0) return;
    const next = Math.max(0, Math.min(cells.length - 1, index + step));
    if (next === index) return;
    e.preventDefault();
    haptics.trigger(defaultPatterns.light);
    select(next);
    cells[next].focus();
  });

  return {
    refresh,
    select,
    get index() { return index; },
    get cells() { return cells; },
    indexOf: (el) => cells.indexOf(el),
  };
}
