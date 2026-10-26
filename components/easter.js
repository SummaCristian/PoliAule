// Easter decorations (Palm Sunday to Pasquetta, Easter Monday: they move with
// Easter, see utils/season.js), lazy-loaded by utils/season.js. The lilac
// accent and the spring strings are plain CSS / locale entries keyed on
// <html data-season="easter">; this module adds what needs the DOM:
//   - blossom petals drifting down over the app, tumbling as they go
//     (components/petals.js), held while the Campus tab shows
//   - an egg room per campus and day: a foil-wrapped chocolate egg on its
//     card and over its photo on its page, over its building on the map, in
//     its building's folder and next to its name in the search. Tapping it
//     cracks it open and a chick pops out: the surprise
//   - a sprig of blossom on a quarter of the cards and on the banner
//   - an olive branch hanging from the data status button
//   - now and then a pair of doves, olive twig in their beaks, across the top
//     of the screen
//   - eggs, chicks and tulips bursting out when something gets starred
//   - 3D eggs in nests and trees in blossom standing in the parks, squares and
//     paths around each campus on the Campus map
// With reduced motion nothing falls or flies, and the eggs open at once.

import { setDecorator, graduationShown } from '../utils/season.js';
import { t } from '../i18n.js';
import { startPetals, stopPetals, holdPetals } from './petals.js';
import seasonSpots from '../data/season-spots.json';
import { classroomsData as directory, ensureClassroomDirectory } from '../classroom-search-data.js';

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Randomness that stays put ─────────────────────────────────────────────
// Decorations come from a hash of what they sit on, so a card keeps the same
// sprig across re-renders and every visitor sees the same egg room.

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Today in Milan, YYYY-MM-DD: the egg rooms change at local midnight
function dayKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
}

const f1 = (v) => v.toFixed(1);

// ── Artwork ───────────────────────────────────────────────────────────────

// The foils the eggs are wrapped in: a colour and its shade
const FOILS = [
  ['#6aa8f5', '#3f7fd8'],
  ['#f77fa8', '#d94f84'],
  ['#6fd8ac', '#35b383'],
  ['#ffd45e', '#f0b020'],
  ['#b79af5', '#8a66dc'],
];

// A wrapped chocolate egg in a 32 x 40 box, whose colours come from
// --ea-a / --ea-b on the element (see eggEl): a wavy white band, a few dots, a
// shine and a bow at the neck
const EGG_SVG = `<svg viewBox="0 0 32 40" aria-hidden="true">
  <path class="ea-egg-shell" d="M16 1.5C9 1.5 3 13 3 23.5C3 32 9 38.5 16 38.5C23 38.5 29 32 29 23.5C29 13 23 1.5 16 1.5Z"/>
  <path class="ea-egg-shade" d="M3.2 26C5 34 10 38.5 16 38.5C22 38.5 27 34 28.8 26C24 31.5 8 31.5 3.2 26Z"/>
  <path class="ea-egg-wave" d="M4.2 21Q8 16.5 12 21T20 21T27.8 21"/>
  <path class="ea-egg-wave ea-egg-wave--thin" d="M3.6 27Q8 22.5 12 27T20 27T28.4 27"/>
  <circle class="ea-egg-dot" cx="9" cy="12" r="1.1"/><circle class="ea-egg-dot" cx="21.5" cy="14" r="1.1"/><circle class="ea-egg-dot" cx="15.5" cy="9" r="1"/>
  <ellipse class="ea-egg-shine" cx="10" cy="14" rx="2" ry="4.4" transform="rotate(22 10 14)"/>
  <path class="ea-egg-ribbon" d="M7.6 8.6Q16 12.4 24.4 8.6" />
  <path class="ea-egg-bow" d="M16 9.4C12 5.2 8.6 6 9.4 8.4C10 10.2 14 10.2 16 9.4ZM16 9.4C20 5.2 23.4 6 22.6 8.4C22 10.2 18 10.2 16 9.4Z"/>
  <circle class="ea-egg-bow" cx="16" cy="9.4" r="1.5"/>
</svg>`;

