// Graduation days, lazy-loaded by utils/season.js while today is one at the
// campus picked in the app (utils/graduation.js). It's a layer on top of the
// season, if any: at Christmas the snow and the decorations stay, and this
// takes over the accent (navy, like the suits on the day; plain CSS on
// <html data-graduation>), the banner, the bursts when something is starred
// and the spot under the data status button. On its own it's all there is.
//   - colourful confetti drifting down from the top, and now and then a burst
//     from either side, on one canvas drawn by canvas-confetti off the main
//     thread where the browser allows (OffscreenCanvas in a worker)
//   - a burst of confetti and laurel leaves when something gets starred
//   - a laurel wreath (corona d'alloro, with its red ribbon) hanging from the
//     data status button, in place of the season's mistletoe or spider
//   - the logo crowned with laurel, holding its diploma, in the header and
//     the tab icon (and as the Info page's hero), over the season's own
//   - the laurel as the campus chips' icon (and the banner's)
//   - confetti scattered over the ground of the campus on the Campus map
// With reduced motion nothing falls: the wreath, the icons and the confetti
// on the map stay.

import { setDecorator } from '../utils/season.js';
import { t } from '../i18n.js';
import { classroomsData as directory } from '../classroom-search-data.js';

const OWNER = 'graduation';
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const rand = (a, b) => a + Math.random() * (b - a);

const COLOURS = ['#e63946', '#f4a261', '#ffd23f', '#2a9d8f', '#3a86ff', '#8338ec', '#ff5fa2', '#06d6a0', '#ffffff'];
const LEAF_GREENS = ['#5f8f3e', '#4a7a30', '#7aa64f'];

let info = null;        // what the campus celebrates today (utils/graduation.js)
let campusId = null;
let listeners = new AbortController();

// ── Banner ────────────────────────────────────────────────────────────────

function campusName(id) {
  return directory?.find((c) => c.id === id)?.name ?? '';
}

// The banner's strings for today (utils/season.js shows them). The Design
// School's proclamation-only days (Bovisa) get their own; otherwise the
// levels graduating, with Design's defences when they're on the same day.
export function bannerText() {
  const name = campusName(campusId);
  if (!info.main) {
    return {
      title: { text: t('season.graduation.designTitle') },
      body: { text: t('season.graduation.designText').replace('{campus}', name) },
    };
  }
  const levels = info.levels.includes('magistrale') || info.levels.includes('ciclo_unico')
    ? (info.levels.includes('ciclo_unico') ? 'magistraleCicloUnico' : 'magistrale')
    : 'triennale';
  let what = t(`season.graduation.levels.${levels}`);
  if (info.design) what = t('season.graduation.withDesign').replace('{levels}', what);
  return {
    title: { text: t('season.graduation.bannerTitle') },
    body: { text: t('season.graduation.bannerText').replace('{campus}', name).replace('{levels}', what) },
  };
}

// ── Laurel ────────────────────────────────────────────────────────────────

