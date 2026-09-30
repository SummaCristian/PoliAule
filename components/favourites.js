import { buildCardForClassroom } from './classroom-list.js';
import { getClassroomStatusNow } from '../available-rooms-script.js';
import { getFavouriteEntries, initFavouriteMarkers, buildingKey } from '../utils/favourites.js';
import { buildBuildingFolder, pickFolderRooms } from './building-folder.js';
import { openBuildingPopup } from './building-popup.js';
import { t } from '../i18n.js';
import { escapeHtml } from '../utils/html.js';

let _index = null;   // Map<classroomId(number), { classroom, building }>
let _buildings = null;   // Map<buildingKey, { campusId, building }>
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
  _buildings = new Map();
  for (const campus of staticData ?? []) {
    for (const building of campus.buildings ?? []) {
      _buildings.set(buildingKey(campus.id, building.name), { campusId: campus.id, building });
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

// How many of the building's rooms are free right now and how many aren't, as
// the overview's status pills (.bo-count, building-overview.css). "Now" like
// every other favourite. Closed or without data, it says so instead.
function _nowCountsHtml(rooms) {
  let free = 0, busy = 0;
  for (const { status } of rooms) {
    if (status === 'free' || status === 'occupied-soon') free++;
    else if (status === 'occupied' || status === 'free-soon') busy++;
  }
  if (free + busy === 0) {
    return rooms.some(r => r.status === 'closed')
      ? `<span class="bo-count is-zero">${escapeHtml(t('status.closed'))}</span>`
      : '';
  }
  const pill = (cls, n, key) => `<span class="bo-count ${cls}${n === 0 ? ' is-zero' : ''}">
      <i aria-hidden="true"></i><b>${n}</b><span class="bo-count-label">${escapeHtml(t(key))}</span>
    </span>`;
  return `<div class="bo-card-counts">${pill('free', free, 'status.free')}${pill('occupied', busy, 'status.occupied')}</div>`;
}

// A favourite building: its folder (components/building-folder.js), which
// opens into the building popup (components/building-popup.js).
function _buildBuildingFavourite(campusId, building) {
  const rooms = building.classrooms.map(classroom => ({ classroom, status: getClassroomStatusNow(classroom.id) }));
  const folder = buildBuildingFolder({
    campusId, building,
    total: building.classrooms.length,
    rooms: pickFolderRooms(rooms),
    footerHtml: _nowCountsHtml(rooms),
  });
  const key = buildingKey(campusId, building.name);
  folder.classList.add('fav-building');
  folder.dataset.favBuildingFolder = key;
  folder.setAttribute('role', 'button');
  folder.setAttribute('tabindex', '0');
  folder.setAttribute('aria-haspopup', 'dialog');
  folder.setAttribute('aria-label', `${t('building.prefix')} ${building.name}`);

  const open = () => openBuildingPopup({
    campusId, building, folder,
    findTrigger: () => _carousel?.querySelector(`[data-fav-building-folder="${CSS.escape(key)}"]`) ?? null,
  });
  folder.addEventListener('click', open);
  folder.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });
  return folder;
}

// (Re)renders the Favourites carousel on the Available page.
export function renderFavourites() {
  if (!_carousel || !_index) return;

  // Classrooms and buildings, mixed, in the order they were starred.
  const entries = getFavouriteEntries()
    .map(e => (typeof e === 'number' ? _index.get(e) : _buildings.get(e)))
    .filter(Boolean);

  _carousel.replaceChildren();
  _count = entries.length;

  if (entries.length === 0) {
    _carousel.hidden = true;
    if (_empty) _empty.hidden = false;
    _sync();
    return;
  }

  for (const entry of entries) {
    if (entry.classroom) {
      const { classroom, building } = entry;
      _carousel.appendChild(buildCardForClassroom(
        { ...classroom, status: getClassroomStatusNow(classroom.id) },
        building
      ));
    } else {
      _carousel.appendChild(_buildBuildingFavourite(entry.campusId, entry.building));
    }
  }

  _carousel.hidden = false;
  if (_empty) _empty.hidden = true;
  _sync();
}

// ── Expand / collapse morph ───────────────────────────────────────────────
// Everything that moves glides from where it was to where the new layout puts
// it (FLIP): the favourite cards between the strip and the grid, and the
// results panel within its column. The "Available" header and the pickers,
// which change column (and the pickers their form: panels <-> pills), don't
// travel: gliding, they'd cross the cards of both columns. They fade in where
// they land. Cards that are off the strip on the collapsed side fade instead
// of popping.
//
// Web Animations on translate/scale only, so the whole thing runs on the
// compositor: a main-thread spring restyling ~20 cards every frame ran at
// half the frame rate. The spring survives as the easing — sampled into a
// CSS linear() curve.

const _reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const MORPH_SPRING = { stiffness: 240, damping: 30, mass: 1 };  // ~critically damped
const FADE = { duration: 260, easing: 'cubic-bezier(0.2, 0, 0, 1)' };

