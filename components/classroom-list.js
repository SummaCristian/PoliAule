import { t } from '../i18n.js';
import { escapeHtml, highlight } from '../utils/html.js';
import { fetchThumbUrl, thumbUrlCache, markPhotoBroken, isPhotoBroken } from '../utils/photo.js';
import { isFavourite, FILLED_STAR_SVG } from '../utils/favourites.js';
import { createTimeFormatter } from '../utils/time-format.js';
import { getClassroomTimeline } from '../available-rooms-script.js';
import { decorate } from '../utils/season.js';

// ---------- PHOTO ----------

async function _loadCardPhoto(classroomId, card) {
  const img = card.querySelector('.classroom-card-photo');
  const url = await fetchThumbUrl(classroomId);
  const fail = () => {
    markPhotoBroken(classroomId);
    card.classList.add('photo-failed');
  };
  img.onerror = fail;
  img.src = url;
  img.decode().then(() => img.classList.add('loaded')).catch(fail);
}

const _photoObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    _photoObserver.unobserve(entry.target);
    if (entry.target.dataset.idfoto) _loadCardPhoto(Number(entry.target.dataset.openClassroom), entry.target);
  }
}, { rootMargin: '300px' });

// ---------- CARD ----------

// Shorter than the labels elsewhere (search rows, detail page): the card's
// status column is only ~75px wide, and the timeline under it already shows
// when things change, so "soon" becomes the time it happens.
const STATUS_KEYS = {
  'free': 'status.free',
  'partially-free': 'status.partial',
  'occupied': 'status.cardBusy',
  'free-soon': 'status.cardFrom',
  'occupied-soon': 'status.cardUntil',
  'closed': 'status.closed',
};

function _formatTime(hhmm) {
  const d = new Date();
  d.setHours(Number(hhmm.slice(0, 2)), Number(hhmm.slice(3, 5)), 0, 0);
  return createTimeFormatter({ hour: 'numeric', minute: '2-digit' }).format(d);
}

// Short forms for when the full label doesn't fit next to the name (see
// _fitObserver): the soon ones drop to the bare time, the bar shows which way
const SHORT_KEYS = {
  'partially-free': 'status.cardPartialShort',
  'occupied': 'status.cardBusyShort',
};

// { full, short } for the card's label; short is the same as full when there's
// nothing shorter to say
function _statusLabel(status, timeline) {
  const key = STATUS_KEYS[status];
  if (!key) return null;
  if (status === 'free-soon' || status === 'occupied-soon') {
    // No switch time to show (shouldn't happen): fall back to the long label
    if (!timeline?.nextChange) {
      const full = t(status === 'free-soon' ? 'status.freeSoon' : 'status.occupiedSoon');
      return { full, short: full };
    }
    const time = _formatTime(timeline.nextChange);
    return { full: t(key).replace('{time}', time), short: time };
  }
  const full = t(key);
  return { full, short: SHORT_KEYS[status] ? t(SHORT_KEYS[status]) : full };
}

// Fits a card's label next to its name, which depends on both the name's
// length and the card's width: the full label, else the short form, else just
// a dot in the status colour (the timeline under it carries the detail). Only
// a name too long for even the dot gets its label wrapped onto a line of its
// own, which floats the name up, and then in full.
// Watches the card (it resizes with the grid) and the name (it gets a size
// when the card first lays out, cards being content-visibility:auto, and
// changes with a late font swap), never the row itself: the swap changes the
// row's height, and reacting to a size this callback just changed is a
// "ResizeObserver loop" error. "Doesn't fit" is read off the layout itself,
// the label having wrapped below the name, rather than summed from rounded
// widths, which missed labels over by a fraction of a pixel. Each step writes
// every row of the callback before reading them back, one reflow per step.
// Sizes are remembered per element: a list hidden and shown again (the
// building overview does that on every open and close) reports every card at
// 0×0 and then at the size it already had, and neither needs a refit.
// Only cards that are rendered right now are fitted. Reading layout inside a
// card that content-visibility:auto is skipping makes Chrome lay that card out
// on its own, one style+layout pass per card instead of one for the batch (a
// date change rebuilds the whole list, most of it off-screen). A skipped card
// is left pending, its size not remembered, and fitted, together with whatever
// else came into view in the same frame, when its
// contentvisibilityautostatechange says it's no longer skipped. That event
// fires before the frame paints, so the label is right on its first frame.
const _fitSizes = new WeakMap();
const _fitPending = new WeakSet();
const _fitQueue = new Set();

