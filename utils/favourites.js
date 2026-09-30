// Client-only favourites store, backed by localStorage. No backend.
//
// The value is one JSON array holding both kinds, in the order they were
// starred (the Favourites strip shows them in that order):
//   - a classroom: its numeric id (classroom.id in data/classrooms.json)
//   - a building:  the string "<campusId>:<building name>". Not idEdificio,
//     which a third of the buildings don't have; the name is unique within a
//     campus (same key as data/building-outlines.json)
// Builds from before building favourites keep only the finite numbers, so
// they read the same list and simply skip the buildings.

import { t, onLanguageSwitch } from '../i18n.js';

const KEY = 'poliAule_favourites';

// Filled rounded star, self-hosted because HugeIcons' free CDN font only ships
// the stroke (outline) set — `hgi-star` matches this shape for the un-favourited
// state. The stroke rounds the points and, with `paint-order: stroke` (stroke
// painted behind the fill), doubles as a contrast halo — the card overrides
// `stroke`/`stroke-width` via CSS on `.star-icon path` for a black/white
// outline; the header button keeps the currentColor default below.
export const FILLED_STAR_SVG =
  '<svg class="star-icon star-icon--filled" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M12 2.6l2.9 5.88 6.49.95-4.7 4.58 1.11 6.46L12 17.4l-5.8 3.05 1.11-6.46-4.7-4.58 6.49-.95z" ' +
  'fill="currentColor" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" paint-order="stroke"/></svg>';

export function buildingKey(campusId, buildingName) {
  return `${campusId}:${buildingName}`;
}

// { campusId, name } for a building entry, or null for anything else.
export function parseBuildingKey(entry) {
  if (typeof entry !== 'string') return null;
  const i = entry.indexOf(':');
  if (i <= 0 || i === entry.length - 1) return null;
  return { campusId: entry.slice(0, i), name: entry.slice(i + 1) };
}

// A stored value, normalised: a classroom id as a finite number, a building
// key as a string, anything else null.
function normalise(entry) {
  if (typeof entry === 'number') return Number.isFinite(entry) ? entry : null;
  if (typeof entry !== 'string') return null;
  if (parseBuildingKey(entry)) return entry;
  // Older lists may hold ids as numeric strings.
  const n = Number(entry);
  return entry.trim() !== '' && Number.isFinite(n) ? n : null;
}

function dedupe(entries) {
  return [...new Set(entries.map(normalise).filter(e => e !== null))];
}

// Every favourite, classrooms and buildings, in starred order. Any
// parse/storage failure yields an empty list rather than throwing.
export function getFavouriteEntries() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? dedupe(parsed) : [];
  } catch {
    return [];
  }
}

// The favourite classroom ids alone, as numbers.
export function getFavouriteIds() {
  return getFavouriteEntries().filter(e => typeof e === 'number');
}

export function isFavourite(id) {
  return getFavouriteEntries().includes(Number(id));
}

export function isFavouriteBuilding(campusId, buildingName) {
  return getFavouriteEntries().includes(buildingKey(campusId, buildingName));
}

function write(entries) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* storage full or unavailable — favourites just won't persist */
  }
  window.dispatchEvent(new CustomEvent('favourites-changed'));
}

// Replaces the whole list (used by the device transfer import).
export function setFavouriteEntries(entries) {
  write(dedupe(entries));
}

// Adds the entry at the end, or removes it. Returns the new state (boolean).
function toggleEntry(entry) {
  const entries = getFavouriteEntries();
  const idx = entries.indexOf(entry);
  if (idx === -1) entries.push(entry);
  else entries.splice(idx, 1);
  write(entries);
  return idx === -1;
}

export function toggleFavourite(id) {
  return toggleEntry(Number(id));
}

export function toggleFavouriteBuilding(campusId, buildingName) {
  return toggleEntry(buildingKey(campusId, buildingName));
}

// Puts a star button (the detail page's, a building header's) in the given
// state: outline hgi-star off, filled yellow star on (.favourite-btn--active,
// see style.css). `kind` picks the aria-labels: 'classroom' or 'building'.
export function syncStarButton(btn, on, kind = 'classroom') {
  const key = kind === 'building'
    ? (on ? 'favourite.removeBuilding' : 'favourite.addBuilding')
    : (on ? 'favourite.remove' : 'favourite.add');
  btn.classList.toggle('favourite-btn--active', on);
  btn.setAttribute('aria-label', t(key));
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.innerHTML = on ? FILLED_STAR_SVG : '<i class="hgi-stroke hgi-star" aria-hidden="true"></i>';
}

// A glass star button that stars/unstars a whole building (the Available
// results' building headers, the Campus sheet's building page, the favourite
// building popup). `className` adds the host's own button recipe. Stays in
// sync on its own through initFavouriteMarkers.
export function createBuildingStarButton(campusId, buildingName, className = '') {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `fav-star-btn liquid-glass ${className}`.trim();
  setBuildingStarTarget(btn, campusId, buildingName);
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const { campusId: c, name } = parseBuildingKey(btn.dataset.favBuilding) ?? {};
    if (c) toggleFavouriteBuilding(c, name);
  });
  return btn;
}

// Points an existing building star button at another building (the Campus
// sheet reuses one button across building pages).
export function setBuildingStarTarget(btn, campusId, buildingName) {
  btn.dataset.favBuilding = buildingKey(campusId, buildingName);
  syncStarButton(btn, isFavouriteBuilding(campusId, buildingName), 'building');
}

// Keeps already-rendered cards (Available results, Campus/Search results) and
// building star buttons in sync when favourites change elsewhere, without a
// full re-render. Only cards that opted in via `data-fav-star`, and buttons
// carrying `data-fav-building`, are touched.
let _markersReady = false;
export function initFavouriteMarkers() {
  if (_markersReady) return;
  _markersReady = true;
  const syncAll = () => {
    const favs = new Set(getFavouriteEntries());
    document.querySelectorAll('.classroom-card[data-fav-star][data-open-classroom]').forEach(card => {
      const on = favs.has(Number(card.dataset.openClassroom));
      card.classList.toggle('classroom-card--fav', on);
    });
    document.querySelectorAll('button[data-fav-building]').forEach(btn => {
      syncStarButton(btn, favs.has(btn.dataset.favBuilding), 'building');
    });
  };
  window.addEventListener('favourites-changed', syncAll);
  // Only for the buttons' aria-labels.
  onLanguageSwitch(syncAll);
}
