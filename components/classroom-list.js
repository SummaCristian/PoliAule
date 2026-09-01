import { t } from '../i18n.js';
import { escapeHtml, highlight } from '../utils/html.js';
import { fetchPhotoUrl, photoUrlCache } from '../utils/photo.js';
import { isFavourite, FILLED_STAR_SVG } from '../utils/favourites.js';

// ---------- PHOTO ----------

async function _loadCardPhoto(classroomId, card) {
  const img = card.querySelector('.classroom-card-photo');
  const url = await fetchPhotoUrl(classroomId);
  img.onerror = () => card.classList.add('photo-failed');
  img.src = url;
  img.decode().then(() => img.classList.add('loaded')).catch(() => card.classList.add('photo-failed'));
}

const _photoObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    _photoObserver.unobserve(entry.target);
    if (entry.target.dataset.idfoto) _loadCardPhoto(Number(entry.target.dataset.openClassroom), entry.target);
  }
}, { rootMargin: '300px' });

// ---------- CARD ----------

const STATUS_KEYS = {
  'free': 'status.free',
  'partially-free': 'status.partiallyFree',
  'occupied': 'status.occupied',
  'free-soon': 'status.freeSoon',
  'occupied-soon': 'status.occupiedSoon',
};

// Builds and returns a Card DOM element for the classroom passed as parameter.
// Every card shares the same footprint (aspect-ratio-based, see .classroom-card
// in classroom-list.css) so they lay out cleanly in the results grid, whether
// or not the room has a photo.
//
// fromTime/toTime/date are optional — pass them when the card represents a
// specific query time range (Available tab) so opening the classroom detail
// page preserves that context; omit them (e.g. Campus tab browsing) to open
// the detail page with no query context, showing status relative to now.
//
// query is optional — pass the user's search text (Campus tab's search box)
// to wrap matching text in the name/building line with <mark>.
//
// showFavouriteStar is optional — pass true (Available results, Campus/Search
// results) to render a top-right star marker when the room is a favourite, and
// to opt the card into live updates from favourites.js. Omit it in the
// Favourites carousel itself, where every card is already a favourite.
export function buildCardForClassroom(classroom, building, fromTime = null, toTime = null, isToday = false, date = null, query = '', showFavouriteStar = false) {
  const hasPhoto = !!classroom.idfoto;
  const statusKey = STATUS_KEYS[classroom.status];
  const statusLabel = statusKey ? t(statusKey) : '';

  const el = document.createElement('div');
  el.className = hasPhoto ? 'classroom-card classroom-card--photo' : 'classroom-card classroom-card--plain';
  el.dataset.openClassroom = classroom.id;
  if (fromTime) el.dataset.queryFrom = fromTime;
  if (toTime) el.dataset.queryTo = toTime;
  if (date) el.dataset.queryDate = date;
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', `View details for ${escapeHtml(classroom.name)}`);

  if (showFavouriteStar) {
    el.dataset.favStar = '';
    if (isFavourite(classroom.id)) el.classList.add('classroom-card--fav');
  }
  const favStarHtml = showFavouriteStar
    ? `<span class="classroom-card-fav-star" aria-hidden="true">${FILLED_STAR_SVG}</span>`
    : '';

  const buildingLine = building.altName ? `${building.name} · ${building.altName}` : building.name;

  const contentHtml = `
    <div class="classroom-card-content">
      <h4 class="classroom-name" title="${escapeHtml(classroom.name)}">${highlight(classroom.name, query)}</h4>
      <div class="classroom-card-meta-row">
        <p class="classroom-card-building">${t('building.prefix')} ${highlight(buildingLine, query)}</p>
        ${statusLabel ? `<span class="classroom-status-txt ${classroom.status}">${statusLabel}</span>` : ''}
      </div>
    </div>
  `;

  if (hasPhoto) {
    el.dataset.idfoto = classroom.idfoto;
    // If we've already resolved this room's photo URL this session (a previous
    // render of this card, or the detail page), its bytes are almost certainly in
    // the HTTP cache. Render the <img> already pointing at it and already marked
    // `loaded`, so a re-render (filter change, occupancy refresh, favourites
    // update) rebuilds the card without replaying the 0.4s opacity fade — the
    // "blink". Fresh rooms still stream in lazily via the observer.
    const cachedUrl = photoUrlCache.get(classroom.id);
    el.innerHTML = `
      <div class="classroom-card-clip">
        <img class="classroom-card-photo${cachedUrl ? ' loaded' : ''}" alt=""${cachedUrl ? ` src="${escapeHtml(cachedUrl)}"` : ''}>
        <div class="classroom-card-scrim"></div>
        ${contentHtml}
        ${favStarHtml}
      </div>
    `;
    if (cachedUrl) {
      el.querySelector('.classroom-card-photo').onerror = () => el.classList.add('photo-failed');
    } else {
      _photoObserver.observe(el);
    }
  } else {
    el.innerHTML = `<div class="classroom-card-clip">${contentHtml}${favStarHtml}</div>`;
  }

  return el;
}