// Asked of the row inside the card: the card itself is never "skipped", it's
// its contents that are
const _isRendered = (card) => {
  const row = _rowOf(card);
  return !row || typeof row.checkVisibility !== 'function' || row.checkVisibility({ contentVisibilityAuto: true });
};

const _fitRows = (rows) => {
  const label = (row) => row.querySelector('.classroom-status-txt');
  const wraps = (row) =>
    label(row).getBoundingClientRect().top >= row.querySelector('.classroom-name').getBoundingClientRect().bottom - 1;

  rows.forEach(r => { const l = label(r); l.classList.remove('is-dot'); l.textContent = l.dataset.full; });
  rows = rows.filter(wraps);
  rows.forEach(r => { const l = label(r); l.textContent = l.dataset.short; });
  rows = rows.filter(wraps);
  rows.forEach(r => { const l = label(r); l.textContent = ''; l.classList.add('is-dot'); });
  // A name that fills the whole row: the label has to wrap anyway, so it may
  // as well say everything on its own line
  rows = rows.filter(wraps);
  rows.forEach(r => { const l = label(r); l.classList.remove('is-dot'); l.textContent = l.dataset.full; });
};

const _rowOf = (card) => card.querySelector('.classroom-card-title-row');

// Cards coming out of the skipped state: fit the ones that were waiting, all
// of this frame's at once
function _flushFitQueue() {
  const rows = [];
  for (const card of _fitQueue) {
    if (!card.isConnected || !_fitPending.has(card) || !_isRendered(card)) continue;
    const row = _rowOf(card);
    if (!row?.querySelector('.classroom-status-txt')) continue;
    _fitPending.delete(card);
    rows.push(row);
  }
  _fitQueue.clear();
  if (rows.length) _fitRows(rows);
}

function _onCardSkipChange(e) {
  if (e.skipped) return;
  const card = e.currentTarget;
  if (!_fitPending.has(card)) return;
  if (!_fitQueue.size) queueMicrotask(_flushFitQueue);
  _fitQueue.add(card);
}

const _fitObserver = new ResizeObserver((entries) => {
  // A card re-rendered away reports in once more on leaving the page: let it go
  for (const e of entries) if (!e.target.isConnected) _fitObserver.unobserve(e.target);
  const cards = new Set();
  for (const e of entries) {
    if (!e.target.isConnected || !e.contentRect.width) continue;
    const card = e.target.closest('.classroom-card');
    if (!card) continue;
    const size = `${e.contentRect.width}x${e.contentRect.height}`;
    if (_fitSizes.get(e.target) === size) continue;
    // Skipped (or inside a hidden list): leave it for when it renders
    if (!_isRendered(card)) { _fitPending.add(card); continue; }
    _fitSizes.set(e.target, size);
    cards.add(card);
  }
  const rows = [...cards].map(_rowOf).filter(r => r?.querySelector('.classroom-status-txt'));
  for (const card of cards) _fitPending.delete(card);
  if (rows.length) _fitRows(rows);
});

