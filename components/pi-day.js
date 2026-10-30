// Pi Day decorations (March 14), lazy-loaded by utils/season.js. The normal
// accent stays; the day is in the small things:
//   - the πoliAule wordmark: the header's P becomes a π (CSS, on
//     <html data-season="piday">), and so does the tab's title (index.html's
//     inline script, which also morphs the P into it the first time the app
//     is opened that day, before first paint). This module only keeps the tab
//     title in step when the season is turned on or off from the search
//   - Aula π: room 3.1.4 at Leonardo (building 3) is the day's special room,
//     the same every year. Its name is left alone; a π tag sits next to it on
//     its card, its search row and in its page's chips, and over its building
//     on the Campus map
//   - at 15:14 (Milan), the digits of π run across the screen in one wave, once
//   - a few π and digits burst out when something gets starred
// The digits counter in the search (utils/pi.js, classroom-search-data.js)
// and the banner (utils/season.js) belong to the day too. With reduced motion
// the run and the burst stay off.

import { setDecorator, graduationShown } from '../utils/season.js';
import { setBaseTitle } from '../utils/page-focus.js';
import { milanDay } from '../utils/graduation.js';
import { piGlyphs } from '../utils/pi.js';
import { t } from '../i18n.js';
import { classroomsData as directory } from '../classroom-search-data.js';

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Room 3.1.4, in building 3 at Leonardo
const PI_ROOM_ID = 46;

// The tab's title, with and without the π
const PI_TITLE = 'πoliAule';
const USUAL_TITLE = 'PoliAule';

// ── Aula π ────────────────────────────────────────────────────────────────

let piRoom = null; // { campusId, building }, found in the directory

function room() {
  if (piRoom) return piRoom;
  for (const campus of directory ?? []) {
    for (const building of campus.buildings ?? []) {
      if ((building.classrooms ?? []).some((c) => c.id === PI_ROOM_ID)) {
        piRoom = { campusId: campus.id, building: building.name };
        return piRoom;
      }
    }
  }
  return null;
}

let roomLabel = '';

// The π itself is drawn by CSS (a mask: --pi-glyph in style.css), so it
// matches the wordmark's and never falls back to a system font
function tagEl(className = 'pi-tag') {
  const tag = document.createElement('span');
  tag.className = className;
  tag.title = roomLabel;
  tag.setAttribute('role', 'img');
  tag.setAttribute('aria-label', roomLabel);
  return tag;
}

function decorateCard(card, classroom) {
  if (classroom.id !== PI_ROOM_ID) return;
  const name = card.querySelector('.classroom-name');
  if (!name || name.querySelector('.pi-tag')) return;
  const tag = tagEl();
  // The card's own label already says everything; the tag is only for the eye
  tag.removeAttribute('role');
  tag.removeAttribute('aria-label');
  tag.setAttribute('aria-hidden', 'true');
  name.appendChild(tag);
}

function decorateSearchRow(row, item) {
  if (item.type !== 'classroom' || item.room.id !== PI_ROOM_ID) return;
  const title = row.querySelector('.search-row-title-text');
  // Inside the name, so it follows it rather than the title line's far end
  if (title && !title.querySelector('.pi-tag')) title.appendChild(tagEl());
}

// A chip among the page's seat counts (not in the title row, whose width the
// title is fitted to)
function decorateDetail(page, { classroom }) {
  if (classroom.id !== PI_ROOM_ID) return;
  const stats = page.querySelector('.detail-stats');
  if (!stats || stats.querySelector('.pi-stat')) return;
  const chip = document.createElement('div');
  chip.className = 'detail-stat lg-ring pi-stat';
  chip.innerHTML = `<span class="pi-tag pi-tag--bare" aria-hidden="true"></span><span>${t('season.piday.room')}</span>`;
  stats.prepend(chip);
}

function decorateMarker(el, { campus, building }) {
  if (el.querySelector(':scope > .pi-map-tag')) return;
  const home = room();
  if (!home || home.campusId !== campus.id || home.building !== building.name) return;
  el.prepend(tagEl('pi-map-tag'));
}

// ── 15:14 ─────────────────────────────────────────────────────────────────
// The digits of π run across the screen as one quick wave: along the whole
// width above the tab bar (a row), or down the side rail's edge from under
// the header to the bottom (a column), as many digits as fit. Once a day: when
// the clock reaches 15:14 in Milan while the app is open, or when it's opened
// within that minute. A launch (or reload) forgets it ran, which also makes it
// easy to see again.

