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
  { target: 'available-classrooms-container', icon: 'event_available', labelKey: 'tabs.available' },
  { target: 'search-classrooms-container', icon: 'apartment', labelKey: 'tabs.campus' },
];
const SEARCH_TARGET = 'search-placeholder-container';

const PILL_INSET = 4;
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
      <span class="material-symbols-outlined">${tab.icon}</span>
      <span class="bn-tab-label" data-i18n="${tab.labelKey}">${tabLabel(tab)}</span>
    </span>`;
  btn.addEventListener('click', () => { if (searchActive || i !== groupIndex) animateGroupTap(i); });
  bar.appendChild(btn);

  const active = document.createElement('span');
  active.className = 'bn-tab-content bn-tab-active';
  active.innerHTML = `
    <span class="material-symbols-outlined bn-filled">${tab.icon}</span>
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
let groupIndex = 0;
let searchActive = false;
let itemSize = 0;
let didInit = false;

const slide = new Spring(0);
const scale = new Spring(1);
const searchScale = new Spring(1);

function layout() {
  const barRect = bar.getBoundingClientRect();
  const wrapRect = group.getBoundingClientRect();
  const n = GROUP_TABS.length;
  const left = barRect.left - wrapRect.left;
  const top = barRect.top - wrapRect.top;

  itemSize = barRect.width / n;
  for (const el of [pill, pillHit]) {
    el.style.left = left + 'px';
    el.style.top = (top + 4) + 'px';
    el.style.width = (itemSize - PILL_INSET * 2) + 'px';
    el.style.height = (barRect.height - 8) + 'px';
  }
  activeRow.style.width = barRect.width + 'px';
  activeRow.querySelectorAll('.bn-tab-active').forEach(el => {
    el.style.width = itemSize + 'px';
  });

  const target = groupIndex * itemSize + PILL_INSET;
  if (!didInit) { slide.set(target); didInit = true; }
  else slide.to(target, { stiffness: 1000, damping: 100 });
}
new ResizeObserver(layout).observe(bar);
addEventListener('resize', layout);

function render() {
  const transform = `translateX(${slide.value}px) scale(${scale.value})`;
  pill.style.transform = transform;
  pillHit.style.transform = transform;
  activeRow.style.transform = `translateX(${-slide.value}px)`;
  searchBtn.style.transform = `scale(${searchScale.value})`;
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

  const to = i * itemSize + PILL_INSET;
  scale.to(TAP_SCALE, { stiffness: 500, damping: 25, mass: 0.5 });
  setTimeout(() => slide.to(to, { stiffness: 400, damping: 35, mass: 0.8 }), 50);
  setTimeout(() => scale.to(1, { stiffness: 350, damping: 30, mass: 0.8 }), 250);
}

function animateSearchTap() {
  setSearchActive();
  haptics.trigger(defaultPatterns.light);

  searchScale.to(TAP_SCALE, { stiffness: 500, damping: 25, mass: 0.5 });
  setTimeout(() => searchScale.to(1, { stiffness: 350, damping: 30, mass: 0.8 }), 250);
}

/* --- Drag (PanResponder → Pointer Events), group pill only --------------- */
let dragging = false, startX = 0, startY = 0, grantTime = 0, dragOrigin = 0;
let samples = [];

const mainDelta = (e) => e.clientX - startX;
const crossDelta = (e) => e.clientY - startY;
const mainPos = (e) => e.clientX;

pillHit.addEventListener('pointerdown', (e) => {
  pillHit.setPointerCapture(e.pointerId);
  dragging = true;
  startX = e.clientX; startY = e.clientY;
  grantTime = performance.now();
  samples = [{ p: mainPos(e), t: grantTime }];
  slide.stop();
  dragOrigin = slide.value;
  scale.to(TAP_SCALE, { stiffness: 500, damping: 25, mass: 0.5 });
});

pillHit.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const now = performance.now();
  samples.push({ p: mainPos(e), t: now });
  while (samples.length > 2 && now - samples[0].t > 100) samples.shift();
  if (now - grantTime < 50) return;
  const max = (GROUP_TABS.length - 1) * itemSize + PILL_INSET + 8;
  const target = Math.max(PILL_INSET - 8, Math.min(max, dragOrigin + mainDelta(e)));
  slide.to(target, { stiffness: 1000, damping: 70, mass: 0.5 });
});

function release(e, terminated) {
  if (!dragging) return;
  dragging = false;
  const dMain = mainDelta(e), dCross = crossDelta(e);
  if (terminated || (Math.abs(dMain) < 8 && Math.abs(dCross) < 8)) {
    scale.to(1, { stiffness: 350, damping: 30, mass: 0.8 });
    slide.to(groupIndex * itemSize + PILL_INSET, { stiffness: 400, damping: 38, mass: 0.8 });
    return;
  }
  const a = samples[0], b = samples[samples.length - 1];
  const v = b.t > a.t ? (b.p - a.p) / (b.t - a.t) : 0;
  const projected = dragOrigin + dMain + v * 80;
  const nearest = Math.max(0, Math.min(GROUP_TABS.length - 1,
    Math.round((projected - PILL_INSET) / itemSize)));
  slide.to(nearest * itemSize + PILL_INSET, { stiffness: 400, damping: 38, mass: 0.8 });
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