// The small timeline under the status: the window as a track, booked time
// filled in the status's busy colour, time the building is closed hatched,
// and a tick at now. Purely visual — the label says the same thing.
function _timelineHtml(timeline) {
  const span = timeline.to - timeline.from;
  const pct = (m) => `${((m - timeline.from) / span * 100).toFixed(2)}%`;
  const seg = (cls, [s, e]) =>
    `<span class="classroom-card-timeline-seg ${cls}" style="left:${pct(s)};width:${((e - s) / span * 100).toFixed(2)}%"></span>`;
  return `
    <div class="classroom-card-timeline" aria-hidden="true">
      <div class="classroom-card-timeline-track">
        ${timeline.closed.map(r => seg('is-closed', r)).join('')}
        ${timeline.busy.map(r => seg('is-busy', r)).join('')}
      </div>
      ${timeline.now !== null ? `<span class="classroom-card-timeline-now" style="left:${pct(timeline.now)}"></span>` : ''}
    </div>
  `;
}

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
//
// showBuilding is optional — pass false where the cards already sit under
// their building's header (Available results, the Campus building page and
// favourite building popup): the building line goes, and the timeline runs
// the card's full width instead.
export function buildCardForClassroom(classroom, building, fromTime = null, toTime = null, isToday = false, date = null, query = '', showFavouriteStar = false, showBuilding = true) {
  const hasPhoto = !!classroom.idfoto;
  // The queried range on its date (Available results), else around now
  const timeline = fromTime && toTime && date
    ? getClassroomTimeline(classroom.id, date.replace(/-/g, ''), fromTime, toTime)
    : getClassroomTimeline(classroom.id);
  const statusLabel = _statusLabel(classroom.status, timeline);

  const el = document.createElement('div');
  el.className = hasPhoto ? 'classroom-card classroom-card--photo' : 'classroom-card classroom-card--plain';
  if (!showBuilding) el.classList.add('classroom-card--no-building');
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

  // Label on the name's row and timeline on the building's, so the name sits
  // right on top of the building line whether or not there's an alt name.
  // .classroom-card-text is the block the photo's fade is hung from (see its
  // ::before in classroom-list.css), so the fade follows its real height.
  const contentHtml = `
    <div class="classroom-card-content">
      <div class="classroom-card-text">
      <div class="classroom-card-title-row">
        <h4 class="classroom-name" title="${escapeHtml(classroom.name)}">${highlight(classroom.name, query)}</h4>
        ${statusLabel ? `<span class="classroom-status-txt ${classroom.status}" data-full="${escapeHtml(statusLabel.full)}" data-short="${escapeHtml(statusLabel.short)}">${escapeHtml(statusLabel.full)}</span>` : ''}
      </div>
      <div class="classroom-card-meta-row">
        ${showBuilding ? `
          <p class="classroom-card-building">
            <span>${t('building.prefix')} ${highlight(building.name, query)}</span>
            ${building.altName ? `<span>${highlight(building.altName, query)}</span>` : ''}
          </p>
        ` : ''}
        ${timeline ? _timelineHtml(timeline) : ''}
      </div>
      </div>
    </div>
  `;

  if (hasPhoto) {
    el.dataset.idfoto = classroom.idfoto;
    // Cards show the thumbnail, never the full photo (see thumbUrl in
    // utils/photo.js). If we've already resolved it this session (a previous
    // render of this card, a search row), its bytes are almost certainly in
    // the HTTP cache. Render the <img> already pointing at it and already marked
    // `loaded`, so a re-render (filter change, occupancy refresh, favourites
    // update) rebuilds the card without replaying the 0.4s opacity fade — the
    // "blink". Fresh rooms still stream in lazily via the observer.
    // A photo that has already failed isn't asked for again (see
    // markPhotoBroken): the card is simply built as a failed one.
    const broken = isPhotoBroken(classroom.id);
    const cachedUrl = broken ? null : thumbUrlCache.get(classroom.id);
    el.innerHTML = `
      <div class="classroom-card-clip">
        <img class="classroom-card-photo${cachedUrl ? ' loaded' : ''}" alt=""${cachedUrl ? ` src="${escapeHtml(cachedUrl)}"` : ''}>
        ${contentHtml}
        ${favStarHtml}
      </div>
    `;
    if (cachedUrl) {
      el.querySelector('.classroom-card-photo').onerror = () => {
        markPhotoBroken(classroom.id);
        el.classList.add('photo-failed');
      };
    } else if (broken) {
      el.classList.add('photo-failed');
    } else {
      _photoObserver.observe(el);
    }
  } else {
    el.innerHTML = `<div class="classroom-card-clip">${contentHtml}${favStarHtml}</div>`;
  }

  if (statusLabel) {
    _fitObserver.observe(el);
    _fitObserver.observe(el.querySelector('.classroom-name'));
    el.addEventListener('contentvisibilityautostatechange', _onCardSkipChange);
  }

  decorate('card', el, classroom);
  return el;
}