const RUN_AT = 15 * 3600 + 14 * 60; // seconds into the Milan day
// The px each digit gets along the line, at least and at most: a row needs a
// digit's width, a column its height
const STEPS = { row: [13, 18], column: [18, 22] };
const CROSS_MS = 1700;              // the wave's front crossing the screen
const DIGIT_MS = 1200;              // each digit's own pop, hold and drift off
const EDGE = 20;                    // px kept clear at the row's ends: the screen's rounded corners

let runTimer = 0;
let runLayer = null;
let ranOn = null; // the Milan day it already ran on

const milanClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Rome', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
});

// Seconds from now to 15:14:00 in Milan (negative once it has passed)
function secondsToRun() {
  const parts = Object.fromEntries(milanClock.formatToParts(new Date()).map((p) => [p.type, Number(p.value)]));
  return RUN_AT - (parts.hour * 3600 + parts.minute * 60 + parts.second);
}

function runDigits() {
  if (reduceMotion() || document.hidden || !runLayer) return;
  const wrapper = document.querySelector('.bn-wrapper');
  const bar = wrapper?.querySelector('.lg-tabbar__bar');
  // Not under a classroom page
  if (!bar || wrapper.classList.contains('detail-open')) return;
  const rect = bar.getBoundingClientRect();
  if (!rect.width) return;
  const vertical = wrapper.classList.contains('lg-tabbar--vertical');
  // Coordinates are the layer's own: it stops short of the safe areas
  const layer = runLayer.getBoundingClientRect();

  // The line the digits sit on: from where to where, and at which cross
  // offset. A row runs the layer's width above the bar; a column starts under
  // the header (never over its title or buttons) and ends at the layer's end.
  let from, to, cross;
  if (vertical) {
    const headerBottom = document.querySelector('.header')?.getBoundingClientRect().bottom ?? 0;
    from = Math.max(rect.top, headerBottom) + 8 - layer.top;
    to = layer.height - 8;
    cross = rect.right + 6 - layer.left;
  } else {
    from = EDGE;
    to = layer.width - EDGE;
    cross = rect.top - 24 - layer.top;
  }
  const length = to - from;
  const [minStep, maxStep] = STEPS[vertical ? 'column' : 'row'];
  const glyphs = piGlyphs(Math.floor(length / minStep));
  if (glyphs.length < 8) return;
  // Spread over the whole line, up to a comfortable spacing
  const step = Math.min(maxStep, length / glyphs.length);
  const start = from + (length - step * glyphs.length) / 2;
  const stagger = CROSS_MS / glyphs.length;
  ranOn = milanDay();

  [...glyphs].forEach((glyph, i) => {
    const el = document.createElement('span');
    el.className = 'pi-digit';
    el.textContent = glyph;
    el.style.width = `${step}px`;
    const along = start + i * step;
    // Placed with left / top: a `scale` animation would scale a transform's offset too
    el.style.left = `${vertical ? cross : along}px`;
    el.style.top = `${vertical ? along : cross}px`;
    runLayer.appendChild(el);
    // Each pops in with a little hop, holds a moment and drifts off; the
    // delays make the wave
    const anim = el.animate([
      { opacity: 0, translate: '0 8px', scale: 0.4 },
      { opacity: 1, translate: '0 -5px', scale: 1.15, offset: 0.12 },
      { opacity: 1, translate: '0 0', scale: 1, offset: 0.22 },
      { opacity: 1, translate: '0 0', scale: 1, offset: 0.55 },
      { opacity: 0, translate: '0 -12px', scale: 0.9 },
    ], { duration: DIGIT_MS, delay: i * stagger, easing: 'ease-out', fill: 'both' });
    anim.onfinish = anim.oncancel = () => el.remove();
  });
}

function scheduleRun() {
  clearTimeout(runTimer);
  if (ranOn === milanDay()) return;
  const left = secondsToRun();
  // Past the minute it lasts
  if (left < -59) return;
  // Within it: now. Before it: when it starts. The clock is read again when
  // the app comes back to the foreground, as a timer that long may have slept
  if (left <= 0) runWhenSettled();
  else runTimer = setTimeout(runWhenSettled, left * 1000);
}

// A launch inside the minute starts while the splash is still up and the
// stylesheet and the tab bar are settling, so what it measures isn't there
// yet: it waits for them (a few seconds at most)
function runWhenSettled(tries = 0) {
  const settled = document.documentElement.classList.contains('css-ready') && !document.querySelector('.splash-overlay');
  if (!settled && tries < 40) {
    runTimer = setTimeout(() => runWhenSettled(tries + 1), 250);
    return;
  }
  runDigits();
}

const onVisible = () => { if (!document.hidden) scheduleRun(); };

// ── π when something gets starred ─────────────────────────────────────────

