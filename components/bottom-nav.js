// Bottom pill nav — ported from the DormMate case-study's spring pill tab bar
// (Portfolio/projects/university/DormMate/dormmate_script.js), swapped from a
// sticky-top bar over a single scrolling page to a fixed-bottom bar that drives
// this app's existing show/hide tab-content panels.
//
// Per the Figma reference, "Search" is visually split off from the
// Available/Campus pair: Available+Campus share one sliding/draggable pill,
// Search is a separate standalone circular button (tap-only, own lift spring).

import { haptics, defaultPatterns } from './haptics.js';
import { t, onLanguageSwitch } from '../i18n.js';
import { DEFAULT_TAB_KEY, LAST_TAB_KEY, getStartupTabId } from './settings.js';

const GROUP_TABS = [
  { target: 'available-classrooms-container', icon: 'hgi-calendar-03', labelKey: 'tabs.available' },
  { target: 'search-classrooms-container', icon: 'hgi-university', labelKey: 'tabs.campus' },
];
const SEARCH_TARGET = 'search-placeholder-container';

const TAP_SCALE = 1.3;

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* --- Spring engine ------------------------------------------ */
const springs = new Set();
let rafId = null, lastT = 0;

function loop(t) {
  const dt = Math.min((t - lastT) / 1000, 0.064);
  lastT = t;
  let busy = false;
  for (const s of springs) if (s.step(dt)) busy = true;
  render();
  rafId = busy ? requestAnimationFrame(loop) : null;
}
function wake() {
  if (rafId == null) { lastT = performance.now(); rafId = requestAnimationFrame(loop); }
}

class Spring {
  constructor(value = 0) {
    this.value = value; this.v = 0; this.target = value;
    this.k = 300; this.c = 30; this.m = 1; this.resting = true;
    springs.add(this);
  }
  to(target, { stiffness = 300, damping = 30, mass = 1 } = {}) {
    if (reducedMotion) return this.set(target);
    this.target = target; this.k = stiffness; this.c = damping; this.m = mass;
    this.resting = false; wake();
  }
  set(value) { this.value = value; this.target = value; this.v = 0; this.resting = true; wake(); }
  stop() { this.target = this.value; this.v = 0; this.resting = true; }
  step(dt) {
    if (this.resting) return false;
    const n = Math.max(1, Math.ceil(dt / 0.004));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const F = -this.k * (this.value - this.target) - this.c * this.v;
      this.v += (F / this.m) * h;
      this.value += this.v * h;
    }
    if (Math.abs(this.v) < 0.05 && Math.abs(this.value - this.target) < 0.05) {
      this.value = this.target; this.v = 0; this.resting = true;
    }
    return !this.resting;
  }
}

/* --- DOM ------------------------------------------------------ */
const wrapper = document.getElementById('bn-wrapper');
const group = document.getElementById('bn-group');
const bar = document.getElementById('bn-bar');
const barItems = document.getElementById('bn-bar-items');
const pill = document.getElementById('bn-pill');
const pillHit = document.getElementById('bn-pill-hit');
const activeRow = document.getElementById('bn-active-row');
const searchBtn = document.getElementById('bn-search-btn');
const contentContainers = document.querySelectorAll('.tab-content');

function tabLabel(tab) { return t(tab.labelKey); }

GROUP_TABS.forEach((tab, i) => {
  const btn = document.createElement('button');
  btn.className = 'bn-tab-item';
  btn.dataset.target = tab.target;
  btn.setAttribute('role', 'tab');
  btn.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
  btn.setAttribute('aria-controls', tab.target);
  btn.innerHTML = `
    <span class="bn-tab-content">
      <i class="hgi-stroke ${tab.icon}"></i>
      <span class="bn-tab-label" data-i18n="${tab.labelKey}">${tabLabel(tab)}</span>
    </span>`;
  btn.addEventListener('click', () => { if (searchActive || i !== groupIndex) animateGroupTap(i); });
  barItems.appendChild(btn);

  const active = document.createElement('span');
  active.className = 'bn-tab-content bn-tab-active';
  active.innerHTML = `
    <i class="hgi-stroke ${tab.icon}"></i>
    <span class="bn-tab-label" data-i18n="${tab.labelKey}">${tabLabel(tab)}</span>`;
  activeRow.appendChild(active);
});

