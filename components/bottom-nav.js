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
import { Spring, onSpringFrame } from '../utils/spring.js';

const GROUP_TABS = [
  { target: 'available-classrooms-container', icon: 'hgi-calendar-03', labelKey: 'tabs.available' },
  { target: 'search-classrooms-container', icon: 'hgi-university', labelKey: 'tabs.campus' },
];
const SEARCH_TARGET = 'search-placeholder-container';

const TAP_SCALE = 1.3;

// Desktop swaps the bar from a horizontal bottom bar to a vertical rail
// pinned top-left (see bottom-nav.css's matching breakpoint) — all the pill
// sliding/morphing math below is written generically against a "main axis"
// (x + width when horizontal, y + height when vertical) and a fixed "cross
// axis" (the bar's own thickness), so it works unchanged in both.
const desktopMQ = matchMedia('(min-width: 600px)');
const isVertical = () => desktopMQ.matches;

onSpringFrame(render);

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
let itemsW = 0, itemsH = 0, pillCross = 0;
let anchors = [];

const pillPos = new Spring(0);
const pillMain = new Spring(0);
const scale = new Spring(1);
const searchScale = new Spring(1);

function measureAnchors() {
  const itemsRect = barItems.getBoundingClientRect();
  const vertical = isVertical();
  // The pill is exactly as large as the item it sits on — the only inset
  // gap comes from the bar's own padding, already excluded from itemsRect.
  return Array.from(barItems.querySelectorAll('.bn-tab-item')).map(el => {
    const r = el.getBoundingClientRect();
    return vertical
      ? { pos: r.top - itemsRect.top, size: r.height }
      : { pos: r.left - itemsRect.left, size: r.width };
  });
}

// Linear interpolation of the pill's main-axis size between the two anchors
// bracketing pos, so it morphs smoothly while sliding/dragging between
// differently-sized tabs. clampedPos intentionally ignores overshoot past
// the first/last anchor so the size just holds steady there.
function sizeForPos(pos) {
  const n = anchors.length;
  const clampedPos = Math.max(anchors[0].pos, Math.min(anchors[n - 1].pos, pos));
  for (let i = 0; i < n - 1; i++) {
    const a = anchors[i], b = anchors[i + 1];
    if (clampedPos >= a.pos && clampedPos <= b.pos) {
      const f = (clampedPos - a.pos) / (b.pos - a.pos);
      return a.size + f * (b.size - a.size);
    }
  }
  return anchors[n - 1].size;
}

function layout() {
  const vertical = isVertical();
  const barRect = bar.getBoundingClientRect();
  const wrapRect = group.getBoundingClientRect();
  const itemsRect = barItems.getBoundingClientRect();
  itemsW = itemsRect.width;
  itemsH = itemsRect.height;
  pillCross = vertical ? itemsW : itemsH;

  const left = itemsRect.left - wrapRect.left;
  const top = itemsRect.top - wrapRect.top;
  for (const el of [pill, pillHit]) {
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    if (vertical) {
      el.style.width = itemsW + 'px';
      el.style.height = '';
    } else {
      el.style.height = itemsH + 'px';
      el.style.width = '';
    }
  }
  if (vertical) {
    activeRow.style.height = itemsH + 'px';
    activeRow.style.width = '';
  } else {
    activeRow.style.width = itemsW + 'px';
    activeRow.style.height = '';
  }

  // The search button is always a circle matching the bar's own thickness
  // (cross axis) — its height on mobile, its width on the desktop rail.
  const diameter = vertical ? barRect.width : barRect.height;
  searchBtn.style.height = diameter + 'px';
  searchBtn.style.width = diameter + 'px';

  anchors = measureAnchors();
  const a = anchors[groupIndex];
  if (!didInit) {
    pillPos.set(a.pos); pillMain.set(a.size); didInit = true;
  } else {
    pillPos.to(a.pos, { stiffness: 1000, damping: 100 });
    pillMain.to(a.size, { stiffness: 1000, damping: 100 });
  }
  updateMask();
}
new ResizeObserver(layout).observe(bar);
addEventListener('resize', layout);
// Crossing the breakpoint changes what pillPos/pillMain's stored numbers
// mean (x/width vs y/height) — force the next layout() to snap instead of
// spring-animating from a now-meaningless stale value.
desktopMQ.addEventListener('change', () => { didInit = false; });