// The surprise
const CHICK_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path class="ea-chick-foot" d="M9 20.5v2.5M8 23h2.4M15 20.5v2.5M14 23h2.4"/>
  <ellipse class="ea-chick-body" cx="12" cy="15" rx="8" ry="6.6"/>
  <circle class="ea-chick-body" cx="12" cy="8" r="5.2"/>
  <path class="ea-chick-wing" d="M5.4 14.4C6 18.4 10.6 18.4 12.4 16.4C9.6 16.4 7.2 15.6 5.4 14.4Z"/>
  <path class="ea-chick-beak" d="M13.8 8.6L17.6 9.8L13.8 11Z"/>
  <circle class="ea-chick-eye" cx="14.4" cy="7" r="0.95"/>
  <path class="ea-chick-body" d="M10.6 3.2C10.8 1.6 12.6 1.2 12.8 2.8C13.6 1.8 15.2 2.6 14 3.8Z"/>
</svg>`;

// A flower of five round petals, and a sprig of them on a bent twig
function flowerAt(x, y, r, fill) {
  let petals = '';
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
    petals += `<circle cx="${f1(x + Math.cos(a) * r * 0.62)}" cy="${f1(y + Math.sin(a) * r * 0.62)}" r="${f1(r * 0.48)}" class="${fill}"/>`;
  }
  return `${petals}<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r * 0.24)}" class="ea-flower-eye"/>`;
}

// `s`: its width and height. A twig from the bottom-left corner curving up
// to the right with flowers along it and a bud or two
function sprigSvg(s, seed) {
  const k = s / 30;
  const spots = [[7, 21, 4.4], [14, 15, 4], [21, 11, 4.6], [26, 5.5, 3.4], [11, 9, 2.6]];
  const kinds = ['ea-flower', 'ea-flower-light', 'ea-flower'];
  const flowers = spots.map(([x, y, r], i) => flowerAt(x * k, y * k, r * k, kinds[(seed + i) % 3])).join('');
  const leaves = [[4, 26, -40], [17, 18, 30]].map(([x, y, a]) =>
    `<path class="ea-leaf" d="M0 0C2.5-2.6 7-2.8 9 0C7 2.6 2.5 2.8 0 0Z" transform="translate(${f1(x * k)} ${f1(y * k)}) rotate(${a}) scale(${f1(k)})"/>`).join('');
  return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" aria-hidden="true">` +
    `<path class="ea-twig" d="M1 ${s - 1}C${f1(9 * k)} ${f1(24 * k)} ${f1(18 * k)} ${f1(18 * k)} ${f1(26 * k)} ${f1(6 * k)}" />${leaves}${flowers}</svg>`;
}

// A branch of olive on a thread: sage leaves in pairs along a curved stem and
// two dark olives
const OLIVE_SVG = (() => {
  let leaves = '';
  [[2, 5, -58], [-1, 8, 238], [3, 11, -48], [-2, 14, 228], [2, 17, -40], [-1, 20, 218], [1, 23, -20]].forEach(([x, y, a], i) => {
    leaves += `<path class="ea-olive-leaf ea-olive-leaf--${i % 2}" d="M0 0C3-3 10-3.4 14 0C10 3.4 3 3 0 0Z" transform="translate(${x} ${y}) rotate(${a}) scale(.78)"/>`;
  });
  const olives = [[-4.5, 19, 2.6, 3.4], [4, 22.5, 2.5, 3.3]].map(([x, y, rx, ry]) => `<ellipse class="ea-olive-fruit" cx="${x}" cy="${y}" rx="${rx}" ry="${ry}"/>`).join('');
  return `<svg width="34" height="38" viewBox="-17 -2 34 38" aria-hidden="true"><path class="ea-olive-stem" d="M0 0C-1 8 1 16 0 25"/>${leaves}${olives}</svg>`;
})();

