// components/time-range-slider.js
// Horizontal drag-based time range selector. Replaces the two-card picker UI
// as the primary input; tapping a badge opens the morph popup for typed entry.

import { haptics, defaultPatterns } from './haptics.js';
import { openPicker, getPickerCards } from './time-picker.js';
import { createTimeFormatter } from '../utils/time-format.js';

const SNAP = 60; // one-hour grid — snaps only to HH:15 marks
const DRAG_THRESHOLD = 4; // px of movement before a tap becomes a drag

function toHHMM(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function timeToMinutes(str) {
  if (!str) return 0;
  const [h, m] = str.split(':').map(Number);
  return h * 60 + m;
}

function formatMinutes(minutes) {
  const d = new Date();
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return createTimeFormatter({ hour: 'numeric', minute: '2-digit' }).format(d);
}

function snapTo(m) {
  // Snap to nearest HH:15 mark (08:15, 09:15, …)
  return Math.round((m - 15) / 60) * 60 + 15;
}

function formatDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ── Builder ──────────────────────────────────────────────────────────────────

function buildSlider(fromInput, toInput) {
  const MIN   = timeToMinutes(fromInput.getAttribute('min') || '07:15');
  const MAX   = timeToMinutes(fromInput.getAttribute('max') || '20:15');
  const TOTAL = MAX - MIN;

  let fromMin = timeToMinutes(fromInput.value) || MIN;
  let toMin   = timeToMinutes(toInput.value)   || Math.min(fromMin + 60, MAX);

  // ── DOM structure ─────────────────────────────────────────────────────────

  const wrapper    = document.createElement('div');
  wrapper.className = 'trs-wrapper';

  const barWrapper = document.createElement('div');
  barWrapper.className = 'trs-bar-wrapper';

  const fromBadge = document.createElement('button');
  fromBadge.type = 'button';
  fromBadge.className = 'trs-badge trs-badge--from';
  fromBadge.setAttribute('aria-label', 'Edit start time');

  const toBadge = document.createElement('button');
  toBadge.type = 'button';
  toBadge.className = 'trs-badge trs-badge--to';
  toBadge.setAttribute('aria-label', 'Edit end time');

  const bar = document.createElement('div');
  bar.className = 'trs-bar';

  const range = document.createElement('div');
  range.className = 'trs-range';

  const durationEl = document.createElement('span');
  durationEl.className = 'trs-duration';
  range.appendChild(durationEl);

  const fromHandle = document.createElement('div');
  fromHandle.className = 'trs-handle trs-handle--from';
  fromHandle.tabIndex = 0;
  fromHandle.setAttribute('role', 'slider');
  fromHandle.setAttribute('aria-label', 'Start time');
  fromHandle.setAttribute('aria-valuemin', String(MIN));
  fromHandle.setAttribute('aria-valuemax', String(MAX));

  const toHandle = document.createElement('div');
  toHandle.className = 'trs-handle trs-handle--to';
  toHandle.tabIndex = 0;
  toHandle.setAttribute('role', 'slider');
  toHandle.setAttribute('aria-label', 'End time');
  toHandle.setAttribute('aria-valuemin', String(MIN));
  toHandle.setAttribute('aria-valuemax', String(MAX));

  const ticks = document.createElement('div');
  ticks.className = 'trs-ticks';

  bar.append(range, fromHandle, toHandle);
  barWrapper.append(fromBadge, toBadge, bar, ticks);
  wrapper.append(barWrapper);

  // ── Geometry helpers ──────────────────────────────────────────────────────

  function pct(m) {
    return `${((m - MIN) / TOTAL * 100).toFixed(2)}%`;
  }

  function xToMinutes(clientX) {
    const rect = bar.getBoundingClientRect();
    if (!rect.width) return fromMin;
    return MIN + Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * TOTAL;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function buildTicks() {
    ticks.innerHTML = '';

    // Fixed boundary labels — always visible, edge-anchored
    const minLabel = document.createElement('div');
    minLabel.className = 'trs-tick-label trs-tick-label--min';
    minLabel.dataset.timeMinutes = MIN;
    minLabel.textContent = formatMinutes(MIN);
    ticks.appendChild(minLabel);

    const maxLabel = document.createElement('div');
    maxLabel.className = 'trs-tick-label trs-tick-label--max';
    maxLabel.dataset.timeMinutes = MAX;
    maxLabel.textContent = formatMinutes(MAX);
    ticks.appendChild(maxLabel);

    // Interior ticks — filtered by spacing to avoid overlap with edge labels
    const niceDivisions = [15, 20, 30, 45, 60, 90, 120];
    const tickInterval = niceDivisions.find(d => d >= TOTAL / 6) ?? 120;
    const minSpacing   = Math.round(tickInterval * 0.75);
    const edgeMargin   = 45; // wider margin so interior ticks don't crowd edge labels
    const candidates   = new Set();
    const firstMark    = Math.ceil((MIN - 15) / 60) * 60 + 15;
    for (let t = firstMark; t <= MAX; t += 60) candidates.add(t);

    let lastAdded = -Infinity;
    for (const t of [...candidates].sort((a, b) => a - b)) {
      if (t - MIN >= edgeMargin && MAX - t >= edgeMargin && t - lastAdded >= minSpacing) {
        const label = document.createElement('div');
        label.className = 'trs-tick-label';
        label.style.left = pct(t);
        label.dataset.timeMinutes = t;
        label.textContent = formatMinutes(t);
        ticks.appendChild(label);
        lastAdded = t;
      }
    }
  }

  function render() {
    fromBadge.textContent = formatMinutes(fromMin);
    fromBadge.style.left  = pct(fromMin);
    toBadge.textContent   = formatMinutes(toMin);
    toBadge.style.left    = pct(toMin);

    const duration    = toMin - fromMin;
    const rangePct    = duration / TOTAL * 100;
    range.style.left  = pct(fromMin);
    range.style.width = `${rangePct.toFixed(2)}%`;

    // Show duration label only when the range is wide enough to fit it
    const barWidth = bar.getBoundingClientRect().width;
    const rangePixels = (rangePct / 100) * barWidth;
    durationEl.textContent = formatDuration(duration);
    durationEl.style.display = rangePixels > 48 ? '' : 'none';

    fromHandle.style.left = pct(fromMin);
    fromHandle.setAttribute('aria-valuenow', String(fromMin));
    fromHandle.setAttribute('aria-valuetext', formatMinutes(fromMin));

    toHandle.style.left = pct(toMin);
    toHandle.setAttribute('aria-valuenow', String(toMin));
    toHandle.setAttribute('aria-valuetext', formatMinutes(toMin));
  }

  buildTicks(); // ticks are static (MIN/MAX fixed)

  // ── Input sync ────────────────────────────────────────────────────────────

  let _syncing = false;

  function syncInputs() {
    _syncing = true;
    fromInput.value = toHHMM(fromMin);
    toInput.value   = toHHMM(toMin);
    _syncing = false;
    // Input events let setupTimePickers enforce its constraints (min gap, etc.)
    fromInput.dispatchEvent(new Event('input', { bubbles: true }));
    toInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Chain onto whatever descriptor time-picker.js already installed so the
  // morph popup display stays in sync when external code sets .value.
  function chainValueSetter(input, onExternalSet) {
    const prev = Object.getOwnPropertyDescriptor(input, 'value')
              ?? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    Object.defineProperty(input, 'value', {
      get() { return prev.get.call(this); },
      set(val) {
        prev.set.call(this, val); // keeps time-picker popup display in sync
        if (!_syncing && val) onExternalSet(timeToMinutes(val));
      },
      configurable: true,
    });
  }

  chainValueSetter(fromInput, (m) => { fromMin = m; render(); });
  chainValueSetter(toInput,   (m) => { toMin   = m; render(); });

  // ── Drag ─────────────────────────────────────────────────────────────────

  let dragMode     = null; // 'from' | 'to' | 'pan' | null
  let panAnchorX   = 0;
  let panAnchorFrom = 0;
  let panAnchorTo   = 0;
  let pointerDownX  = 0;
  let didDrag       = false;
  let lastSnapFrom  = null; // track last snapped position to fire haptics only on change
  let lastSnapTo    = null;

  function onPointerDown(e) {
    if (e.button !== 0 && e.pointerType !== 'touch') return;
    e.preventDefault();
    pointerDownX = e.clientX;
    didDrag      = false;

    const rawM = xToMinutes(e.clientX);
    const rect  = bar.getBoundingClientRect();

    const fromPx  = ((fromMin - MIN) / TOTAL) * rect.width + rect.left;
    const toPx    = ((toMin   - MIN) / TOTAL) * rect.width + rect.left;
    const hitPx   = Math.max(20, Math.min(36, rect.width * 0.05));

    const dFrom = Math.abs(e.clientX - fromPx);
    const dTo   = Math.abs(e.clientX - toPx);

    if (dFrom <= hitPx && dFrom <= dTo) {
      dragMode = 'from';
      lastSnapFrom = fromMin;
      fromHandle.classList.add('trs-handle--dragging');
      fromBadge.classList.add('trs-badge--dragging');
    } else if (dTo <= hitPx) {
      dragMode = 'to';
      lastSnapTo = toMin;
      toHandle.classList.add('trs-handle--dragging');
      toBadge.classList.add('trs-badge--dragging');
    } else if (rawM >= fromMin - SNAP * 0.5 && rawM <= toMin + SNAP * 0.5) {
      dragMode      = 'pan';
      panAnchorX    = e.clientX;
      panAnchorFrom = fromMin;
      panAnchorTo   = toMin;
      lastSnapFrom  = fromMin;
      lastSnapTo    = toMin;
      fromBadge.classList.add('trs-badge--dragging');
      toBadge.classList.add('trs-badge--dragging');
    } else {
      return;
    }

    bar.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e) {
    if (!dragMode) return;
    if (!didDrag && Math.abs(e.clientX - pointerDownX) > DRAG_THRESHOLD) didDrag = true;
    if (!didDrag) return;

    const rawM    = xToMinutes(e.clientX);
    const snapped = snapTo(rawM);

    if (dragMode === 'from') {
      fromMin = Math.max(MIN, Math.min(snapped, toMin - SNAP));
      if (fromMin !== lastSnapFrom) {
        haptics.trigger(defaultPatterns.success);
        lastSnapFrom = fromMin;
      }
    } else if (dragMode === 'to') {
      toMin = Math.max(fromMin + SNAP, Math.min(snapped, MAX));
      if (toMin !== lastSnapTo) {
        haptics.trigger(defaultPatterns.success);
        lastSnapTo = toMin;
      }
    } else {
      const rect      = bar.getBoundingClientRect();
      const deltaM    = ((e.clientX - panAnchorX) / rect.width) * TOTAL;
      const snappedΔ  = snapTo(panAnchorFrom + deltaM) - panAnchorFrom;
      const duration  = panAnchorTo - panAnchorFrom;
      const newFrom   = panAnchorFrom + snappedΔ;
      const newTo     = panAnchorTo   + snappedΔ;
      if (newFrom >= MIN && newTo <= MAX) {
        fromMin = newFrom;
        toMin   = newTo;
      } else if (newFrom < MIN) {
        fromMin = MIN;
        toMin   = MIN + duration;
      } else {
        toMin   = MAX;
        fromMin = MAX - duration;
      }
      if (fromMin !== lastSnapFrom) {
        haptics.trigger(defaultPatterns.success);
        lastSnapFrom = fromMin;
        lastSnapTo   = toMin;
      }
    }

    render();
    syncInputs();
  }

  function onPointerUp() {
    if (!dragMode) return;
    fromHandle.classList.remove('trs-handle--dragging');
    toHandle.classList.remove('trs-handle--dragging');
    fromBadge.classList.remove('trs-badge--dragging');
    toBadge.classList.remove('trs-badge--dragging');

    const wasDrag      = didDrag;
    const endedDragMode = dragMode;
    dragMode = null;
    didDrag  = false;

    if (wasDrag) {
      haptics.trigger(defaultPatterns.success);
      // Reflect any corrections applied by setupTimePickers' input listeners
      const cFrom = timeToMinutes(fromInput.value);
      const cTo   = timeToMinutes(toInput.value);
      if (cFrom !== fromMin || cTo !== toMin) {
        fromMin = cFrom; toMin = cTo; render();
      }
    } else {
      // Tap (no significant movement) — open popup for the tapped handle
      if (endedDragMode === 'from') openFrom();
      else if (endedDragMode === 'to')   openTo();
    }
  }

  bar.addEventListener('pointerdown', onPointerDown);
  bar.addEventListener('pointermove', onPointerMove);
  bar.addEventListener('pointerup',   onPointerUp);
  bar.addEventListener('pointercancel', onPointerUp);

  // ── Tap badge / handle → open morph popup ────────────────────────────────

  function openFrom() {
    const { fromCard } = getPickerCards();
    if (!fromCard) return;
    fromCard._sourceRect = fromBadge.getBoundingClientRect();
    openPicker(fromCard, fromCard._sourceRect);
  }

  function openTo() {
    const { toCard } = getPickerCards();
    if (!toCard) return;
    toCard._sourceRect = toBadge.getBoundingClientRect();
    openPicker(toCard, toCard._sourceRect);
  }

  fromBadge.addEventListener('click', openFrom);
  toBadge.addEventListener('click', openTo);

  // ── Keyboard ──────────────────────────────────────────────────────────────

  fromHandle.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 60 : SNAP;
    if (e.key === 'ArrowLeft') {
      fromMin = Math.max(MIN, fromMin - step);
      render(); syncInputs(); haptics.trigger(defaultPatterns.success);
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      fromMin = Math.min(toMin - SNAP, fromMin + step);
      render(); syncInputs(); haptics.trigger(defaultPatterns.success);
      e.preventDefault();
    } else if (e.key === 'Enter' || e.key === ' ') {
      openFrom(); e.preventDefault();
    }
  });

  toHandle.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 60 : SNAP;
    if (e.key === 'ArrowLeft') {
      toMin = Math.max(fromMin + SNAP, toMin - step);
      render(); syncInputs(); haptics.trigger(defaultPatterns.success);
      e.preventDefault();
    } else if (e.key === 'ArrowRight') {
      toMin = Math.min(MAX, toMin + step);
      render(); syncInputs(); haptics.trigger(defaultPatterns.success);
      e.preventDefault();
    } else if (e.key === 'Enter' || e.key === ' ') {
      openTo(); e.preventDefault();
    }
  });

  // ── Re-render on locale change ─────────────────────────────────────────────

  window.addEventListener('timeformatchange', () => {
    buildTicks();
    render();
  });

  render();

  // Expose badge elements so caller can pre-set _sourceRect on cards
  wrapper._fromBadge = fromBadge;
  wrapper._toBadge   = toBadge;

  return wrapper;
}

// ── Init ─────────────────────────────────────────────────────────────────────

export function initTimeRangeSlider() {
  const fromInput = document.getElementById('from-time-picker');
  const toInput   = document.getElementById('to-time-picker');
  if (!fromInput || !toInput) return;

  // Hide the tp-card trigger buttons — keep in DOM so openPicker() can still
  // reference them for popup wiring, but the slider replaces the visual.
  document.querySelectorAll('.tp-card').forEach(c => { c.style.display = 'none'; });

  const container = document.querySelector('.time-pickers-container');
  if (!container) return;

  const slider = buildSlider(fromInput, toInput);
  container.appendChild(slider);

  // Pre-register source rects so switchPicker has valid positions for both
  // cards even before the user taps either badge.
  requestAnimationFrame(() => {
    const { fromCard, toCard } = getPickerCards();
    if (fromCard) fromCard._sourceRect = slider._fromBadge.getBoundingClientRect();
    if (toCard)   toCard._sourceRect   = slider._toBadge.getBoundingClientRect();
  });
}
