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

  // Scroll overflow can only be measured on the collapsed carousel, and not
  // mid-morph: its overflow is clipped then, and Chrome reports no overflow
  // for a clipped box, so the toggle vanished after a collapse. The morph
  // syncs again once it lands.
  if (!_container.classList.contains('favourites-morphing')) {
    const overflows = !expanded && _count > 0 &&
      _carousel.scrollWidth > _carousel.clientWidth + 1;
    _expandBtn.hidden = !(_twoCol.matches && (expanded || overflows));
  }

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
    compact: true,
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

// Every favourite that still exists in the directory, classrooms and
// buildings mixed, in starred order, each with its stable key.
function _entries() {
  return getFavouriteEntries()
    .map(e => {
      const entry = typeof e === 'number' ? _index.get(e) : _buildings.get(e);
      return entry && { ...entry, key: String(e) };
    })
    .filter(Boolean);
}

function _buildEntry(entry) {
  const el = entry.classroom
    ? buildCardForClassroom(
        { ...entry.classroom, status: getClassroomStatusNow(entry.classroom.id) },
        entry.building
      )
    : _buildBuildingFavourite(entry.campusId, entry.building);
  el.dataset.favKey = entry.key;
  return el;
}

// The strip's items, minus any still animating out.
const _items = () => [..._carousel.children].filter(el => !el.classList.contains('fav-leaving'));

function _setEmpty(empty) {
  _carousel.hidden = empty;
  if (_empty) _empty.hidden = !empty;
}

// (Re)renders the Favourites carousel on the Available page from scratch, so
// every card shows fresh status (called again once occupancy data lands).
export function renderFavourites() {
  if (!_carousel || !_index) return;
  _finishListAnimation();

  const entries = _entries();
  _carousel.replaceChildren(...entries.map(_buildEntry));
  _count = entries.length;
  _setEmpty(entries.length === 0);
  _sync();
}

// ── Add / remove animation ────────────────────────────────────────────────
// A favourite can be starred or unstarred while the strip is on screen (a
// building header's star, the building popup, the detail page), so the strip
// updates in place rather than re-rendering: cards that stay are kept (and
// glide to their new place, FLIP), new ones pop in, removed ones shrink away
// where they stood. Going from none to some (or back) also grows or shrinks
// the section, with the empty-state line cross-fading against the strip.

const ENTER = { duration: 380, easing: 'cubic-bezier(0.34, 1.35, 0.64, 1)' };
const LEAVE = { duration: 220, easing: 'cubic-bezier(0.4, 0, 1, 1)' };

let _listAnims = [];
let _listDone = null;

// Snaps whatever the last add/remove was still doing to its end state.
function _finishListAnimation() {
  const done = _listDone;
  _listDone = null;
  _listAnims.forEach(a => a.cancel());
  _listAnims = [];
  done?.();
}

function _onFavouritesChanged() {
  if (!_carousel || !_index) return;
  const entries = _entries();
  const wasExpanded = isFavouritesExpanded();
  const willExpand = _wantsExpanded && _twoCol.matches && entries.length > 0;

  // The last favourite gone from the expanded grid: the whole layout
  // changes back, which is the expand/collapse morph's job.
  if (wasExpanded !== willExpand && !_reduceMotion.matches) {
    _finishListAnimation();
    _morph(() => { _reconcile(entries); _setEmpty(entries.length === 0); _sync(); });
    return;
  }
  if (_reduceMotion.matches) {
    _finishListAnimation();
    _reconcile(entries);
    _setEmpty(entries.length === 0);
    _sync();
    return;
  }
  _animateTo(entries);
}

// Brings the strip's children in line with `entries`, reusing the element of
// every key that stays. Returns the elements added and removed.
function _reconcile(entries) {
  const byKey = new Map(_items().map(el => [el.dataset.favKey, el]));
  const keep = new Set(entries.map(e => e.key));
  const left = [...byKey].filter(([key]) => !keep.has(key)).map(([, el]) => el);
  const entered = [];
  const next = entries.map(entry => {
    const el = byKey.get(entry.key);
    if (el) return el;
    const fresh = _buildEntry(entry);
    entered.push(fresh);
    return fresh;
  });
  left.forEach(el => el.remove());
  // Only moves what is out of place, so a card never leaves the DOM for
  // nothing (it would lose its photo and scroll-snap state).
  next.forEach((el, i) => {
    if (_carousel.children[i] !== el) _carousel.insertBefore(el, _carousel.children[i] ?? null);
  });
  _count = entries.length;
  return { entered, left };
}