// A laurel wreath of `size` px: two branches meeting at the top, leaves in
// pairs along them, tied at the bottom with a red ribbon (the corona d'alloro
// handed to Italian graduates)
function wreathSvg(size) {
  const c = size / 2;
  const r = size * 0.34;
  const L = size * 0.19;
  const w = L * 0.34;
  const leaf = `M0 0Q${L / 2} ${-w} ${L} 0Q${L / 2} ${w} 0 0Z`;
  const deg = Math.PI / 180;
  let stems = '';
  let leaves = '';
  for (const side of [-1, 1]) {
    // From the bottom (90°) round the side, up to near the top
    const from = 90 + side * 22;
    const to = 90 + side * 158;
    const p = (a) => [c + r * Math.cos(a * deg), c + r * Math.sin(a * deg)];
    const [x0, y0] = p(from);
    const [x1, y1] = p(to);
    stems += `<path class="gr-laurel-stem" d="M${x0.toFixed(1)} ${y0.toFixed(1)}A${r} ${r} 0 0 ${side > 0 ? 1 : 0} ${x1.toFixed(1)} ${y1.toFixed(1)}"/>`;
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = from + ((to - from) * (i + 0.5)) / n;
      const [x, y] = p(a);
      // Pointing on along the branch, one leaf leaning out, one in
      const along = a + side * 90;
      for (const lean of [-1, 1]) {
        const tone = (i + (lean > 0 ? 1 : 0)) % 3;
        leaves += `<path class="gr-laurel-leaf gr-laurel-leaf--${tone}" d="${leaf}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(along + lean * 32 * side).toFixed(0)})"/>`;
      }
    }
    // One leaf to finish each branch at the top
    const [tx, ty] = p(to);
    leaves += `<path class="gr-laurel-leaf gr-laurel-leaf--0" d="${leaf}" transform="translate(${tx.toFixed(1)} ${ty.toFixed(1)}) rotate(${(to + side * 90).toFixed(0)})"/>`;
  }
  // The ribbon: two tails and a knot where the branches meet
  const ky = c + r;
  const s = size / 40;
  const ribbon =
    `<path class="gr-ribbon" d="M${c} ${ky}l${-5 * s} ${9 * s}l${2.5 * s} ${-0.5 * s}l${1 * s} ${2.5 * s}Z"/>` +
    `<path class="gr-ribbon" d="M${c} ${ky}l${5 * s} ${9 * s}l${-2.5 * s} ${-0.5 * s}l${-1 * s} ${2.5 * s}Z"/>` +
    `<path class="gr-ribbon" d="M${c} ${ky}c${-3 * s} ${-3 * s} ${-7 * s} ${-2 * s} ${-6 * s} ${1 * s}c${1 * s} ${2.5 * s} ${4 * s} ${1 * s} ${6 * s} ${-1 * s}Z"/>` +
    `<path class="gr-ribbon" d="M${c} ${ky}c${3 * s} ${-3 * s} ${7 * s} ${-2 * s} ${6 * s} ${1 * s}c${-1 * s} ${2.5 * s} ${-4 * s} ${1 * s} ${-6 * s} ${-1 * s}Z"/>` +
    `<circle class="gr-ribbon-knot" cx="${c}" cy="${ky}" r="${1.8 * s}"/>`;
  return `<svg width="${size}" height="${size + 4 * s}" viewBox="0 0 ${size} ${size + 4 * s}" aria-hidden="true">${stems}${leaves}${ribbon}</svg>`;
}

// The wreath hangs on a red ribbon from behind the data status button, like
// Christmas's mistletoe (hidden while this is on, see style.css); a tap gives
// it a swing
let wreath = null;
let wreathResize = null;

function placeWreath() {
  const btn = document.getElementById('data-fetch-btn');
  if (!wreath || !btn) return;
  wreath.style.left = `${btn.offsetLeft + btn.offsetWidth / 2}px`;
  wreath.style.top = `${btn.offsetTop + btn.offsetHeight / 2}px`;
}

function startWreath() {
  const btn = document.getElementById('data-fetch-btn');
  const host = btn?.offsetParent;
  if (!host) return;
  wreath = document.createElement('div');
  wreath.className = 'gr-wreath';
  wreath.innerHTML = `<div class="gr-wreath-sway"><div class="gr-wreath-line"></div>` +
    `<button type="button" class="gr-wreath-crown" tabindex="-1" aria-hidden="true">${wreathSvg(34)}</button></div>`;
  wreath.querySelector('.gr-wreath-crown').addEventListener('click', (e) => {
    e.stopPropagation();
    if (reduceMotion()) return;
    const sway = wreath.querySelector('.gr-wreath-sway');
    sway.classList.remove('gr-wreath-sway--swing');
    void sway.offsetWidth;
    sway.classList.add('gr-wreath-sway--swing');
  });
  host.appendChild(wreath);
  placeWreath();
  wreathResize = new ResizeObserver(placeWreath);
  wreathResize.observe(host);
}

// The campus chips (the Available tab's and the Campus sheet's) show the
// laurel in place of their university icon
let chipIcons = [];

function startChipIcon() {
  chipIcons = [...document.querySelectorAll('campus-chip-picker .lg-chip i.hgi-university, campus-sheet-picker .lg-chip i.hgi-university')];
  for (const icon of chipIcons) {
    icon.classList.replace('hgi-university', 'hgi-laurel-wreath-01');
    icon.classList.add('gr-chip-icon');
  }
}