// A dove in flight, olive twig in its beak, 72 x 44: flat fills, no outlines,
// two tones of white (the shade is the same shape shifted down a little behind
// the white one, so a crescent of it shows on the belly, the tail and under
// the wing). The wings are groups flapped by CSS about the shoulder
// (ea-wing); the far one is darker and a beat behind.
const DOVE_WING = 'M43 22C41 11 34 4 26.5 0.5Q19 2 23 7.5Q16 10 20.5 14.5Q15.5 18.5 21.5 20.5Q23 25.5 31 25Z';
const DOVE_SVG = `<svg width="72" height="44" viewBox="0 0 72 44" aria-hidden="true">
  <g class="ea-wing ea-wing--far"><path class="ea-dove-far" d="${DOVE_WING}"/></g>
  <g class="ea-dove-shade" transform="translate(0 2.4)">
    <ellipse cx="9" cy="28" rx="9" ry="2.8" transform="rotate(-16 18 28)"/><ellipse cx="9" cy="28" rx="9.6" ry="2.8"/><ellipse cx="9" cy="28" rx="9" ry="2.8" transform="rotate(14 18 28)"/>
    <ellipse cx="34" cy="26" rx="19.5" ry="9.4"/><circle cx="47" cy="24" r="8"/><circle cx="55" cy="19.5" r="6.3"/>
  </g>
  <g class="ea-dove-white">
    <ellipse cx="9" cy="28" rx="9" ry="2.8" transform="rotate(-16 18 28)"/><ellipse cx="9" cy="28" rx="9.6" ry="2.8"/><ellipse cx="9" cy="28" rx="9" ry="2.8" transform="rotate(14 18 28)"/>
    <ellipse cx="34" cy="26" rx="19.5" ry="9.4"/><circle cx="47" cy="24" r="8"/><circle cx="55" cy="19.5" r="6.3"/><path d="M46 18L55 13L56 26L46 28Z"/>
  </g>
  <path class="ea-dove-beak" d="M60.4 18.8L65.6 21.2L60.2 23Z"/>
  <circle class="ea-dove-eye" cx="57.3" cy="18.6" r="1"/>
  <path class="ea-dove-stem" d="M65 21.6C67.5 22.4 69.6 24 70.8 26.2"/>
  <path class="ea-dove-leaf" d="M67.2 22.5C67.6 20.4 69.2 19.6 70.6 19.8C70.6 21.6 69.2 22.8 67.2 22.5Z"/>
  <path class="ea-dove-leaf" d="M69.4 25C71 24 72.4 24.4 73 25.6C71.8 26.8 70.2 26.6 69.4 25Z"/>
  <g class="ea-wing"><path class="ea-dove-shade" d="${DOVE_WING}" transform="translate(-1.9 1.5)"/><path class="ea-dove-white" d="${DOVE_WING}"/></g>
</svg>`;

// ── Egg rooms ─────────────────────────────────────────────────────────────
// One per campus per day, from the rooms people actually book that have a
// photo for the egg to sit over. The map puts an egg on its building.

let eggRooms = null; // { day, ids: Set<number>, buildings: Set<"campusId:name"> }

function eggs() {
  const day = dayKey();
  if (eggRooms?.day === day) return eggRooms;
  // Not picked (nor remembered) until the rooms have loaded
  if (!directory) return { day, ids: new Set(), buildings: new Set() };
  eggRooms = { day, ids: new Set(), buildings: new Set() };
  for (const campus of directory ?? []) {
    if (campus.secondary) continue;
    const rooms = [];
    for (const building of campus.buildings ?? []) {
      if (building.secondary) continue;
      for (const room of building.classrooms ?? []) {
        if (!room.eventsOnly && !room.noSchedule && room.idfoto) rooms.push([room.id, building.name]);
      }
    }
    if (!rooms.length) continue;
    const [id, buildingName] = rooms[hash(`egg:${day}:${campus.id}`) % rooms.length];
    eggRooms.ids.add(id);
    eggRooms.buildings.add(`${campus.id}:${buildingName}`);
  }
  return eggRooms;
}

// Cracked open today (tapped, on its card or its page): stays open until
// tomorrow's
const OPENED_KEY = 'poliAule_easterOpened';

function opened() {
  try {
    const v = JSON.parse(localStorage.getItem(OPENED_KEY));
    return v?.day === dayKey() ? new Set(v.ids) : new Set();
  } catch { return new Set(); }
}