searchBtn.querySelector('.bn-tab-label').textContent = t('tabs.search');
searchBtn.addEventListener('click', () => { if (!searchActive) animateSearchTap(); });

onLanguageSwitch(() => {
  bar.querySelectorAll('.bn-tab-label').forEach((el, i) => { el.textContent = tabLabel(GROUP_TABS[i]); });
  activeRow.querySelectorAll('.bn-tab-label').forEach((el, i) => { el.textContent = tabLabel(GROUP_TABS[i]); });
  searchBtn.querySelector('.bn-tab-label').textContent = t('tabs.search');
});

/* --- State + layout -------------------------------------------- */
// Tabs hug their own content (icon + label), so unlike a uniform grid the
// pill has to slide AND resize between anchors of different widths — each
// anchor below is the pill's {x, w} for sitting exactly on top of one tab.
let groupIndex = 0;
let searchActive = false;
let didInit = false;
let itemsW = 0, itemsH = 0, pillHeight = 0;
let anchors = [];

const pillX = new Spring(0);
const pillW = new Spring(0);
const scale = new Spring(1);
const searchScale = new Spring(1);

function measureAnchors() {
  const itemsRect = barItems.getBoundingClientRect();
  // The pill is exactly as large as the item it sits on — the only inset
  // gap comes from the bar's own padding, already excluded from itemsRect.
  return Array.from(barItems.querySelectorAll('.bn-tab-item')).map(el => {
    const r = el.getBoundingClientRect();
    return { x: r.left - itemsRect.left, w: r.width };
  });
}

// Linear interpolation of the pill's width between the two anchors
// bracketing x, so it morphs smoothly while sliding/dragging between
// differently-sized tabs. clampedX intentionally ignores overshoot past
// the first/last anchor so the width just holds steady there.
function widthForX(x) {
  const n = anchors.length;
  const clampedX = Math.max(anchors[0].x, Math.min(anchors[n - 1].x, x));
  for (let i = 0; i < n - 1; i++) {
    const a = anchors[i], b = anchors[i + 1];
    if (clampedX >= a.x && clampedX <= b.x) {
      const f = (clampedX - a.x) / (b.x - a.x);
      return a.w + f * (b.w - a.w);
    }
  }
  return anchors[n - 1].w;
}

function layout() {
  const barRect = bar.getBoundingClientRect();
  const wrapRect = group.getBoundingClientRect();
  const itemsRect = barItems.getBoundingClientRect();
  itemsW = itemsRect.width;
  itemsH = itemsRect.height;
  pillHeight = itemsH;

  const left = itemsRect.left - wrapRect.left;
  const top = itemsRect.top - wrapRect.top;
  for (const el of [pill, pillHit]) {
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.style.height = itemsH + 'px';
  }
  activeRow.style.width = itemsW + 'px';

  searchBtn.style.height = barRect.height + 'px';
  searchBtn.style.width = barRect.height + 'px';

  anchors = measureAnchors();
  const a = anchors[groupIndex];
  if (!didInit) {
    pillX.set(a.x); pillW.set(a.w); didInit = true;
  } else {
    pillX.to(a.x, { stiffness: 1000, damping: 100 });
    pillW.to(a.w, { stiffness: 1000, damping: 100 });
  }
  updateMask();
}
new ResizeObserver(layout).observe(bar);
addEventListener('resize', layout);