function stopChipIcon() {
  for (const icon of chipIcons) {
    icon.classList.replace('hgi-laurel-wreath-01', 'hgi-university');
    icon.classList.remove('gr-chip-icon');
  }
  chipIcons = [];
}

// ── Confetti over the app ─────────────────────────────────────────────────

let confettiLib = null;
let fx = null;          // { fire, leaf }
let fxCanvas = null;
let dropTimer = 0;
let burstTimer = 0;
let lastTap = null;     // { x, y, at }

const rememberTap = (e) => { lastTap = { x: e.clientX, y: e.clientY, at: performance.now() }; };

async function confettiFx() {
  if (fx) return fx;
  if (!confettiLib) ({ default: confettiLib } = await import('canvas-confetti'));
  if (!info) return null;   // stopped while loading
  if (fx) return fx;
  fxCanvas = document.createElement('canvas');
  fxCanvas.className = 'gr-fx';
  fxCanvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(fxCanvas);
  let leaf = null;
  try {
    leaf = confettiLib.shapeFromPath({ path: 'M0 0Q5 -2.2 10 0Q5 2.2 0 0Z' });
  } catch { /* no Path2D: plain confetti */ }
  // useWorker: drawn on an OffscreenCanvas in a worker where there is one,
  // so a busy main thread never stutters it (and it never stutters that)
  fx = { fire: confettiLib.create(fxCanvas, { resize: true, useWorker: true }), leaf };
  return fx;
}

const running = () => !!info && !document.hidden && !reduceMotion();

// A piece every ~quarter second from somewhere along the top, drifting down
// and fading out on its way: a few dozen on screen at a time
function scheduleDrop() {
  clearTimeout(dropTimer);
  dropTimer = setTimeout(async () => {
    if (running()) {
      const c = await confettiFx();
      if (c && info) {
        const h = fxCanvas.clientHeight || innerHeight;
        const gravity = rand(0.32, 0.5);
        c.fire({
          particleCount: 1,
          angle: 270,
          spread: 40,
          startVelocity: rand(1, 4),
          gravity,
          decay: 0.95,
          drift: rand(-0.5, 0.5),
          // Long enough to reach the bottom (canvas-confetti falls 3 * gravity
          // px a frame once the launch speed has died down), fading all the way
          ticks: Math.round((h / (3 * gravity)) * 1.05),
          scalar: rand(0.75, 1.05),
          colors: [COLOURS[Math.floor(Math.random() * COLOURS.length)]],
          origin: { x: Math.random(), y: -0.03 },
          disableForReducedMotion: true,
        });
      }
    }
    if (info) scheduleDrop();
  }, rand(180, 320));
}

// Now and then a burst from the left or right edge, a third of the way up
function scheduleSideBurst(first = false) {
  clearTimeout(burstTimer);
  burstTimer = setTimeout(async () => {
    if (running()) {
      const c = await confettiFx();
      if (c && info) {
        const left = Math.random() < 0.5;
        c.fire({
          particleCount: 45,
          angle: left ? 60 : 120,
          spread: 50,
          startVelocity: rand(40, 55),
          gravity: 0.9,
          ticks: 260,
          scalar: 0.9,
          colors: COLOURS,
          origin: { x: left ? -0.02 : 1.02, y: rand(0.55, 0.75) },
          disableForReducedMotion: true,
        });
      }
    }
    if (info) scheduleSideBurst();
  }, first ? rand(4000, 7000) : rand(16000, 30000));
}

