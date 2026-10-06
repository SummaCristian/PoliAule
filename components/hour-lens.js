// components/hour-lens.js
// The time range picker: the day's one-hour lecture slots (07:15 … 20:15) as a
// row of cells, with a tinted glass lens laid over the chosen hours.
//
// Only the start moves by touch: tap an hour and the range starts there, drag
// the lens (or press-and-hold an hour, then drag) to slide it. The lens
// follows the finger with a magnetic detent (it sticks to each hour, then hops
// across the boundary) and lands on the nearest hour on release. The duration
// is a Vitrium stepper in the title row.
//
// The picker writes the two native <input type="time"> fields
// (#from-time-picker / #to-time-picker), firing `input` on them as the old
// slider did, so live search and <time-range-chip-picker>'s label keep working;
// it only writes when a gesture ends, never mid-drag. Values set on the inputs
// from outside are picked up through a chained `value` setter.
//
// Extras:
//   - Each cell fills with the share of the campus's rooms free for that whole
//     hour (getFreeShareBySlot), for the selected campus and day.
//   - When the selected day is today, a line marks the current time, and hours
//     that have already ended are blocked unless the "Block past hours" setting
//     is off.
//
// The lens physics reuse Vitrium's springs with pill-drag-core's tunings; the
// core itself assumes a one-cell pill, so the lens (which spans N cells) is
// driven here.
import { Spring, onSpringFrame, createStepper } from 'vitrium';
import { t } from '../i18n.js';
import { createTimeFormatter } from '../utils/time-format.js';
import { getFreeShareBySlot } from '../available-rooms-script.js';
import { BLOCK_PAST_HOURS_KEY } from './settings.js';

const FIRST = 7 * 60 + 15;            // 07:15
const N = 13;                         // slots, so the last one ends at 20:15

