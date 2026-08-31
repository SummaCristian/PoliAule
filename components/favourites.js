import { buildCardForClassroom } from './classroom-list.js';
import { getClassroomStatusNow } from '../available-rooms-script.js';
import { getFavouriteIds, initFavouriteMarkers } from '../utils/favourites.js';

let _index = null;   // Map<classroomId(number), { classroom, building }>
let _carousel = null;
let _empty = null;

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

// (Re)renders the Favourites carousel on the Available page.
export function renderFavourites() {
  if (!_carousel || !_index) return;

  const entries = getFavouriteIds()
    .map(id => _index.get(Number(id)))
    .filter(Boolean);

  _carousel.replaceChildren();

  if (entries.length === 0) {
    _carousel.hidden = true;
    if (_empty) _empty.hidden = false;
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
}

export function initFavourites(staticData) {
  _buildIndex(staticData);
  _carousel = document.getElementById('favourites-carousel');
  _empty = document.getElementById('favourites-empty');

  initFavouriteMarkers();
  window.addEventListener('favourites-changed', renderFavourites);

  renderFavourites();
}