function _animateTo(entries) {
  _finishListAnimation();
  _stopMorph();

  const section = _carousel.closest('.favourites-section');
  const wasEmpty = _carousel.hidden;
  const willBeEmpty = entries.length === 0;

  // Before: every card's place (screen, for the glide; in the strip, for a
  // leaving card to stay put), and the section's height.
  const before = new Map();
  for (const el of _items()) {
    before.set(el, {
      rect: el.getBoundingClientRect(),
      box: { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight },
    });
  }
  const sectionBefore = section?.getBoundingClientRect();
  const stripHeight = _carousel.offsetHeight;

  const { entered, left } = _reconcile(entries);
  if (!entered.length && !left.length) {
    _sync();
    return;
  }

  // Leaving cards go back in, out of flow, exactly where they were.
  for (const el of left) {
    const { box } = before.get(el);
    el.classList.add('fav-leaving');
    el.removeAttribute('data-fav-building-folder');
    el.inert = true;
    Object.assign(el.style, {
      position: 'absolute', margin: '0',
      left: `${box.left}px`, top: `${box.top}px`,
      width: `${box.width}px`, height: `${box.height}px`,
    });
    _carousel.appendChild(el);
  }

  // The section only changes size on the way in or out of empty; the last
  // card leaves first, then the strip collapses.
  const resize = wasEmpty !== willBeEmpty;
  if (resize && !willBeEmpty) _setEmpty(false);
  // Out of flow, the last card would take the strip's height with it at
  // once: hold it until the card is gone.
  if (resize && willBeEmpty) _carousel.style.minHeight = `${stripHeight}px`;
  _sync();

  const anims = [];
  for (const el of _items()) {
    const b = before.get(el);
    if (!b) continue;
    const a = el.getBoundingClientRect();
    const dx = b.rect.left - a.left, dy = b.rect.top - a.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    anims.push(el.animate({ translate: [`${dx}px ${dy}px`, '0 0'] }, _spring));
  }
  entered.forEach((el, i) => {
    anims.push(el.animate(
      { opacity: [0, 1], scale: [0.8, 1] },
      { ...ENTER, delay: (left.length ? 90 : 0) + i * 40, fill: 'backwards' }
    ));
  });
  const leaving = left.map(el => el.animate({ opacity: [1, 0], scale: [1, 0.8] }, { ...LEAVE, fill: 'forwards' }));
  anims.push(...leaving);
  if (resize && !willBeEmpty && section) anims.push(..._resizeSection(section, sectionBefore, 'in'));

  // A single new card off the side of the strip: bring it into view.
  if (entered.length === 1 && !isFavouritesExpanded() && _onScreen(section)) {
    const el = entered[0];
    const view = { left: _carousel.scrollLeft, right: _carousel.scrollLeft + _carousel.clientWidth };
    if (el.offsetLeft < view.left || el.offsetLeft + el.offsetWidth > view.right) {
      _carousel.scrollTo({ left: el.offsetLeft - (_carousel.clientWidth - el.offsetWidth) / 2, behavior: 'smooth' });
    }
  }

  // The end state, reached either by the animations below or at once by
  // _finishListAnimation (a newer change, or a full re-render).
  const finish = () => {
    left.forEach(el => el.remove());
    _carousel.style.minHeight = '';
    if (resize && willBeEmpty) _setEmpty(true);
    _sync();
  };
  _listAnims = anims;
  _listDone = finish;
  const current = () => _listDone === finish;

  (async () => {
    await Promise.allSettled(leaving.map(a => a.finished));
    if (!current()) return;
    left.forEach(el => el.remove());
    // Now empty: the strip gives way to the empty-state line.
    if (resize && willBeEmpty && section) {
      const from = section.getBoundingClientRect();
      _carousel.style.minHeight = '';
      _setEmpty(true);
      _listAnims.push(..._resizeSection(section, from, 'out'));
    }
    await Promise.allSettled(_listAnims.map(a => a.finished));
    if (!current()) return;
    _listDone = null;
    _listAnims = [];
    finish();
  })();
}

const _onScreen = (el) => {
  const r = el?.getBoundingClientRect();
  return !!r && r.bottom > 0 && r.top < window.innerHeight;
};

// Grows or shrinks the section from `from` (its rect before the change) to
// its new height. Off screen above, it doesn't animate: the page is scrolled
// by the difference instead, so what is on screen stays where it is (Chrome
// anchors scrolling on its own; Safari doesn't).
function _resizeSection(section, from, direction) {
  const to = section.getBoundingClientRect();
  if (Math.abs(to.height - from.height) < 1) return [];
  if (from.bottom <= 0) {
    const moved = to.top - from.top;   // what scroll anchoring already did
    const delta = to.height - from.height;
    if (Math.abs(moved + delta) > 1 && Math.abs(moved) < 1) window.scrollBy(0, delta);
    return [];
  }
  const anims = [section.animate(
    { height: [`${from.height}px`, `${to.height}px`] },
    { duration: _spring.duration, easing: _spring.easing }
  )];
  if (_empty) {
    anims.push(direction === 'in'
      ? _carousel.animate({ opacity: [0, 1] }, { duration: 200, fill: 'backwards' })
      : _empty.animate({ opacity: [0, 1] }, { duration: 240, delay: 60, fill: 'backwards' }));
  }
  return anims;
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
  done.then(() => {
    if (_morphDone !== done) return;
    _stopMorph();
    _sync();
  }, () => {});
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
  window.addEventListener('favourites-changed', _onFavouritesChanged);

  renderFavourites();
}