const pad2 = (n) => String(n).padStart(2, '0');
const toHHMM = (m) => `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
const toMinutes = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const at = (i) => FIRST + i * 60;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rubber = (x, give) => (x * give) / (give + Math.abs(x));

const PAD = 3;                        // lens overhang around the cells it covers
const CELL_RADIUS = 8;                // keep in sync with .hl-cell in hour-lens.css
const LIFT_X = 4, LIFT_Y = 5;         // px the lens grows by, each side, when lifted
const RAIL_GIVE = 11, CROSS_GIVE = 5;
const HOLD_MS = 130, ENGAGE_MOVE = 6;

// Spring tunings, as in Vitrium's pill-drag-core.
const LIFT_IN = { stiffness: 500, damping: 25, mass: 0.5 };
const LIFT_OUT = { stiffness: 350, damping: 30, mass: 0.8 };
const MOVE = { stiffness: 400, damping: 35, mass: 0.8 };
const SETTLE = { stiffness: 400, damping: 38, mass: 0.8 };
const FOLLOW = { stiffness: 1000, damping: 70, mass: 0.5 };

function formatTime(minutes) {
  const d = new Date();
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return createTimeFormatter({ hour: 'numeric', minute: '2-digit' }).format(d);
}

// The same, as markup for the readout, with the day period (AM / PM) in its own
// span so it can be set smaller. Only formatter output goes in, so no escaping.
function formatTimeHTML(minutes) {
  const d = new Date();
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return createTimeFormatter({ hour: 'numeric', minute: '2-digit' }).formatToParts(d)
    .map(p => (p.type === 'dayPeriod' ? `<span class="hl-ampm">${p.value}</span>` : p.value))
    .join('')
    .trim();
}

// Just the hour number ("8", or "1" for 13:15 in 12h mode), for the labels under the cells.
function formatHour(minutes) {
  const d = new Date();
  d.setHours(Math.floor(minutes / 60), 0, 0, 0);
  const parts = createTimeFormatter({ hour: 'numeric', minute: undefined }).formatToParts(d);
  const hour = parts.find(p => p.type === 'hour')?.value;
  return hour ? String(Number(hour)) : String(d.getHours());   // "7", not "07"
}

const localDateKey = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const blockPastHours = () => localStorage.getItem(BLOCK_PAST_HOURS_KEY) !== 'false';

function buildHourLens(fromInput, toInput, { datePicker, campusInput }) {
  // ── State ───────────────────────────────────────────────────────────────
  let start = 0, dur = 2;             // slot index, hours
  let minStart = 0;                   // earliest selectable start (today's past hours are blocked)
  let nowSlot = -1;                   // the slot holding the current time, when the day is today

  function readInputs() {
    const from = fromInput.value ? toMinutes(fromInput.value) : at(0);
    const to = toInput.value ? toMinutes(toInput.value) : from + 120;
    const s = clamp(Math.round((from - FIRST) / 60), 0, N - 1);
    const d = clamp(Math.round((to - from) / 60), 1, N - s);
    start = s; dur = d;
  }
  readInputs();

  // Keeps the selection inside the selectable hours: at least one hour,
  // starting no earlier than minStart, ending by 20:15. True if it changed.
  function fitSelection() {
    const d = clamp(dur, 1, N - minStart);
    const s = clamp(start, minStart, N - d);
    if (s === start && d === dur) return false;
    start = s; dur = d;
    return true;
  }

  // ── DOM ─────────────────────────────────────────────────────────────────
  const wrapper = document.createElement('div');
  wrapper.className = 'hl';
  wrapper.innerHTML = `
    <div class="hl-title">
      <i class="hgi-stroke hgi-clock-01 hl-icon" aria-hidden="true"></i>
      <span class="hl-label" data-i18n="timepicker.timeLabel">${t('timepicker.timeLabel')}</span>
    </div>
    <div class="hl-head">
      <div class="hl-readout">
        <span class="hl-time"></span>
      </div>
      <div class="hl-dur"></div>
    </div>
    <div class="hl-rail">
      <div class="hl-track"></div>
      <div class="hl-lens lg-glass lg-glass--clear lg-glass--tinted"></div>
      <div class="hl-hit" tabindex="0" role="slider"></div>
    </div>
    <div class="hl-hours" aria-hidden="true"></div>`;

  const rail = wrapper.querySelector('.hl-rail');
  const track = wrapper.querySelector('.hl-track');
  const lens = wrapper.querySelector('.hl-lens');
  const hit = wrapper.querySelector('.hl-hit');
  const hours = wrapper.querySelector('.hl-hours');
  const timeEl = wrapper.querySelector('.hl-time');
  const durHost = wrapper.querySelector('.hl-dur');

  for (let i = 0; i < N; i++) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'hl-cell';
    cell.tabIndex = -1;               // the lens is the one keyboard stop
    track.appendChild(cell);
    hours.appendChild(document.createElement('span'));
  }
  const cells = [...track.children];
  const hourLabels = [...hours.children];
  const nowMark = document.createElement('span');
  nowMark.className = 'hl-now';

  function labelCells() {
    cells.forEach((c, i) => c.setAttribute('aria-label', formatTime(at(i))));
    hourLabels.forEach((h, i) => { h.textContent = formatHour(at(i)); });
  }
  labelCells();

  // ── Duration stepper ───────────────────────────────────────────────────
  const durLabel = document.createElement('span');
  durLabel.className = 'hl-dur-label';
  durLabel.innerHTML = '<i class="hgi-stroke hgi-hourglass" aria-hidden="true"></i><span></span>';
  const durText = durLabel.lastElementChild;
  let stepper = null, stepperMax = 0;

  function buildStepper() {
    const max = N - minStart;
    if (stepper && stepperMax === max) { stepper.set(dur); return; }
    stepper?.destroy();
    stepperMax = max;
    stepper = createStepper({
      value: dur, min: 1, max, step: 1,
      label: t('timepicker.duration'),
      labels: [t('timepicker.shorter'), t('timepicker.longer')],
      format: (v) => `${v}h`,
      onChange: (v) => setDuration(v),
    });
    stepper.el.querySelector('.lg-stepper__separator').replaceWith(durLabel);
    durHost.replaceChildren(stepper.el);
  }

  // ── Geometry ────────────────────────────────────────────────────────────
  let L = [], W = 0, H = 0, pitch = 0;
  let endRx = 0, endRy = 0;           // the end cells' outer curve (elliptical on narrow cells)
  function measure() {
    W = cells[0].offsetWidth;
    if (!W) return false;             // hidden (a closed panel): keep the last layout
    L = cells.map((c) => c.offsetLeft);
    H = track.offsetHeight;
    pitch = L[1] - L[0];
    // As round as the cell allows. A plain 999px radius would make the browser
    // scale every corner of a narrow cell down to fit (squashing the curve and
    // squaring off its inner corners), and the lens couldn't sit evenly around it.
    endRy = H / 2;
    endRx = Math.min(endRy, W - CELL_RADIUS);
    track.style.setProperty('--hl-end-rx', `${endRx}px`);
    track.style.setProperty('--hl-end-ry', `${endRy}px`);
    return true;
  }
  const spanW = (d) => (L[d - 1] + W) - L[0];
  const maxStart = () => N - dur;

  // ── Springs ─────────────────────────────────────────────────────────────
  const pos = new Spring(0);          // lens left edge, px
  const wid = new Spring(0);          // lens width, px
  const lift = new Spring(0);         // 0 resting … 1 lifted
  const cross = new Spring(0);        // off-rail wobble
  const trail = new Spring(0);        // the rail trails the drag a touch
  lift.eps = 0.001;

  let timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

  // ── Render ──────────────────────────────────────────────────────────────
  let lastT = performance.now(), lastPos = 0, smooth = 0, shown = -1, shownDur = -1;

  const liveStart = () => (pitch
    ? clamp(Math.round((pos.value - L[0]) / pitch), minStart, maxStart())
    : start);

  function showRange(s) {
    shown = s; shownDur = dur;
    const text = `${formatTime(at(s))} – ${formatTime(at(s + dur))}`;
    timeEl.innerHTML = `${formatTimeHTML(at(s))} – ${formatTimeHTML(at(s + dur))}`;
    fitTime();
    durText.textContent = `${dur}h`;
    cells.forEach((c, i) => c.classList.toggle('in-lens', i >= s && i < s + dur));
    hourLabels.forEach((h, i) => h.classList.toggle('in-lens', i >= s && i < s + dur));
    hit.setAttribute('aria-label', t('timepicker.startTime'));
    hit.setAttribute('aria-valuemin', String(minStart));
    hit.setAttribute('aria-valuemax', String(maxStart()));
    hit.setAttribute('aria-valuenow', String(s));
    hit.setAttribute('aria-valuetext', `${text}, ${dur}h`);
  }

  // The title row never wraps: when the range is too long for the room the
  // stepper leaves (12h times, narrow phones, larger text), the readout shrinks
  // to fit instead of pushing the stepper onto a line of its own.
  const TIME_MIN_PX = 13;
  function fitTime() {
    timeEl.style.fontSize = '';
    const room = timeEl.parentElement.clientWidth;
    const need = timeEl.scrollWidth;
    if (!room || need <= room) return;          // fits (or hidden: fitted again on reshow)
    const base = parseFloat(getComputedStyle(timeEl).fontSize);
    timeEl.style.fontSize = `${Math.max(TIME_MIN_PX, Math.floor(base * room / need * 10) / 10)}px`;
  }

  function render() {
    if (!pitch) return;
    const now = performance.now();
    const gap = now - lastT;
    lastT = now;
    if (gap > 100 || gap <= 0) { lastPos = pos.value; smooth = 0; }
    const dt = Math.min(Math.max(gap, 1), 64);
    const v = (pos.value - lastPos) / dt;
    lastPos = pos.value;

    const l = Math.max(0, lift.value);
    const lifted = l > 0.01;
    // Squash and stretch from speed, in px (a ratio would barely move a wide lens).
    const target = lifted ? Math.min(Math.abs(v) * 14, 12) : 0;
    smooth = lifted ? smooth + (target - smooth) * 0.3 : 0;

    const bw = wid.value + 2 * PAD, bh = H + 2 * PAD;
    const sx = 1 + (2 * LIFT_X * l + smooth) / bw;
    const sy = 1 + (2 * LIFT_Y * l) / bh - (0.5 * smooth) / bw;
    lens.style.width = bw + 'px';
    lens.style.height = bh + 'px';
    lens.style.transform = `translate(${pos.value - PAD}px, ${cross.value - PAD}px) scale(${sx}, ${sy})`;
    lens.style.setProperty('--lift', Math.min(l, 1).toFixed(3));
    hit.style.width = wid.value + 'px';
    hit.style.height = H + 'px';
    hit.style.transform = `translateX(${pos.value}px)`;
    rail.style.transform = trail.value ? `translateX(${trail.value}px)` : '';

    const s = liveStart();
    // Rounded like the cells, PAD out from them. Each side eases toward the end
    // cells' curve as it nears one (by distance, over one slot), so the shape
    // morphs with the lens's own spring as it slides, and as the duration changes.
    const kl = clamp(1 - (pos.value - L[0]) / pitch, 0, 1);
    const kr = clamp(1 - ((L[N - 1] + W) - (pos.value + wid.value)) / pitch, 0, 1);
    const corner = CELL_RADIUS + PAD;
    const mix = (k, r) => corner + (r + PAD - corner) * k;
    const lx = mix(kl, endRx), ly = mix(kl, endRy), rx = mix(kr, endRx), ry = mix(kr, endRy);
    lens.style.borderRadius = `${lx}px ${rx}px ${rx}px ${lx}px / ${ly}px ${ry}px ${ry}px ${ly}px`;
    if (s !== shown || dur !== shownDur) showRange(s);
  }
  onSpringFrame(render);

  // Snap the lens to its hours, for when the picker was just shown (it has no
  // layout while its panel is closed) or its size changed.
  function reshow() {
    if (drag || !measure()) return;
    clearTimers();
    lift.set(0); cross.set(0); trail.set(0);
    pos.set(L[start]);
    wid.set(spanW(dur));
    shown = -1;
    render();
    fitTime();
  }

  // ── Inputs ──────────────────────────────────────────────────────────────
  let syncing = false;
  let committed = `${start}/${dur}`;

  // Writes the chosen range to the form, firing `input` as the old slider did.
  function commit() {
    const key = `${start}/${dur}`;
    if (key === committed) return;
    committed = key;
    syncing = true;
    fromInput.value = toHHMM(at(start));
    toInput.value = toHHMM(at(start + dur));
    syncing = false;
    fromInput.dispatchEvent(new Event('input', { bubbles: true }));
    toInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Chain onto whatever `value` descriptor time-picker.js already installed, so
  // a value set from outside moves the lens too.
  function chainValueSetter(input) {
    const prev = Object.getOwnPropertyDescriptor(input, 'value')
      ?? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    Object.defineProperty(input, 'value', {
      get() { return prev.get.call(this); },
      set(val) {
        prev.set.call(this, val);
        if (syncing || !val) return;
        readInputs();
        committed = `${start}/${dur}`;
        // A range in today's blocked hours is moved on, and the form told so
        // (after this setter returns, not from inside it).
        if (fitSelection()) queueMicrotask(commit);
        buildStepper();
        place(start, { lifted: false });
      },
      configurable: true,
    });
  }
  chainValueSetter(fromInput);
  chainValueSetter(toInput);

  // ── Moving the lens ────────────────────────────────────────────────────
  function place(i, { animate = true, lifted = true } = {}) {
    start = clamp(i, minStart, maxStart());
    clearTimers();
    if (!pitch) return;
    const x = L[start], w = spanW(dur);
    if (!animate) { pos.set(x); wid.set(w); lift.set(0); render(); return; }
    if (!lifted) { pos.to(x, MOVE); wid.to(w, MOVE); return; }
    lift.to(1, LIFT_IN);
    later(() => { pos.to(x, MOVE); wid.to(w, MOVE); }, 50);
    later(() => lift.to(0, LIFT_OUT), 250);
  }

  function setDuration(v) {
    v = clamp(v, 1, N - minStart);
    if (v === dur) return;
    dur = v;
    // The end moves; the start only gives way when the end would pass 20:15.
    place(start, { lifted: false });
    render();
    commit();
  }

  // Where the lens sits for a raw (finger-driven) left edge: rubber-banded
  // past the ends, and magnetic in between (flat around each hour, steep
  // across the boundary between two).
  function shape(raw) {
    const lo = L[minStart], hi = L[maxStart()];
    if (raw < lo) return lo + rubber(raw - lo, RAIL_GIVE);
    if (raw > hi) return hi + rubber(raw - hi, RAIL_GIVE);
    const f = (raw - L[0]) / pitch;
    const n = Math.round(f);
    const r = f - n;                  // -0.5 … 0.5
    return L[0] + (n + Math.sign(r) * 0.5 * Math.pow(Math.abs(2 * r), 2.6)) * pitch;
  }

  // ── Gestures ────────────────────────────────────────────────────────────
  // Grab the lens: it follows the drag (relative). Press-and-hold an hour, or
  // drag from one: the lens jumps under the finger (absolute), its first hour
  // under the fingertip. A quick tap on an hour is the click handler below.
  let drag = null;

  const rawOf = (d, e) => (d.abs
    ? (e.clientX / d.ptrScale - d.left) - W / 2
    : d.origin + (e.clientX - d.x0) / d.ptrScale);

  function engage(e) {
    if (!drag || drag.engaged) return;
    drag.engaged = true;
    clearTimeout(drag.hold);
    clearTimers();
    pos.stop();
    drag.origin = pos.value;
    lift.to(1, LIFT_IN);
    if (drag.abs) pos.to(shape(rawOf(drag, e)), { stiffness: 700, damping: 42, mass: 0.55 });
  }

  function onDown(e) {
    if (!pitch || drag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const abs = e.currentTarget !== hit;
    const el = abs ? e.target.closest('.hl-cell') : hit;
    if (!el) return;
    if (abs && cells.indexOf(el) < minStart) return;   // its click explains why
    el.setPointerCapture(e.pointerId);
    // Screen px per layout px, so the lens tracks the finger mid-morph (the panel is scaled).
    const r = track.getBoundingClientRect();
    const ptrScale = r.width / track.offsetWidth || 1;
    drag = {
      abs, el, id: e.pointerId, engaged: false, ptrScale,
      x0: e.clientX, y0: e.clientY, left: r.left / ptrScale, origin: pos.value,
      samples: [{ x: e.clientX / ptrScale, t: performance.now() }],
    };
    if (abs) drag.hold = setTimeout(() => engage(e), HOLD_MS);
    else engage(e);
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const now = performance.now();
    drag.samples.push({ x: e.clientX / drag.ptrScale, t: now });
    while (drag.samples.length > 2 && now - drag.samples[0].t > 100) drag.samples.shift();
    const dx = (e.clientX - drag.x0) / drag.ptrScale, dy = (e.clientY - drag.y0) / drag.ptrScale;
    if (!drag.engaged) {
      if (Math.hypot(dx, dy) > ENGAGE_MOVE) engage(e); else return;
    }
    pos.to(shape(rawOf(drag, e)), FOLLOW);
    cross.to(rubber(dy, CROSS_GIVE), { stiffness: 700, damping: 42, mass: 0.5 });
    trail.to(rubber(dx * 0.09, 5), { stiffness: 260, damping: 26, mass: 1 });
  }

  function onUp(e, cancelled) {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    clearTimeout(d.hold);
    try { d.el.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
    if (!d.engaged) return;           // a tap: the click handles it

    if (d.abs) {                      // we drove the lens: eat the cell's click
      const swallow = (ev) => ev.stopImmediatePropagation();
      track.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => track.removeEventListener('click', swallow, { capture: true }), 0);
    }
    cross.to(0, { stiffness: 480, damping: 26, mass: 0.6 });
    trail.to(0, { stiffness: 320, damping: 24, mass: 0.8 });

    const dx = (e.clientX - d.x0) / d.ptrScale, dy = (e.clientY - d.y0) / d.ptrScale;
    if (cancelled || (!d.abs && Math.hypot(dx, dy) < 8)) {
      lift.to(0, LIFT_OUT);
      pos.to(L[start], SETTLE);
      return;
    }
    // Project the release a little along the flick, then land on the nearest hour.
    const a = d.samples[0], b = d.samples[d.samples.length - 1];
    const v = b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0;
    const projected = rawOf(d, e) + v * 80;
    start = clamp(Math.round((projected - L[0]) / pitch), minStart, maxStart());
    pos.to(L[start], SETTLE);
    later(() => lift.to(0, LIFT_OUT), 200);
    commit();
  }

  for (const el of [hit, track]) {
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', (e) => onUp(e, false));
    el.addEventListener('pointercancel', (e) => onUp(e, true));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  track.addEventListener('click', (e) => {
    const i = cells.indexOf(e.target.closest('.hl-cell'));
    if (i === -1) return;
    if (i < minStart) { reject(i); return; }
    const next = clamp(i, minStart, maxStart());
    if (next === start) return;
    place(next);
    commit();
  });

  // A tap on a blocked hour: the lens flinches toward it and back.
  function reject(i) {
    clearTimers();
    const dir = i < start ? -1 : 1;
    pos.to(L[start] + dir * 7, { stiffness: 900, damping: 30, mass: 0.5 });
    later(() => pos.to(L[start], { stiffness: 500, damping: 18, mass: 0.6 }), 90);
  }

  // ── Keyboard ────────────────────────────────────────────────────────────
  hit.addEventListener('focus', () => { if (hit.matches(':focus-visible')) lens.classList.add('is-focus'); });
  hit.addEventListener('blur', () => lens.classList.remove('is-focus'));
  hit.addEventListener('keydown', (e) => {
    let next = start;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = start - 1;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = start + 1;
    else if (e.key === 'Home') next = minStart;
    else if (e.key === 'End') next = maxStart();
    else if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') {
      e.preventDefault();
      setDuration(dur + (e.key === '+' || e.key === '=' ? 1 : -1));
      stepper.set(dur);
      return;
    } else return;
    e.preventDefault();
    next = clamp(next, minStart, maxStart());
    if (next === start) return;
    place(next, { lifted: false });
    commit();
  });

  // ── Day context: today's past hours, and free-room density ──────────────
  // Recomputes which hours are blocked and where the "now" line sits, from the
  // selected date and the clock, and keeps the selection inside what's left.
  // That includes the minute tick: once an hour ends, a range starting in it
  // moves on (and shrinks if it no longer fits before 20:15), rather than
  // being left in hours that can't be picked.
  function updateDay() {
    const date = datePicker?.value;
    const now = new Date();
    const isToday = !!date && date === localDateKey(now);
    const mins = now.getHours() * 60 + now.getMinutes();
    nowSlot = isToday && mins >= FIRST && mins < at(N) ? Math.floor((mins - FIRST) / 60) : -1;

    minStart = nowSlot > 0 && blockPastHours() ? nowSlot : 0;
    cells.forEach((c, i) => c.classList.toggle('is-past', i < minStart));
    if (nowSlot >= 0) {
      nowMark.style.left = `${((mins - at(nowSlot)) / 60) * 100}%`;
      if (nowMark.parentElement !== cells[nowSlot]) cells[nowSlot].appendChild(nowMark);
    } else nowMark.remove();

    buildStepper();
    if (fitSelection()) {
      buildStepper();                 // its value, now the duration changed
      place(start, { lifted: false });
      commit();
    }
    shown = -1;
    render();
  }

  function updateDensity() {
    const date = datePicker?.value, campus = campusInput?.value;
    const shares = date && campus
      ? getFreeShareBySlot(campus, date, cells.map((_, i) => ({ from: toHHMM(at(i)), to: toHHMM(at(i + 1)) })))
      : null;
    wrapper.classList.toggle('hl--density', !!shares);
    cells.forEach((c, i) => c.style.setProperty('--free', shares ? shares[i].toFixed(3) : '0'));
  }

  datePicker?.addEventListener('change', () => { updateDay(); updateDensity(); });
  document.addEventListener('campuschange', () => requestAnimationFrame(updateDensity));
  window.addEventListener('blockpasthourschange', () => updateDay());
  window.addEventListener('timeformatchange', () => { labelCells(); shown = -1; render(); });
  // Mid-drag the gesture owns the lens; the next tick catches up.
  setInterval(() => { if (!drag) updateDay(); }, 60_000);

  // ── Boot ────────────────────────────────────────────────────────────────
  buildStepper();
  updateDay();
  // Filled in now, not on the first layout: the morph panel measures its
  // height as it opens, so the title row must already hold the real text.
  showRange(start);
  new ResizeObserver(reshow).observe(track);

  wrapper._render = reshow;
  wrapper._refreshData = () => { updateDay(); updateDensity(); };
  wrapper._retranslate = () => {
    wrapper.querySelector('.hl-label').textContent = t('timepicker.timeLabel');
    stepperMax = -1;                  // rebuild it, for its translated button names
    buildStepper();
    shown = -1;
    render();
  };
  return wrapper;
}

// ── Init ─────────────────────────────────────────────────────────────────────

let lens = null;

export function initHourLens() {
  const fromInput = document.getElementById('from-time-picker');
  const toInput = document.getElementById('to-time-picker');
  if (!fromInput || !toInput) return;

  // The old typed-entry cards stay in the DOM (time-picker.js still owns the
  // inputs' value descriptors) but have no visual role any more.
  document.querySelectorAll('.tp-card').forEach(c => { c.style.display = 'none'; });

  const container = document.querySelector('.time-pickers-container');
  if (!container) return;

  lens = buildHourLens(fromInput, toInput, {
    datePicker: document.getElementById('date-picker'),
    campusInput: document.getElementById('campus-picker'),
  });

  // Inside <time-range-chip-picker> it lives in that component's morph popup;
  // otherwise it renders inline in the container.
  const chip = document.querySelector('time-range-chip-picker');
  const mount = chip?.getMountPoint?.() ?? container;
  mount.appendChild(lens);
  chip?.setSlider?.(lens);
  requestAnimationFrame(() => lens._render());
}

// Call once occupancy data has (re)loaded: recomputes the density and the
// blocked hours for the selected campus and day.
export function refreshHourLensData() {
  lens?._refreshData();
}