function markOpened(id) {
  const ids = opened();
  ids.add(id);
  try { localStorage.setItem(OPENED_KEY, JSON.stringify({ day: dayKey(), ids: [...ids] })); } catch { /* lasts this session */ }
}

let eggLabel = '';
let crackLabel = '';

// The room's egg, wrapped in a foil of the day's: two halves (clipped along a
// zigzag in CSS), the chick that waits inside and its "Cheep!". `kind`:
// 'card' (small, top-left of the card) or 'photo' (big, over the page's photo).
// An egg already cracked today is built open.
function eggEl(id, kind) {
  const [a, b] = FOILS[hash(`foil:${dayKey()}:${id}`) % FOILS.length];
  const el = document.createElement('div');
  el.className = `ea-egg ea-egg--${kind}`;
  el.dataset.eggRoom = id;
  el.style.setProperty('--ea-a', a);
  el.style.setProperty('--ea-b', b);
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', crackLabel);
  el.innerHTML = `<span class="ea-egg-half ea-egg-half--bottom">${EGG_SVG}</span>` +
    `<span class="ea-egg-chick">${CHICK_SVG}</span>` +
    `<span class="ea-egg-half ea-egg-half--top">${EGG_SVG}</span>` +
    `<span class="ea-egg-bubble" aria-hidden="true">${t('season.easter.surprise')}</span>`;
  if (opened().has(id)) {
    el.classList.add('ea-egg--open', 'ea-egg--settled');
    el.removeAttribute('role');
    el.removeAttribute('tabindex');
    el.removeAttribute('aria-label');
    return el;
  }
  // The egg is no part of the card or the page it sits on: tapping it must
  // neither open them nor press them
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  const crack = (e) => {
    e.stopPropagation();
    e.preventDefault();
    crackEgg(el, id);
  };
  el.addEventListener('click', crack);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') crack(e); });
  return el;
}

// Shakes, cracks along the zigzag, the top half goes flying and the chick
// pops out with its "Cheep!" and a burst of pastel. On the page the egg then
// goes; on a card the cup and the chick stay.
function crackEgg(el, id) {
  if (el.classList.contains('ea-egg--cracking') || el.classList.contains('ea-egg--open')) return;
  markOpened(id);
  el.removeAttribute('role');
  el.removeAttribute('tabindex');
  el.removeAttribute('aria-label');
  const instant = reduceMotion();
  el.classList.add('ea-egg--cracking');
  setTimeout(() => {
    el.classList.remove('ea-egg--cracking');
    el.classList.add('ea-egg--open');
    const rect = el.getBoundingClientRect();
    celebrate(rect.left + rect.width / 2, rect.top + rect.height * 0.4);
    if (el.classList.contains('ea-egg--photo')) {
      setTimeout(() => {
        el.classList.add('ea-egg--gone');
        setTimeout(() => el.remove(), instant ? 0 : 700);
      }, instant ? 0 : 3200);
    } else {
      setTimeout(() => el.classList.add('ea-egg--settled'), instant ? 0 : 3200);
    }
  }, instant ? 0 : 420);
}

// ── Helpers ───────────────────────────────────────────────────────────────

function decor(className, html) {
  const el = document.createElement('div');
  el.className = `ea-decor ${className}`;
  el.innerHTML = html;
  return el;
}

// ── Classroom cards ───────────────────────────────────────────────────────
// The egg room's card gets its egg; about a quarter of the others a sprig of
// blossom, top-left (the right corner is the favourite star's).

function decorateCard(card, classroom) {
  const id = classroom.id;
  const clip = card.querySelector('.classroom-card-clip');
  if (!clip || clip.querySelector(':scope > .ea-egg, :scope > .ea-decor')) return;
  if (eggs().ids.has(id)) {
    clip.appendChild(eggEl(id, 'card'));
    return;
  }
  const h = hash(`card:${id}`);
  if (h % 4 === 0) clip.appendChild(decor('ea-sprig', sprigSvg(30, h)));
}

// ── Building folders ──────────────────────────────────────────────────────
// The egg room's building has an egg sticking up out of its papers.