// A spring from 0 to 1, as a linear() easing plus the duration it takes to
// settle.
function _springEasing({ stiffness, damping, mass }) {
  const dt = 1 / 240;
  let x = 0, v = 0, t = 0;
  const samples = [0];
  while (t < 3 && (Math.abs(1 - x) > 0.001 || Math.abs(v) > 0.01)) {
    v += ((stiffness * (1 - x) - damping * v) / mass) * dt;
    x += v * dt;
    t += dt;
    samples.push(x);
  }
  samples[samples.length - 1] = 1;
  // ~60 stops are plenty for a smooth curve.
  const step = Math.max(1, Math.round(samples.length / 60));
  const stops = samples.filter((_, i) => i % step === 0 || i === samples.length - 1);
  return {
    duration: Math.round(t * 1000),
    easing: `linear(${stops.map(v => +v.toFixed(4)).join(', ')})`,
  };
}
const _spring = CSS.supports('animation-timing-function', 'linear(0, 1)')
  ? _springEasing(MORPH_SPRING)
  : { duration: 450, easing: 'cubic-bezier(0.2, 0.9, 0.1, 1)' };

let _running = [];   // this morph's animations
let _morphDone = null;

function _stopMorph() {
  _running.forEach(a => a.cancel());
  _running = [];
  _morphDone = null;
  _container.classList.remove('favourites-morphing');
}

function _morph(apply) {
  if (_reduceMotion.matches) {
    _stopMorph();
    apply();
    return;
  }

  const header = _availableHeader;
  const form = document.getElementById('available-classrooms-form');
  const results = document.getElementById('available-classrooms-results');
  const cards = [..._carousel.children];

  // Cards change size too (strip <-> grid tracks): they scale as well.
  const targets = [
    ...cards.map(el => ({ el, scale: true })),
    // The panel, and its content on its own: the pills' padding shifts the
    // list inside the panel as well.
    results && { el: results },
    ...[...(results?.children ?? [])].map(el => ({ el, parent: results })),
  ].filter(Boolean);

  // Which cards the collapsed strip actually shows (the rest are scrolled
  // out of it, under its edge fade).
  const onStrip = () => {
    const strip = _carousel.getBoundingClientRect();
    return new Set(cards.filter(el => {
      const r = el.getBoundingClientRect();
      return r.right > strip.left && r.left < strip.right;
    }));
  };
  const collapsing = isFavouritesExpanded();
  let shown = collapsing ? null : onStrip();

  // Measured with any running morph still applied, so a second click
  // mid-flight picks up from where things visibly are.
  for (const t of targets) t.before = t.el.getBoundingClientRect();

  _stopMorph();
  apply();
  if (collapsing) shown = onStrip();
  // Unclipped strip while cards fly in and out of it. Only now: dropping its
  // overflow earlier would have thrown away the scroll position the cards
  // were measured at.
  _container.classList.add('favourites-morphing');

  const delta = new Map();
  for (const t of targets) {
    const a = t.before, b = t.el.getBoundingClientRect();
    // Centre to centre, so a scaled card grows about its middle.
    const d = {
      x: (a.left + a.width / 2) - (b.left + b.width / 2),
      y: (a.top + a.height / 2) - (b.top + b.height / 2),
      sx: t.scale && b.width ? a.width / b.width : 1,
      sy: t.scale && b.height ? a.height / b.height : 1,
    };
    delta.set(t.el, d);
    // A child rides along with its parent's glide; it only adds its own.
    const p = t.parent && delta.get(t.parent);
    const x = d.x - (p?.x ?? 0), y = d.y - (p?.y ?? 0);
    if (Math.abs(x) < 0.5 && Math.abs(y) < 0.5 && d.sx === 1 && d.sy === 1) continue;
    const frames = { translate: [`${x}px ${y}px`, '0 0'] };
    if (t.scale) frames.scale = [`${d.sx} ${d.sy}`, '1 1'];
    _running.push(t.el.animate(frames, _spring));
  }

  // Cards the strip doesn't show fade instead of flying in from (or out to)
  // somewhere off its edge; the header and pickers fade in, in place.
  for (const el of cards) {
    if (shown.has(el)) continue;
    _running.push(collapsing
      ? el.animate({ opacity: [1, 0] }, { ...FADE, duration: 200, fill: 'forwards' })
      : el.animate({ opacity: [0, 1] }, { ...FADE, delay: 60, fill: 'backwards' }));
  }
  for (const el of [header, form]) {
    if (!el) continue;
    _running.push(el.animate(
      { opacity: [0, 1], scale: [0.96, 1] },
      { ...FADE, duration: 320, delay: el === form ? 160 : 120, fill: 'backwards' }
    ));
  }

  const done = Promise.all(_running.map(a => a.finished));
  _morphDone = done;
  done.then(() => { if (_morphDone === done) _stopMorph(); }, () => {});
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
    _morph(() => {
      _sync();
      // Collapsing lands the carousel back at its first card.
      if (!_wantsExpanded) _carousel.scrollLeft = 0;
    });
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