// Cuts a pill-shaped hole out of the gray icon/label layer, matching the
// green pill's position/size exactly, so it doesn't show through the
// pill's translucent background.
function updateMask() {
  if (!itemsW || !itemsH) return;
  const vertical = isVertical();
  const mainVal = pillMain.value * scale.value;
  const crossVal = pillCross * scale.value;
  const w = vertical ? crossVal : mainVal;
  const h = vertical ? mainVal : crossVal;
  const r = Math.min(w, h) / 2;
  const cx = vertical ? itemsW / 2 : pillPos.value + pillMain.value / 2;
  const cy = vertical ? pillPos.value + pillMain.value / 2 : itemsH / 2;
  const x = cx - w / 2;
  const y = cy - h / 2;
  const d = `M0 0H${itemsW}V${itemsH}H0Z ` +
    `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
  const clip = `path(evenodd, "${d}")`;
  barItems.style.clipPath = clip;
  barItems.style.webkitClipPath = clip;
}

function render() {
  const vertical = isVertical();
  const size = pillMain.value;
  if (vertical) {
    pill.style.height = size + 'px';
    pillHit.style.height = size + 'px';
  } else {
    pill.style.width = size + 'px';
    pillHit.style.width = size + 'px';
  }
  const transform = vertical
    ? `translateY(${pillPos.value}px) scale(${scale.value})`
    : `translateX(${pillPos.value}px) scale(${scale.value})`;
  pill.style.transform = transform;
  pillHit.style.transform = transform;
  // Full glass look only while actually lifted (mid tap or drag spring);
  // flat color at rest. Checking scale.value directly (rather than
  // scale.resting) also covers reduced-motion, where to() snaps the value
  // straight to its target instead of animating toward it.
  pill.classList.toggle('bn-pill--lifted', scale.value > 1.001);
  activeRow.style.transform = vertical
    ? `translateY(${-pillPos.value}px)`
    : `translateX(${-pillPos.value}px)`;
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
    pillPos.to(a.pos, { stiffness: 400, damping: 35, mass: 0.8 });
    pillMain.to(a.size, { stiffness: 400, damping: 35, mass: 0.8 });
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
let dragging = false, startX = 0, startY = 0, grantTime = 0, dragOriginPos = 0;
let samples = [];

// "Main" tracks whichever screen axis the bar currently slides along
// (x/horizontal on mobile, y/vertical on desktop); "cross" is the other one,
// used only to tell a tap from a drag.
const mainDelta = (e) => isVertical() ? e.clientY - startY : e.clientX - startX;
const crossDelta = (e) => isVertical() ? e.clientX - startX : e.clientY - startY;
const mainPos = (e) => isVertical() ? e.clientY : e.clientX;

const clampDragPos = (pos) => Math.max(anchors[0].pos - DRAG_OVERSHOOT,
  Math.min(anchors[anchors.length - 1].pos + DRAG_OVERSHOOT, pos));

pillHit.addEventListener('pointerdown', (e) => {
  pillHit.setPointerCapture(e.pointerId);
  dragging = true;
  startX = e.clientX; startY = e.clientY;
  grantTime = performance.now();
  samples = [{ p: mainPos(e), t: grantTime }];
  pillPos.stop(); pillMain.stop();
  dragOriginPos = pillPos.value;
  scale.to(TAP_SCALE, { stiffness: 500, damping: 25, mass: 0.5 });
});

pillHit.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const now = performance.now();
  samples.push({ p: mainPos(e), t: now });
  while (samples.length > 2 && now - samples[0].t > 100) samples.shift();
  if (now - grantTime < 50) return;
  const pos = clampDragPos(dragOriginPos + mainDelta(e));
  pillPos.to(pos, { stiffness: 1000, damping: 70, mass: 0.5 });
  pillMain.to(sizeForPos(pos), { stiffness: 1000, damping: 70, mass: 0.5 });
});

function release(e, terminated) {
  if (!dragging) return;
  dragging = false;
  const dMain = mainDelta(e), dCross = crossDelta(e);
  if (terminated || (Math.abs(dMain) < 8 && Math.abs(dCross) < 8)) {
    scale.to(1, { stiffness: 350, damping: 30, mass: 0.8 });
    const a = anchors[groupIndex];
    pillPos.to(a.pos, { stiffness: 400, damping: 38, mass: 0.8 });
    pillMain.to(a.size, { stiffness: 400, damping: 38, mass: 0.8 });
    return;
  }
  const a = samples[0], b = samples[samples.length - 1];
  const v = b.t > a.t ? (b.p - a.p) / (b.t - a.t) : 0;
  const projectedPos = clampDragPos(dragOriginPos + dMain + v * 80);
  let nearest = 0, bestDist = Infinity;
  anchors.forEach((anchor, i) => {
    const d = Math.abs(projectedPos - anchor.pos);
    if (d < bestDist) { bestDist = d; nearest = i; }
  });
  const target = anchors[nearest];
  pillPos.to(target.pos, { stiffness: 400, damping: 38, mass: 0.8 });
  pillMain.to(target.size, { stiffness: 400, damping: 38, mass: 0.8 });
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
  // Both axes' arrow keys work regardless of orientation, since either could
  // be plausible muscle memory depending on how the bar currently reads.
  const forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
  const backward = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
  const next = forward ? 1 : backward ? -1 : 0;
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

function setNavSizeVars() {
  document.documentElement.style.setProperty('--bottom-nav-height', `${wrapper.offsetHeight}px`);
  document.documentElement.style.setProperty('--side-nav-width', `${wrapper.offsetWidth}px`);
}
new ResizeObserver(setNavSizeVars).observe(wrapper);
setNavSizeVars();

layout();
render();