function decorateFolder(folder, { campusId, building }) {
  if (!eggs().buildings.has(`${campusId}:${building.name}`) || folder.querySelector('.ea-folder-egg')) return;
  folder.querySelector('.bo-card-papers')?.appendChild(decor('ea-folder-egg', miniEgg(1)));
}

// A small egg for the rooms' names, the map and the folders
function miniEgg(seed) {
  const [a, b] = FOILS[seed % FOILS.length];
  return `<span class="ea-mini" style="--ea-a:${a};--ea-b:${b}">${EGG_SVG}</span>`;
}

// ── Classroom page ────────────────────────────────────────────────────────
// The egg room's photo has its egg over it: tapping it cracks it open.

function decorateDetail(page, { classroom }) {
  if (!eggs().ids.has(classroom.id)) return;
  const photo = page.querySelector('.detail-photo-container');
  if (!photo || photo.querySelector('.ea-egg') || opened().has(classroom.id)) return;
  photo.appendChild(eggEl(classroom.id, 'photo'));
}

// The season's banner (utils/season.js): a sprig of blossom in its corner
function decorateBanner(banner) {
  if (banner.querySelector(':scope > .ea-decor')) return;
  banner.appendChild(decor('ea-sprig ea-sprig--banner', sprigSvg(44, 3)));
}

// ── Search ────────────────────────────────────────────────────────────────
// An egg by the egg rooms' names

function decorateSearchRow(row, item) {
  if (row.querySelector('.ea-search-egg')) return;
  if (item.type !== 'classroom' || !eggs().ids.has(item.room.id)) return;
  const badge = document.createElement('span');
  badge.className = 'ea-search-egg';
  badge.innerHTML = miniEgg(hash(`foil:${dayKey()}:${item.room.id}`));
  badge.title = eggLabel;
  badge.setAttribute('role', 'img');
  badge.setAttribute('aria-label', eggLabel);
  row.querySelector('.search-row-title-text')?.appendChild(badge);
}

// ── Map markers ───────────────────────────────────────────────────────────

function decorateMarker(el, { campus, building }) {
  if (el.querySelector(':scope > .ea-map-egg')) return;
  if (!eggs().buildings.has(`${campus.id}:${building.name}`)) return;
  const egg = document.createElement('span');
  egg.className = 'ea-map-egg';
  egg.innerHTML = miniEgg(hash(`${campus.id}:${building.name}`));
  el.prepend(egg);
}

// ── The map ───────────────────────────────────────────────────────────────
// 3D eggs in nests and trees in blossom standing in the open spots around
// each campus (data/season-spots.json), as a model layer in the map itself,
// like Halloween's and Christmas's (see components/halloween.js for the
// details). At night (dark mode's night preset) the models are lit in their
// own colours, as under a street lamp. The petals are held while the map
// shows: it has the scenery.

const MAP_MODELS = ['egg', 'eggs', 'blossom', 'egg-night', 'eggs-night', 'blossom-night'];
const MAP_LAYER = 'ea-ground';
const MAP_TAB = 'search-classrooms-container';

let mapRef = null;
let mapActive = false;

const darkScheme = matchMedia('(prefers-color-scheme: dark)');
const glowFor = (dark) => ['match', ['get', 'model'], 'ea-blossom', dark ? 0.6 : 0, 'ea-egg', dark ? 0.7 : 0, 'ea-eggs', dark ? 0.7 : 0, 0];
const modelIdFor = (dark) => (dark ? ['concat', ['get', 'model'], '-night'] : ['get', 'model']);

const updateGlow = () => {
  if (!mapRef?.getLayer(MAP_LAYER)) return;
  const dark = darkScheme.matches;
  mapRef.setLayoutProperty(MAP_LAYER, 'model-id', modelIdFor(dark));
  mapRef.setPaintProperty(MAP_LAYER, 'model-emissive-strength', glowFor(dark));
};

