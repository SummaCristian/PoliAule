import { buildCardForClassroom } from './classroom-list.js';
import { getClassroomStatusNow } from '../available-rooms-script.js';
import { getFavouriteIds, initFavouriteMarkers } from '../utils/favourites.js';
import { t } from '../i18n.js';

let _index = null;   // Map<classroomId(number), { classroom, building }>
let _carousel = null;
let _empty = null;
let _container = null;     // #available-classrooms-container
let _expandBtn = null;
let _availableHeader = null;

// Same breakpoint the Available tab uses to switch to two columns
// (see the `@media (min-width: 1100px)` block in style.css).
const _twoCol = window.matchMedia('(min-width: 1100px)');

// The user's choice, remembered per device. It only takes effect in the
// two-column layout and while there is at least one favourite.
const EXPANDED_KEY = 'poliAule_favouritesExpanded';
let _wantsExpanded = false;
let _count = 0;

function _buildIndex(staticData) {
  _index = new Map();
  for (const campus of staticData ?? []) {
    for (const building of campus.buildings ?? []) {
      for (const classroom of building.classrooms ?? []) {
        _index.set(Number(classroom.id), { classroom, building });
      }
    }
  }
}

function _readExpanded() {
  try { return localStorage.getItem(EXPANDED_KEY) === '1'; } catch { return false; }
}

function _writeExpanded(value) {
  try {
    if (value) localStorage.setItem(EXPANDED_KEY, '1');
    else localStorage.removeItem(EXPANDED_KEY);
  } catch { /* storage unavailable: the choice just isn't remembered */ }
}

// Whether the favourites currently fill the left column (the class the CSS
// and components/picker-dock.js key off).
export function isFavouritesExpanded() {
  return !!_container?.classList.contains('favourites-expanded');
}

// Applies the effective state (user choice × desktop × has favourites) and
// shows the toggle only where it means something: on desktop, while the
// collapsed carousel actually overflows (or to collapse it again).
function _sync() {
  if (!_container || !_expandBtn) return;

  const expanded = _wantsExpanded && _twoCol.matches && _count > 0;
  const was = isFavouritesExpanded();
  _container.classList.toggle('favourites-expanded', expanded);

  // Scroll overflow can only be measured on the collapsed carousel.
  const overflows = !expanded && _count > 0 &&
    _carousel.scrollWidth > _carousel.clientWidth + 1;
  _expandBtn.hidden = !(_twoCol.matches && (expanded || overflows));

  const key = expanded ? 'favourites.showLess' : 'favourites.showAll';
  _expandBtn.setAttribute('aria-expanded', String(expanded));
  _expandBtn.dataset.i18nAttr = `aria-label:${key}`;
  _expandBtn.setAttribute('aria-label', t(key));
  const icon = _expandBtn.querySelector('i');
  icon?.classList.toggle('hgi-arrow-expand-01', !expanded);
  icon?.classList.toggle('hgi-arrow-shrink-01', expanded);

  if (expanded !== was) {
    _container.dispatchEvent(new CustomEvent('favouritesexpandchange', { detail: { expanded } }));
  }
}

// (Re)renders the Favourites carousel on the Available page.
export function renderFavourites() {
  if (!_carousel || !_index) return;

  const entries = getFavouriteIds()
    .map(id => _index.get(Number(id)))
    .filter(Boolean);

  _carousel.replaceChildren();
  _count = entries.length;

  if (entries.length === 0) {
    _carousel.hidden = true;
    if (_empty) _empty.hidden = false;
    _sync();
    return;
  }

  for (const { classroom, building } of entries) {
    const card = buildCardForClassroom(
      { ...classroom, status: getClassroomStatusNow(classroom.id) },
      building
    );
    _carousel.appendChild(card);
  }

  _carousel.hidden = false;
  if (_empty) _empty.hidden = true;
  _sync();
}

function _initExpand() {
  _container = document.getElementById('available-classrooms-container');
  _expandBtn = document.getElementById('favourites-expand-btn');
  _availableHeader = _container?.querySelector(':scope > .section-header');
  if (!_container || !_expandBtn) return;

  _wantsExpanded = _readExpanded();

  _expandBtn.addEventListener('click', () => {
    _wantsExpanded = !isFavouritesExpanded();
    _writeExpanded(_wantsExpanded);
    _sync();
    // Collapsing lands the carousel back at its first card.
    if (!_wantsExpanded) _carousel.scrollLeft = 0;
  });

  // Overflow changes with the column width and the cards inside it.
  new ResizeObserver(() => _sync()).observe(_carousel);
  _twoCol.addEventListener('change', _sync);

  // When expanded, the "Available Classrooms" header sits above the results
  // panel in the right column, and the panel and its pickers park below it
  // (style.css). Keep its live height for those offsets.
  if (_availableHeader) {
    const setHeight = () => document.documentElement.style.setProperty(
      '--available-header-height', `${_availableHeader.offsetHeight}px`);
    setHeight();
    new ResizeObserver(setHeight).observe(_availableHeader);
  }
}

export function initFavourites(staticData) {
  _buildIndex(staticData);
  _carousel = document.getElementById('favourites-carousel');
  _empty = document.getElementById('favourites-empty');

  _initExpand();
  initFavouriteMarkers();
  window.addEventListener('favourites-changed', renderFavourites);

  renderFavourites();
}