// Cuts a pill-shaped hole out of the gray icon/label layer, matching the
// green pill's position/size exactly, so it doesn't show through the
// pill's translucent background.
function updateMask() {
  if (!itemsW || !itemsH) return;
  const w = pillW.value * scale.value;
  const h = pillHeight * scale.value;
  const r = h / 2;
  const cx = pillX.value + pillW.value / 2;
  const cy = itemsH / 2;
  const x = cx - w / 2;
  const y = cy - h / 2;
  const d = `M0 0H${itemsW}V${itemsH}H0Z M${x + r} ${y}L${x + w - r} ${y}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}L${x + r} ${y + h}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
  const clip = `path(evenodd, "${d}")`;
  barItems.style.clipPath = clip;
  barItems.style.webkitClipPath = clip;
}

function render() {
  const w = pillW.value;
  pill.style.width = w + 'px';
  pillHit.style.width = w + 'px';
  const transform = `translateX(${pillX.value}px) scale(${scale.value})`;
  pill.style.transform = transform;
  pillHit.style.transform = transform;
  activeRow.style.transform = `translateX(${-pillX.value}px)`;
  searchBtn.style.transform = `scale(${searchScale.value})`;
  updateMask();
}

/* --- Tab-content switching (mirrors the old header tabbar's behavior) ------ */
function showContent(targetId) {
  contentContainers.forEach(container => {
    if (container.id === targetId) {
      requestAnimationFrame(() => container.classList.add('visible'));
    } else {
      container.classList.remove('visible');
    }
  });
}

function persist(targetId) {
  if (localStorage.getItem(DEFAULT_TAB_KEY) === 'last') {
    localStorage.setItem(LAST_TAB_KEY, targetId);
  }
}

function setGroupActive(i) {
  groupIndex = i;
  searchActive = false;
  bar.querySelectorAll('.bn-tab-item').forEach((btn, j) => {
    btn.setAttribute('aria-selected', j === i ? 'true' : 'false');
  });
  searchBtn.setAttribute('aria-selected', 'false');
  searchBtn.classList.remove('active');
  group.classList.remove('bn-group--inactive');

  const targetId = GROUP_TABS[i].target;
  showContent(targetId);
  window.scrollTo(0, 0);
  persist(targetId);
}

function setSearchActive() {
  searchActive = true;
  bar.querySelectorAll('.bn-tab-item').forEach(btn => btn.setAttribute('aria-selected', 'false'));
  searchBtn.setAttribute('aria-selected', 'true');
  searchBtn.classList.add('active');
  group.classList.add('bn-group--inactive');

  showContent(SEARCH_TARGET);
  window.scrollTo(0, 0);
  persist(SEARCH_TARGET);
}

function animateGroupTap(i) {
  setGroupActive(i);
  haptics.trigger(defaultPatterns.light);

  const a = anchors[i];
  scale.to(TAP_SCALE, { stiffness: 500, damping: 25, mass: 0.5 });
  setTimeout(() => {
    pillX.to(a.x, { stiffness: 400, damping: 35, mass: 0.8 });
    pillW.to(a.w, { stiffness: 400, damping: 35, mass: 0.8 });
  }, 50);
  setTimeout(() => scale.to(1, { stiffness: 350, damping: 30, mass: 0.8 }), 250);
}

function animateSearchTap() {
  setSearchActive();
  haptics.trigger(defaultPatterns.light);

  searchScale.to(TAP_SCALE, { stiffness: 500, damping: 25, mass: 0.5 });
  setTimeout(() => searchScale.to(1, { stiffness: 350, damping: 30, mass: 0.8 }), 250);
}

/* --- Drag (PanResponder → Pointer Events), group pill only --------------- */
const DRAG_OVERSHOOT = 8;
let dragging = false, startX = 0, startY = 0, grantTime = 0, dragOriginX = 0;
let samples = [];

const mainDelta = (e) => e.clientX - startX;
const crossDelta = (e) => e.clientY - startY;
const mainPos = (e) => e.clientX;

const clampDragX = (x) => Math.max(anchors[0].x - DRAG_OVERSHOOT,
  Math.min(anchors[anchors.length - 1].x + DRAG_OVERSHOOT, x));

pillHit.addEventListener('pointerdown', (e) => {
  pillHit.setPointerCapture(e.pointerId);
  dragging = true;
  startX = e.clientX; startY = e.clientY;
  grantTime = performance.now();
  samples = [{ p: mainPos(e), t: grantTime }];
  pillX.stop(); pillW.stop();
  dragOriginX = pillX.value;
  scale.to(TAP_SCALE, { stiffness: 500, damping: 25, mass: 0.5 });
});

pillHit.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const now = performance.now();
  samples.push({ p: mainPos(e), t: now });
  while (samples.length > 2 && now - samples[0].t > 100) samples.shift();
  if (now - grantTime < 50) return;
  const x = clampDragX(dragOriginX + mainDelta(e));
  pillX.to(x, { stiffness: 1000, damping: 70, mass: 0.5 });
  pillW.to(widthForX(x), { stiffness: 1000, damping: 70, mass: 0.5 });
});

function release(e, terminated) {
  if (!dragging) return;
  dragging = false;
  const dMain = mainDelta(e), dCross = crossDelta(e);
  if (terminated || (Math.abs(dMain) < 8 && Math.abs(dCross) < 8)) {
    scale.to(1, { stiffness: 350, damping: 30, mass: 0.8 });
    const a = anchors[groupIndex];
    pillX.to(a.x, { stiffness: 400, damping: 38, mass: 0.8 });
    pillW.to(a.w, { stiffness: 400, damping: 38, mass: 0.8 });
    return;
  }
  const a = samples[0], b = samples[samples.length - 1];
  const v = b.t > a.t ? (b.p - a.p) / (b.t - a.t) : 0;
  const projectedX = clampDragX(dragOriginX + dMain + v * 80);
  let nearest = 0, bestDist = Infinity;
  anchors.forEach((anchor, i) => {
    const d = Math.abs(projectedX - anchor.x);
    if (d < bestDist) { bestDist = d; nearest = i; }
  });
  const target = anchors[nearest];
  pillX.to(target.x, { stiffness: 400, damping: 38, mass: 0.8 });
  pillW.to(target.w, { stiffness: 400, damping: 38, mass: 0.8 });
  setTimeout(() => scale.to(1, { stiffness: 350, damping: 30, mass: 0.8 }), 200);
  if (searchActive || nearest !== groupIndex) {
    setGroupActive(nearest);
    haptics.trigger(defaultPatterns.light);
  }
}
pillHit.addEventListener('pointerup', (e) => release(e, false));
pillHit.addEventListener('pointercancel', (e) => release(e, true));

/* --- Keyboard (cycles within the Available/Campus group) ----------------- */
bar.addEventListener('keydown', (e) => {
  const next = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
  if (next) animateGroupTap(Math.max(0, Math.min(GROUP_TABS.length - 1, groupIndex + next)));
});

/* --- Startup ---------------------------------------------------- */
{
  const startupId = getStartupTabId();
  if (startupId === SEARCH_TARGET) {
    groupIndex = 0;
    searchActive = true;
    showContent(SEARCH_TARGET);
    searchBtn.setAttribute('aria-selected', 'true');
    searchBtn.classList.add('active');
    group.classList.add('bn-group--inactive');
  } else {
    const startupIndex = GROUP_TABS.findIndex(tab => tab.target === startupId);
    groupIndex = startupIndex === -1 ? 0 : startupIndex;
    showContent(GROUP_TABS[groupIndex].target);
    bar.querySelectorAll('.bn-tab-item').forEach((btn, j) => {
      btn.setAttribute('aria-selected', j === groupIndex ? 'true' : 'false');
    });
  }
}

function setNavHeightVar() {
  document.documentElement.style.setProperty('--bottom-nav-height', `${wrapper.offsetHeight}px`);
}
new ResizeObserver(setNavHeightVar).observe(wrapper);
setNavHeightVar();

layout();
render();