function groundPoints() {
  const features = [];
  const eggAt = [];
  for (const campus of directory ?? []) {
    for (const b of campus.buildings ?? []) {
      if (eggs().buildings.has(`${campus.id}:${b.name}`) && typeof b.lat === 'number') eggAt.push([campus.id, b.long, b.lat]);
    }
  }
  for (const [campusId, list] of Object.entries(seasonSpots)) {
    if (!Array.isArray(list)) continue;
    // The egg room's building gets a big egg on its nearest spots
    const near = new Set();
    for (const [cid, hx, hy] of eggAt) {
      if (cid !== campusId) continue;
      const k = 111320 * Math.cos(hy * Math.PI / 180);
      list.map(([x, y], i) => [Math.hypot((x - hx) * k, (y - hy) * 111320), i])
        .filter(([d]) => d < 90)
        .sort((p, q) => p[0] - q[0])
        .slice(0, 2)
        .forEach(([, i]) => near.add(i));
    }
    list.forEach(([x, y], i) => {
      const h = hash(`espot:${x},${y}`);
      const roll = h % 100;
      const model = near.has(i) ? 'egg' : roll < 55 ? 'blossom' : roll < 80 ? 'eggs' : 'egg';
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [x, y] },
        properties: { model: `ea-${model}`, rotation: [0, 0, (h >>> 8) % 360] },
      });
    });
  }
  return { type: 'FeatureCollection', features };
}

function decorateMap(map) {
  mapRef = map;
  updatePetals();
  if (!mapActive || map.getLayer(MAP_LAYER)) return;
  try {
    for (const name of MAP_MODELS) {
      try { map.addModel(`ea-${name}`, `/models/easter/${name}.glb`); } catch { /* exists */ }
    }
    map.addSource(MAP_LAYER, { type: 'geojson', data: groundPoints() });
    map.addLayer({
      id: MAP_LAYER,
      type: 'model',
      source: MAP_LAYER,
      slot: 'middle',
      minzoom: 15,
      layout: { 'model-id': modelIdFor(darkScheme.matches) },
      paint: {
        'model-type': 'common-3d',
        // Same scale as Halloween's pumpkins and Christmas's trees: a
        // blossom tree, 1.8 m at real size, is about 55 px tall at campus zoom
        'model-scale': ['interpolate', ['linear'], ['zoom'],
          15, ['literal', [26, 26, 26]],
          16, ['literal', [20, 20, 20]],
          17, ['literal', [13, 13, 13]],
          18, ['literal', [8, 8, 8]]],
        'model-rotation': ['get', 'rotation'],
        'model-cast-shadows': true,
        'model-receive-shadows': true,
        'model-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.6, 1],
        'model-emissive-strength': glowFor(darkScheme.matches),
      },
    });
  } catch (e) {
    console.warn('easter: map decorations', e);
  }
}

function clearMap() {
  if (mapRef?.getLayer(MAP_LAYER)) mapRef.removeLayer(MAP_LAYER);
  if (mapRef?.getSource(MAP_LAYER)) mapRef.removeSource(MAP_LAYER);
  mapRef = null;
}

const mapShowing = () => !!document.getElementById(MAP_TAB)?.classList.contains('visible') && !document.hidden;

// The petals are held (and the app's own scenery with them) while the Campus
// map shows
function updatePetals() {
  holdPetals('map', mapActive && mapShowing());
}

const onTabVisible = () => requestAnimationFrame(updatePetals);

// ── Olive branch under the data status button ─────────────────────────────
// Not the settings button: on the Campus map the locate button sits below
// that one, and the branch would hang over it. Hangs on a thread from behind
// the button, swaying; a tap gives it a swing.

let olive = null;
let oliveResize = null;

function placeOlive() {
  const btn = document.getElementById('data-fetch-btn');
  if (!olive || !btn) return;
  olive.style.left = `${btn.offsetLeft + btn.offsetWidth / 2}px`;
  olive.style.top = `${btn.offsetTop + btn.offsetHeight / 2}px`;
}

