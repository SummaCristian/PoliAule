import { t } from '../i18n.js';
import { escapeHtml } from '../utils/html.js';
import { fetchPhotoUrl } from '../utils/photo.js';

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
    if (entry.target.dataset.idfoto) _loadCardPhoto(entry.target.dataset.openClassroom, entry.target);
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
export function buildCardForClassroom(classroom, building, fromTime = null, toTime = null, isToday = false, date = null) {
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

  const contentHtml = `
    <div class="classroom-card-content">
      <h4 class="classroom-name" title="${escapeHtml(classroom.name)}">${escapeHtml(classroom.name)}</h4>
      <div class="classroom-card-meta-row">
        <p class="classroom-card-building">${t('building.prefix')} ${escapeHtml(building.name)}${building.altName ? ` · ${escapeHtml(building.altName)}` : ''}</p>
        ${statusLabel ? `<span class="classroom-status-txt ${classroom.status}">${statusLabel}</span>` : ''}
      </div>
    </div>
  `;

  if (hasPhoto) {
    el.dataset.idfoto = classroom.idfoto;
    el.innerHTML = `
      <div class="classroom-card-clip">
        <img class="classroom-card-photo" alt="">
        <div class="classroom-card-scrim"></div>
        ${contentHtml}
      </div>
    `;
    _photoObserver.observe(el);
  } else {
    el.innerHTML = `<div class="classroom-card-clip">${contentHtml}</div>`;
  }

  return el;
}