let burst = null;       // { fire, shapes }
let burstCanvas = null;
let lastTap = null;     // { x, y, at }

const rememberTap = (e) => { lastTap = { x: e.clientX, y: e.clientY, at: performance.now() }; };

// The same glyph as the wordmark's (--pi-glyph in style.css), as a path in a
// 64 x 62 box, for confetti
const PI_PATH = 'M8.75 1.5H55.25a5.75 5.75 0 0 1 0 11.5H8.75a5.75 5.75 0 0 1 0-11.5zM14 7H25.5V55.25a5.75 5.75 0 0 1-11.5 0zM37.5 7H49V44c0 4.6 1.8 6.7 4.7 6.7 1.5 0 2.7-.5 3.9-1.8l3.9 5.3C58.9 59.6 55.8 61 52 61c-9.4 0-14.5-5.3-14.5-15z';
const BURST_COLORS = ['#4f6df5', '#e8590c', '#12a150', '#d6409f', '#f5b301'];

async function burstPi() {
  if (reduceMotion()) return;
  if (!burst) {
    const { default: confetti } = await import('canvas-confetti');
    burstCanvas = document.createElement('canvas');
    burstCanvas.className = 'pi-fx';
    document.body.appendChild(burstCanvas);
    // π as a path, painted in each piece's own colour; a few digits as text
    let shapes = ['circle'];
    try {
      const s = 10 / 64;
      const pi = confetti.shapeFromPath({ path: PI_PATH, matrix: [s, 0, 0, s, -32 * s, -31 * s] });
      const digits = [...'14159'].map((text, i) => confetti.shapeFromText({
        text, scalar: 2, color: BURST_COLORS[i % BURST_COLORS.length], fontFamily: '"Nunito", sans-serif',
      }));
      shapes = [pi, pi, pi, ...digits];
    } catch { /* no path or text shapes: plain dots */ }
    burst = { fire: confetti.create(burstCanvas, { resize: true }), shapes };
  }
  // From the star that was just tapped, or the top of the screen
  const tap = lastTap && performance.now() - lastTap.at < 1500 ? lastTap : { x: innerWidth / 2, y: innerHeight * 0.2 };
  burst.fire({
    // Down from a star up in the header, up from one further down
    angle: tap.y < innerHeight * 0.3 ? 270 : 90,
    particleCount: 14, spread: 70, startVelocity: 20, gravity: 0.9, ticks: 140, scalar: 1.7, flat: true,
    shapes: burst.shapes, colors: BURST_COLORS,
    origin: { x: tap.x / burstCanvas.clientWidth, y: Math.min(1, tap.y / burstCanvas.clientHeight) },
    disableForReducedMotion: true,
  });
}

const onFavouritesChanged = (e) => {
  // On a graduation day its own burst takes this one's place (components/graduation.js)
  if (e.detail?.added != null && !graduationShown()) burstPi();
};

// ── Lifecycle ─────────────────────────────────────────────────────────────

export function start() {
  roomLabel = t('season.piday.room');
  setDecorator('card', decorateCard);
  setDecorator('marker', decorateMarker);
  setDecorator('detail', decorateDetail);
  setDecorator('searchRow', decorateSearchRow);
  // Whatever was built before this module loaded
  document.querySelectorAll(`.classroom-card[data-open-classroom="${PI_ROOM_ID}"]`).forEach((card) => {
    decorateCard(card, { id: PI_ROOM_ID });
  });
  document.querySelectorAll('.map-pin[data-building][data-campus]').forEach((el) => {
    decorateMarker(el, { campus: { id: el.dataset.campus }, building: { name: el.dataset.building } });
  });

  // index.html's inline script set it on a launch that began on Pi Day; this
  // is for the season being turned on later
  setBaseTitle(PI_TITLE);

  runLayer = document.createElement('div');
  runLayer.className = 'pi-sky';
  runLayer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(runLayer);
  scheduleRun();
  document.addEventListener('visibilitychange', onVisible);

  window.addEventListener('pointerdown', rememberTap, { capture: true, passive: true });
  window.addEventListener('favourites-changed', onFavouritesChanged);
}

export function stop() {
  setBaseTitle(USUAL_TITLE);
  clearTimeout(runTimer);
  runLayer?.remove();
  runLayer = null;
  burstCanvas?.remove();
  burstCanvas = null;
  burst = null;
  document.querySelectorAll('.pi-tag, .pi-stat, .pi-map-tag').forEach((el) => el.remove());
  document.removeEventListener('visibilitychange', onVisible);
  window.removeEventListener('pointerdown', rememberTap, { capture: true });
  window.removeEventListener('favourites-changed', onFavouritesChanged);
}