function startOlive() {
  const btn = document.getElementById('data-fetch-btn');
  const host = btn?.offsetParent;
  if (!host) return;
  olive = document.createElement('div');
  olive.className = 'ea-olive';
  olive.innerHTML = `<div class="ea-olive-sway"><div class="ea-olive-line"></div>` +
    `<button type="button" class="ea-olive-branch" tabindex="-1" aria-hidden="true">${OLIVE_SVG}</button></div>`;
  olive.querySelector('.ea-olive-branch').addEventListener('click', (e) => {
    e.stopPropagation();
    if (reduceMotion()) return;
    const sway = olive.querySelector('.ea-olive-sway');
    sway.classList.remove('ea-olive-sway--swing');
    void sway.offsetWidth;
    sway.classList.add('ea-olive-sway--swing');
  });
  host.appendChild(olive);
  placeOlive();
  oliveResize = new ResizeObserver(placeOlive);
  oliveResize.observe(host);
}

// ── Doves ─────────────────────────────────────────────────────────────────

let sky = null;
let flyTimer = 0;

// A pair of doves across the top of the screen, one a little behind and
// below the other, rising and dipping on a slow wave
function flyDoves() {
  if (reduceMotion() || document.hidden || !sky || document.body.classList.contains('detail-open')) return;
  const W = innerWidth, H = innerHeight;
  const ltr = Math.random() < 0.5;
  const baseY = H * (0.06 + Math.random() * 0.14);
  const duration = 6200 + Math.random() * 1600;
  [0, 1].forEach((i) => {
    const el = document.createElement('div');
    el.className = 'ea-flyer';
    el.style.setProperty('--ea-flap', `${(0.34 + Math.random() * 0.08).toFixed(2)}s`);
    el.innerHTML = DOVE_SVG;
    sky.appendChild(el);
    const width = 72;
    const x0 = ltr ? -width - 20 - i * 46 : W + 20 + i * 46, x1 = ltr ? W + 20 : -width - 20;
    const phase = i * 0.9;
    const flip = ltr ? '' : ' scaleX(-1)';
    const frames = [];
    for (let k = 0; k <= 14; k++) {
      const tt = k / 14;
      const x = x0 + (x1 - x0) * tt;
      const y = baseY + i * 22 + Math.sin(tt * Math.PI * 3 + phase) * 14 - tt * 24;
      frames.push({ transform: `translate(${f1(x)}px, ${f1(y)}px) rotate(${f1(Math.cos(tt * Math.PI * 3 + phase) * -5)}deg)${flip}` });
    }
    const anim = el.animate(frames, { duration: duration + i * 300, easing: 'linear', fill: 'both' });
    anim.onfinish = anim.oncancel = () => el.remove();
  });
}

function scheduleDoves(first = false) {
  const wait = first ? 12000 + Math.random() * 15000 : 70000 + Math.random() * 90000;
  flyTimer = setTimeout(() => {
    flyDoves();
    scheduleDoves();
  }, wait);
}

// ── Confetti: starring and the surprise ───────────────────────────────────

let confettiLib = null;
let fx = null;           // { fire, eggs }
let fxCanvas = null;
let lastTap = null;      // { x, y, at }

const PASTELS = ['#f9a8c9', '#ffd966', '#9bd8f5', '#b6e3b0', '#cdb4f6', '#ffffff'];

const rememberTap = (e) => { lastTap = { x: e.clientX, y: e.clientY, at: performance.now() }; };

async function confettiFx() {
  if (fx) return fx;
  if (!confettiLib) ({ default: confettiLib } = await import('canvas-confetti'));
  if (!sky) return null;   // stopped while loading
  fxCanvas = document.createElement('canvas');
  fxCanvas.className = 'ea-fx';
  document.body.appendChild(fxCanvas);
  let shapes = ['circle'];
  try {
    shapes = ['🥚', '🐣', '🌷', '🐰', '🌸'].map((text) => confettiLib.shapeFromText({ text, scalar: 1.8 }));
  } catch { /* no emoji shapes: dots */ }
  fx = { fire: confettiLib.create(fxCanvas, { resize: true }), eggs: shapes };
  return fx;
}