// Starred: confetti and laurel leaves from the star that was just tapped (in
// place of the season's own burst, which checks graduationShown())
async function starBurst() {
  if (reduceMotion()) return;
  const c = await confettiFx();
  if (!c || !info) return;
  const tap = lastTap && performance.now() - lastTap.at < 1500 ? lastTap : { x: innerWidth / 2, y: innerHeight * 0.2 };
  const origin = { x: tap.x / (fxCanvas.clientWidth || innerWidth), y: Math.min(1, tap.y / (fxCanvas.clientHeight || innerHeight)) };
  c.fire({
    particleCount: 55, spread: 80, startVelocity: 30, ticks: 170, scalar: 0.9,
    colors: COLOURS, origin, disableForReducedMotion: true,
  });
  if (c.leaf) {
    c.fire({
      particleCount: 14, spread: 70, startVelocity: 24, ticks: 190, scalar: 1.6, flat: false,
      shapes: [c.leaf], colors: LEAF_GREENS, origin, disableForReducedMotion: true,
    });
  }
}

const onFavouritesChanged = (e) => {
  if (e.detail?.added != null) starBurst();
};

const onVisibility = () => {
  if (!document.hidden && info) {
    scheduleDrop();
    scheduleSideBurst(true);
  }
};

// ── Confetti on the Campus map ────────────────────────────────────────────
// Paper strips scattered over the ground of the whole campus, the morning
// after: a plain fill layer of tiny rotated rectangles under the 3D
// buildings and trees (which hide the ones that land beneath them). Nothing
// moves, so it costs nothing while the map is still and next to nothing
// when it pans. Same pieces every time for a campus (seeded), faded in from
// campus zoom like the seasons' 3D decorations.

const MAP_LAYER = 'gr-confetti';
const PIECE_LENGTH = 1.6;   // metres: exaggerated, or they'd be specks
const PIECE_WIDTH = 0.7;
const MARGIN = 60;          // metres beyond the outermost buildings
const M_PER_DEG = 111320;

let mapRef = null;

function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  let x = h >>> 0 || 1;
  return () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

function confettiGround() {
  const campus = directory?.find((c) => c.id === campusId);
  const buildings = (campus?.buildings ?? []).filter((b) => typeof b.lat === 'number' && typeof b.long === 'number');
  if (!buildings.length) return null;
  const lats = buildings.map((b) => b.lat);
  const lngs = buildings.map((b) => b.long);
  const lat0 = (Math.min(...lats) + Math.max(...lats)) / 2;
  const mLng = M_PER_DEG * Math.cos((lat0 * Math.PI) / 180);
  const south = Math.min(...lats) - MARGIN / M_PER_DEG;
  const north = Math.max(...lats) + MARGIN / M_PER_DEG;
  const west = Math.min(...lngs) - MARGIN / mLng;
  const east = Math.max(...lngs) + MARGIN / mLng;
  const area = (north - south) * M_PER_DEG * (east - west) * mLng;
  // One piece every ~40 m², within limits: a single-building campus still
  // gets a sprinkling, Leonardo doesn't get tens of thousands
  const count = Math.round(Math.min(16000, Math.max(1200, area / 40)));

  const rnd = seeded(campusId);
  const colours = COLOURS.slice(0, -1);   // no white: it vanishes on the paving
  const hl = PIECE_LENGTH / 2;
  const hw = PIECE_WIDTH / 2;
  const features = [];
  for (let i = 0; i < count; i++) {
    const lat = south + rnd() * (north - south);
    const lng = west + rnd() * (east - west);
    const a = rnd() * Math.PI;
    const s = 0.7 + rnd() * 0.6;
    const ca = Math.cos(a) * s;
    const sa = Math.sin(a) * s;
    const ring = [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw], [-hl, -hw]].map(([x, y]) => [
      lng + (x * ca - y * sa) / mLng,
      lat + (x * sa + y * ca) / M_PER_DEG,
    ]);
    features.push({
      type: 'Feature',
      properties: { c: colours[Math.floor(rnd() * colours.length)] },
      geometry: { type: 'Polygon', coordinates: [ring] },
    });
  }
  return { type: 'FeatureCollection', features };
}

function decorateMap(map) {
  mapRef = map;
  if (!info || map.getLayer(MAP_LAYER)) return;
  try {
    const data = confettiGround();
    if (!data) return;
    if (map.getSource(MAP_LAYER)) map.getSource(MAP_LAYER).setData(data);
    else map.addSource(MAP_LAYER, { type: 'geojson', data });
    map.addLayer({
      id: MAP_LAYER,
      type: 'fill',
      source: MAP_LAYER,
      slot: 'bottom',
      minzoom: 14.8,
      paint: {
        'fill-color': ['get', 'c'],
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14.8, 0, 15.6, 0.95],
        // Still bright under the Standard style's night lighting
        'fill-emissive-strength': 0.7,
      },
    });
  } catch (e) {
    console.warn('graduation: map confetti', e);
  }
}

