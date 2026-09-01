// Client-only "favourite classrooms" store, backed by localStorage.
// Value is a JSON array of numeric classroom ids (classroom.id from
// data/classrooms.json). No backend.

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

// Returns the favourite classroom ids as a deduped array of numbers.
// Any parse/storage failure yields an empty list rather than throwing.
export function getFavouriteIds() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map(Number).filter(n => Number.isFinite(n)))];
  } catch {
    return [];
  }
}

export function isFavourite(id) {
  return getFavouriteIds().includes(Number(id));
}

function write(ids) {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    /* storage full or unavailable — favourites just won't persist */
  }
  window.dispatchEvent(new CustomEvent('favourites-changed'));
}

// Adds or removes the id. Returns the new favourited state (boolean).
export function toggleFavourite(id) {
  const num = Number(id);
  const ids = getFavouriteIds();
  const idx = ids.indexOf(num);
  if (idx === -1) {
    ids.push(num);
    write(ids);
    return true;
  }
  ids.splice(idx, 1);
  write(ids);
  return false;
}

// Keeps already-rendered cards (Available results, Campus/Search results) in
// sync when favourites change elsewhere, without a full list re-render. Only
// cards that opted in via `data-fav-star` are touched.
export function initFavouriteMarkers() {
  window.addEventListener('favourites-changed', () => {
    const favs = new Set(getFavouriteIds());
    document.querySelectorAll('.classroom-card[data-fav-star][data-open-classroom]').forEach(card => {
      const on = favs.has(Number(card.dataset.openClassroom));
      card.classList.toggle('classroom-card--fav', on);
    });
  });
}