// Starred: a burst of eggs, chicks and tulips from the star that was just
// tapped (Halloween's candy, components/halloween.js, with other shapes)
async function rainEggs() {
  if (reduceMotion()) return;
  const c = await confettiFx();
  if (!c) return;
  const tap = lastTap && performance.now() - lastTap.at < 1500 ? lastTap : { x: innerWidth / 2, y: innerHeight * 0.2 };
  c.fire({
    particleCount: 16, spread: 75, startVelocity: 20, gravity: 0.9, ticks: 140, scalar: 1.8, flat: true,
    shapes: c.eggs, colors: PASTELS,
    origin: { x: tap.x / fxCanvas.clientWidth, y: Math.min(1, tap.y / fxCanvas.clientHeight) },
    disableForReducedMotion: true,
  });
}

const onFavouritesChanged = (e) => {
  // On a graduation day its own burst takes this one's place (components/graduation.js)
  if (e.detail?.added != null && !graduationShown()) rainEggs();
};

// The egg cracked: a burst of pastel from it
async function celebrate(x, y) {
  if (reduceMotion()) return;
  const c = await confettiFx();
  if (!c) return;
  c.fire({
    particleCount: 60, spread: 85, startVelocity: 28, ticks: 150, scalar: 0.9,
    colors: PASTELS,
    origin: { x: x / fxCanvas.clientWidth, y: y / fxCanvas.clientHeight },
    disableForReducedMotion: true,
  });
}

// ── Lifecycle ─────────────────────────────────────────────────────────────

// Whatever was built before this module loaded, or before the rooms did (the
// egg rooms need them)
function decorateBuilt() {
  document.querySelectorAll('.classroom-card').forEach((card) => {
    const id = Number(card.dataset.openClassroom);
    if (id) decorateCard(card, { id });
  });
  document.querySelectorAll('.map-pin[data-building][data-campus]').forEach((el) => {
    decorateMarker(el, { campus: { id: el.dataset.campus }, building: { name: el.dataset.building } });
  });
  document.querySelectorAll('.bo-card[data-building-name]').forEach((folder) => {
    decorateFolder(folder, { campusId: folder.dataset.campusId, building: { name: folder.dataset.buildingName } });
  });
  const banner = document.querySelector('.season-banner:not(.update-banner)');
  if (banner) decorateBanner(banner);
}

let listeners = new AbortController();

export function start() {
  listeners = new AbortController();
  const { signal } = listeners;
  eggLabel = t('season.easter.eggRoom');
  crackLabel = t('season.easter.crack');

  startPetals();
  setDecorator('card', decorateCard);
  setDecorator('marker', decorateMarker);
  setDecorator('folder', decorateFolder);
  setDecorator('detail', decorateDetail);
  setDecorator('searchRow', decorateSearchRow);
  setDecorator('banner', decorateBanner);
  mapActive = true;
  setDecorator('map', decorateMap);
  darkScheme.addEventListener('change', updateGlow, { signal });
  document.addEventListener('tabvisible', onTabVisible, { signal });
  document.addEventListener('visibilitychange', updatePetals, { signal });
  updatePetals();

  decorateBuilt();
  startOlive();
  if (!directory) {
    ensureClassroomDirectory().then(() => {
      if (!mapActive) return;
      decorateBuilt();
      if (mapRef?.getSource(MAP_LAYER)) mapRef.getSource(MAP_LAYER).setData(groundPoints());
    }).catch(() => { /* no egg rooms today */ });
  }

  sky = document.createElement('div');
  sky.className = 'ea-sky';
  sky.setAttribute('aria-hidden', 'true');
  document.body.appendChild(sky);
  scheduleDoves(true);

  window.addEventListener('pointerdown', rememberTap, { capture: true, passive: true, signal });
  window.addEventListener('favourites-changed', onFavouritesChanged, { signal });
}

export function stop() {
  mapActive = false;
  clearMap();
  listeners.abort();
  holdPetals('map', false);
  stopPetals();
  clearTimeout(flyTimer);
  oliveResize?.disconnect();
  olive?.remove();
  olive = null;
  sky?.remove();
  sky = null;
  fxCanvas?.remove();
  fxCanvas = null;
  fx = null;
  document.querySelectorAll('.ea-decor, .ea-egg, .ea-map-egg, .ea-search-egg').forEach((el) => el.remove());
}