function clearMap() {
  try {
    if (mapRef?.getLayer(MAP_LAYER)) mapRef.removeLayer(MAP_LAYER);
    if (mapRef?.getSource(MAP_LAYER)) mapRef.removeSource(MAP_LAYER);
  } catch { /* map gone */ }
}

// ── Logo and tab icon ─────────────────────────────────────────────────────
// The header logo's <img> takes graduation's drawing (the chair crowned with
// laurel, holding its diploma), sized by .gr-logo so the chair lands where it
// was (see style.css), the same way the seasons' do. index.html already picks
// it before first paint; this covers the layer starting later, and puts back
// whatever was there (the usual logo, or the season's) when it ends.

const LOGO_SRC = '/favicons/graduation/logo.webp';
const USUAL_LOGO_SRC = '/favicons/main/logo.webp';
const ICON_SRC = '/favicons/graduation/favicon-96x96.png';
const SEASON_LOGO_CLASSES = ['hw-logo', 'xm-logo'];
let logoSwap = null;   // { el, src, classes }
let iconSwap = null;   // [{ link, href, type }]

function startLogo() {
  const el = document.querySelector('.header-logo');
  if (el?.classList.contains('gr-logo')) {
    logoSwap = { el, src: USUAL_LOGO_SRC, classes: [] };
  } else if (el) {
    const img = new Image();
    img.src = LOGO_SRC;
    // Swapped only once it's decoded, so the header never shows a blank logo
    img.decode().then(() => {
      if (logoSwap || !info) return;
      const classes = SEASON_LOGO_CLASSES.filter((c) => el.classList.contains(c));
      logoSwap = { el, src: el.getAttribute('src'), classes };
      el.classList.remove(...classes);
      el.src = LOGO_SRC;
      el.classList.add('gr-logo');
    }).catch(() => { /* keep the logo there is */ });
  }
  iconSwap = [...document.querySelectorAll('link[rel~="icon"]')].map((link) => ({ link, href: link.getAttribute('href'), type: link.type }));
  for (const { link } of iconSwap) {
    link.type = 'image/png';
    link.href = ICON_SRC;
  }
}

function stopLogo() {
  if (logoSwap) {
    logoSwap.el.src = logoSwap.src;
    logoSwap.el.classList.remove('gr-logo');
    logoSwap.el.classList.add(...logoSwap.classes);
    logoSwap = null;
  }
  for (const { link, href, type } of iconSwap ?? []) {
    link.type = type;
    link.href = href;
  }
  iconSwap = null;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────

// `today`: { campusId, info, preview } from utils/season.js. A preview (picked
// from the search) has no info: the cosmetics only, no banner.
export function start(today) {
  info = today.info ?? { preview: true };
  campusId = today.campusId;
  listeners = new AbortController();
  const { signal } = listeners;

  setDecorator('map', decorateMap, OWNER);
  startWreath();
  startChipIcon();
  startLogo();

  window.addEventListener('pointerdown', rememberTap, { capture: true, passive: true, signal });
  window.addEventListener('favourites-changed', onFavouritesChanged, { signal });
  document.addEventListener('visibilitychange', onVisibility, { signal });
  if (!reduceMotion()) {
    scheduleDrop();
    scheduleSideBurst(true);
  }
}

export function stop() {
  info = null;
  campusId = null;
  listeners.abort();
  clearTimeout(dropTimer);
  clearTimeout(burstTimer);
  clearMap();
  stopChipIcon();
  stopLogo();
  wreathResize?.disconnect();
  wreath?.remove();
  wreath = null;
  // The worker's canvas can't be reused once transferred: a later start
  // makes a new one
  fx?.fire.reset?.();
  fxCanvas?.remove();
  fxCanvas = null;
  fx = null;
}
