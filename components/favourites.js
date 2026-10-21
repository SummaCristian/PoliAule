import { buildCardForClassroom } from './classroom-list.js';
import { getClassroomStatusNow } from '../available-rooms-script.js';
import { getFavouriteEntries, setFavouriteEntries, initFavouriteMarkers, buildingKey } from '../utils/favourites.js';
import { buildBuildingFolder, pickFolderRooms } from './building-folder.js';
import { openBuildingPopup } from './building-popup.js';
import { t } from '../i18n.js';
import { escapeHtml } from '../utils/html.js';
import { springEasing } from '../utils/spring-easing.js';
import { ownBack } from '../utils/back-stack.js';
import { announce } from '../utils/announce.js';
import { initFavouritesDrag, setFavouritesDragEnabled, isFavouritesDragging, cancelFavouritesDrag } from './favourites-drag.js';

let _index = null;   // Map<classroomId(number), { classroom, building }>
let _buildings = null;   // Map<buildingKey, { campusId, building }>
let _carousel = null;
let _empty = null;
let _container = null;     // #available-classrooms-container
let _expandBtn = null;
let _availableHeader = null;
let _editBtn = null;
let _editing = false;   // edit mode is on (the session, `_edit`, is below)
let _edit = null;       // the edit session, or null

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

  // Editing needs the grid, so on desktop it expands the strip whatever the
  // user's choice (which it leaves alone, to go back to). The toggle itself
  // gives way to the edit buttons as a group (see _swapActions).
  const expanded = (_wantsExpanded || _editing) && _twoCol.matches && _count > 0;
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
  if (_editBtn) _editBtn.hidden = _count === 0;

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

// The entries for these keys (a classroom's id or a building's key, as
// strings), skipping any that no longer exist in the directory.
function _entriesOf(keys) {
  return keys
    .map(key => {
      const entry = key.includes(':') ? _buildings.get(key) : _index.get(Number(key));
      return entry && { ...entry, key };
    })
    .filter(Boolean);
}

// Every favourite that still exists in the directory, classrooms and
// buildings mixed, in starred order, each with its stable key.
function _entries() {
  return _entriesOf(getFavouriteEntries().map(String));
}

// What the strip shows: the stored list, or while editing the session's
// working list (which only reaches storage when the edit is confirmed).
const _currentEntries = () => _edit ? _entriesOf(_edit.history[_edit.cursor]) : _entries();

function _buildEntry(entry) {
  const el = entry.classroom
    ? buildCardForClassroom(
        { ...entry.classroom, status: getClassroomStatusNow(entry.classroom.id) },
        entry.building
      )
    : _buildBuildingFavourite(entry.campusId, entry.building);
  el.dataset.favKey = entry.key;
  if (_editing) _addEditChrome(el);
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
  // A rebuild would pull the card out of the hand: after it has landed
  if (isFavouritesDragging()) { _refreshAfterDrag = true; return; }
  _finishListAnimation();

  // A rebuild takes the focus with it
  const focused = _carousel.contains(document.activeElement) ? document.activeElement.closest('[data-fav-key]')?.dataset.favKey : null;
  const entries = _currentEntries();
  _carousel.replaceChildren(...entries.map(_buildEntry));
  _count = entries.length;
  _setEmpty(entries.length === 0);
  _sync();
  if (focused != null) _itemByKey(focused)?.focus({ preventScroll: true });
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
let _refreshAfterDrag = false;   // a refresh asked for while a card was being dragged

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
  cancelFavouritesDrag();
  if (_edit) {
    // The session's own commit: the strip already shows it.
    if (_edit.committing) return;
    // Anything else changed the list under the edit: it carries on from there.
    _rebase();
    if (!_entriesOf(_edit.history[_edit.cursor]).length) { _exitEdit({ commit: true }); return; }
    _show(_currentEntries());
    return;
  }
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

// Where a card is on screen, not counting its wiggle (a rotated card's
// bounding box swings with the angle): its layout place plus whatever glide is
// running on it. Read before an interrupted glide is cancelled, it is where the
// card visibly is, so the next one starts from there.
function _place(el, origin) {
  const [x = 0, y = 0] = getComputedStyle(el).translate.split(' ').map(parseFloat);
  return { left: origin.left + el.offsetLeft - _carousel.scrollLeft + (x || 0), top: origin.top + el.offsetTop - _carousel.scrollTop + (y || 0) };
}

// Resolves once the animation has landed.
function _animateTo(entries) {
  const section = _carousel.closest('.favourites-section');
  const willBeEmpty = entries.length === 0;

  // Before: every card's place (screen, for the glide; in the strip, for a
  // leaving card to stay put), and the section's height.
  const originBefore = _carousel.getBoundingClientRect();
  const order = _items();
  const before = new Map();
  for (const el of order) {
    before.set(el, {
      place: _place(el, originBefore),
      box: { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight },
    });
  }
  _finishListAnimation();
  _stopMorph();
  const wasEmpty = _carousel.hidden;
  const sectionBefore = section?.getBoundingClientRect();
  const stripHeight = _carousel.offsetHeight;

  const { entered, left } = _reconcile(entries);
  // Cards that only changed places glide too (a reorder)
  const reordered = _items().some((el, i) => el !== order[i]);
  if (!entered.length && !left.length && !reordered) {
    _sync();
    return Promise.resolve();
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
  const origin = _carousel.getBoundingClientRect();
  for (const el of _items()) {
    const b = before.get(el);
    if (!b) continue;
    const a = _place(el, origin);
    const dx = b.place.left - a.left, dy = b.place.top - a.top;
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

  return (async () => {
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
// Below 1100px nothing changes column: the strip morphs into the edit mode's
// wrapping grid in place, and what sits under the section (the header, the
// pickers, the results) glides down with it instead of fading in.
//
// Web Animations on translate/scale only, so the whole thing runs on the
// compositor: a main-thread spring restyling ~20 cards every frame ran at
// half the frame rate. The spring survives as the easing — sampled into a
// CSS linear() curve.

const _reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const MORPH_SPRING = { stiffness: 240, damping: 30, mass: 1 };  // ~critically damped
const FADE = { duration: 260, easing: 'cubic-bezier(0.2, 0, 0, 1)' };

const _spring = springEasing(MORPH_SPRING);

let _running = [];   // this morph's animations
let _morphDone = null;

function _stopMorph() {
  _running.forEach(a => a.cancel());
  _running = [];
  _morphDone = null;
  _container.classList.remove('favourites-morphing');
}

// Whether the favourites are laid out as a grid rather than the strip: the
// desktop's expanded column, or the edit mode's grid on any width.
const _gridLayout = () => isFavouritesExpanded() || !!_container?.classList.contains('favourites-editing');

// `apply()` switches the layout. It may return the cards it added, which pop in
// (a cancelled edit bringing back what was removed in it).
function _morph(apply) {
  if (_reduceMotion.matches) {
    _stopMorph();
    apply();
    return;
  }
  const wide = _twoCol.matches;

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
    ...(wide ? [] : [header, form].filter(Boolean).map(el => ({ el }))),
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
  const collapsing = _gridLayout();
  let shown = collapsing ? null : onStrip();

  // Measured with any running morph still applied, so a second click
  // mid-flight picks up from where things visibly are.
  // A card's size is its layout box, not its bounding box: while editing the
  // cards wiggle, and a rotated card's bounding box is a little larger.
  for (const t of targets) {
    t.before = t.el.getBoundingClientRect();
    if (t.scale) t.size = { w: t.el.offsetWidth, h: t.el.offsetHeight };
  }

  _stopMorph();
  const entered = apply() ?? [];
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
      sx: t.scale && t.el.offsetWidth ? t.size.w / t.el.offsetWidth : 1,
      sy: t.scale && t.el.offsetHeight ? t.size.h / t.el.offsetHeight : 1,
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
  for (const el of entered) {
    _running.push(el.animate({ opacity: [0, 1], scale: [0.8, 1] }, { ...ENTER, delay: 60, fill: 'backwards' }));
  }
  for (const el of wide ? [header, form] : []) {
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

// ── Edit mode ─────────────────────────────────────────────────────────────
// The pencil in the header turns the strip into a wrapping grid (on desktop,
// the expanded column) where the cards wiggle, a (−) badge removes one, and
// Alt+arrows move the focused one. Nothing is written to storage until the
// edit is confirmed: the changes are made on a working list, the session, and
// every finished gesture pushes a snapshot of it, so undo and redo are a walk
// back and forth through the snapshots.
//
// Leaving by cancel (or Escape) drops the working list; every other way out
// (the tick, Back, another tab, the search, the page going away, the last
// favourite removed) keeps it. A change made outside the edit meanwhile (a
// star toggled in the results, a transfer import) is written as usual and
// carried into the session (_rebase), so neither Cancel nor Done undoes it.
//
// The session, for the code that drags cards around (all keys are strings: a
// classroom's id, or a building's key):
//   isFavouritesEditing()                 whether it is on
//   getFavouritesEditList()               a copy of the working list
//   setFavouritesEditList(keys, opts)     the next step: a new snapshot (the
//                                         redo steps after the cursor are
//                                         dropped). The strip glides to it,
//                                         unless `opts.animate` is false
//                                         because the caller has put the
//                                         cards in that order already.
//   undoFavouritesEdit / redoFavouritesEdit   move the cursor, the strip glides
//   exitFavouritesEdit({ commit })        the tick (commit) or the cross
// It never goes through `favourites-changed`: the only event it causes is the
// one of its own commit, which it ignores.

const _editBack = ownBack(({ uaAnimated }) => _exitEdit({ commit: true, animate: !uaAnimated }));

export function isFavouritesEditing() {
  return !!_edit;
}

export function getFavouritesEditList() {
  return _edit ? [..._edit.history[_edit.cursor]] : [];
}

const _same = (a, b) => a.length === b.length && a.every((k, i) => k === b[i]);

// A key back to what the store holds: a classroom's id as a number.
const _valueOf = (key) => key.includes(':') ? key : Number(key);

const _itemByKey = (key) => _items().find(el => el.dataset.favKey === key) ?? null;

// Shows a list on the strip: glides there, or just lands when motion is reduced.
function _show(entries) {
  if (_reduceMotion.matches) {
    _finishListAnimation();
    _reconcile(entries);
    _setEmpty(entries.length === 0);
    _sync();
    return Promise.resolve();
  }
  return _animateTo(entries);
}

function _syncEditUi() {
  if (!_edit) return;
  document.getElementById('favourites-undo-btn')?.setAttribute('aria-disabled', String(_edit.cursor === 0));
  document.getElementById('favourites-redo-btn')?.setAttribute('aria-disabled', String(_edit.cursor === _edit.history.length - 1));
}

export function setFavouritesEditList(keys, { animate = true } = {}) {
  const s = _edit;
  if (!s) return false;
  const next = [...new Set(keys.map(String))];
  if (_same(next, s.history[s.cursor])) return false;
  s.history.length = s.cursor + 1;
  s.history.push(next);
  s.cursor++;
  _syncEditUi();

  const entries = _entriesOf(next);
  // Nothing left to edit: that is the end of it (the last card then leaves
  // the strip the usual way, as the commit is written).
  if (!entries.length) { _exitEdit({ commit: true }); return true; }
  if (animate) _show(entries);
  else { _reconcile(entries); _sync(); }
  return true;
}

function _step(delta, messageKey) {
  const s = _edit;
  if (!s) return;
  cancelFavouritesDrag();
  const to = s.cursor + delta;
  if (to < 0 || to >= s.history.length) return;
  s.cursor = to;
  _syncEditUi();
  _show(_entriesOf(s.history[to]));
  announce(t(messageKey));
}

export const undoFavouritesEdit = () => _step(-1, 'favourites.undone');
export const redoFavouritesEdit = () => _step(1, 'favourites.redone');

// Carries a change made outside the edit into the session.
function _rebase() {
  const s = _edit;
  const stored = getFavouriteEntries().map(String);
  const was = new Set(s.base), now = new Set(stored);
  const removed = new Set([...was].filter(k => !now.has(k)));
  const added = stored.filter(k => !was.has(k));
  const carry = (keys) => [...new Set([...keys.filter(k => !removed.has(k)), ...added])];

  // Steps that differed only by what was removed are one step now
  const history = [], at = [];
  s.history.map(carry).forEach((snap, i) => {
    if (i === 0) snap = [...stored];
    if (history.length && _same(history.at(-1), snap)) at.push(history.length - 1);
    else { history.push(snap); at.push(history.length - 1); }
  });
  s.history = history;
  s.cursor = at[s.cursor];
  s.base = stored;
  _syncEditUi();
}

// A hash that spreads the cards' wiggles out of step with each other.
function _jitter(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h;
}

function _nameOf(key) {
  const entry = _entriesOf([key])[0];
  if (!entry) return key;
  return entry.classroom ? entry.classroom.name : `${t('building.prefix')} ${entry.building.name}`;
}

// What an item carries while it is being edited: its wiggle's phase and speed
// (the wiggle itself is CSS, favourites.css) and the badge that removes it.
function _addEditChrome(el) {
  if (el.querySelector(':scope > .fav-remove')) return;
  const h = _jitter(el.dataset.favKey);
  el.style.setProperty('--fav-wiggle-delay', `${-(h % 280)}ms`);
  el.style.setProperty('--fav-wiggle-dur', `${250 + (h >> 4) % 90}ms`);

  const badge = document.createElement('button');
  badge.type = 'button';
  // A finger-sized button around a small glass disc: the disc alone was too
  // small to hit reliably.
  badge.className = 'fav-remove';
  badge.setAttribute('aria-label', t('favourites.removeItem').replace('{name}', _nameOf(el.dataset.favKey)));
  badge.innerHTML = '<span class="fav-remove-glass header-button lg-ring liquid-glass" aria-hidden="true"><i class="hgi-stroke hgi-minus-sign"></i></span>';
  badge.addEventListener('click', (e) => {
    // Not the card's own click: it would open it.
    e.stopPropagation();
    const key = el.dataset.favKey;
    const siblings = _items();
    const next = siblings[siblings.indexOf(el) + 1] ?? siblings[siblings.indexOf(el) - 1];
    setFavouritesEditList(getFavouritesEditList().filter(k => k !== key));
    // From the keyboard, focus carries on at the neighbour instead of vanishing with the card
    if (e.detail === 0) next?.focus({ preventScroll: true });
  });
  el.appendChild(badge);
}

function _removeEditChrome(animate) {
  for (const badge of _carousel.querySelectorAll('.fav-remove')) {
    if (!animate || _reduceMotion.matches) { badge.remove(); continue; }
    badge.inert = true;
    badge.animate({ opacity: [1, 0], scale: [1, 0.4] }, { ...LEAVE, fill: 'forwards' }).finished.then(() => badge.remove(), () => {});
  }
  for (const el of _carousel.children) {
    el.style.removeProperty('--fav-wiggle-delay');
    el.style.removeProperty('--fav-wiggle-dur');
  }
}

// The header's two button sets trade places: the one leaving fades and shrinks
// out of the flow (so the arriving one has the row to itself), the arriving
// one's buttons pop in one after another.
let _swapToken = 0;
function _swapActions(editing, animate) {
  const main = document.getElementById('favourites-actions-main');
  const edit = document.getElementById('favourites-actions-edit');
  if (!main || !edit) return;
  const [out, inn] = editing ? [main, edit] : [edit, main];
  const token = ++_swapToken;

  // A swap still running ends where it was going
  for (const el of [main, edit]) {
    el.getAnimations().forEach(a => a.cancel());
    el.classList.remove('is-leaving');
  }
  inn.hidden = false;
  if (!animate || _reduceMotion.matches) {
    out.hidden = true;
    return;
  }
  out.classList.add('is-leaving');
  out.animate({ opacity: [1, 0], scale: [1, 0.85] }, { ...LEAVE, fill: 'forwards' }).finished.then(() => {
    if (token !== _swapToken) return;
    out.hidden = true;
    out.classList.remove('is-leaving');
    out.getAnimations().forEach(a => a.cancel());
  }, () => {});
  [...inn.children].filter(el => !el.hidden).forEach((el, i) => {
    el.animate({ opacity: [0, 1], scale: [0.7, 1] }, { ...ENTER, delay: 70 + i * 35, fill: 'backwards' });
  });
}

export function enterFavouritesEdit() {
  if (_edit || !_carousel || !_index || _count === 0) return;
  const stored = getFavouriteEntries().map(String);
  _edit = { base: stored, history: [[...stored]], cursor: 0, committing: false, scrollLeft: _carousel.scrollLeft };
  _syncEditUi();
  _swapActions(true, true);
  _editBack.push();

  const apply = () => {
    _editing = true;
    setFavouritesDragEnabled(true);
    _container.classList.add('favourites-editing');
    _items().forEach(_addEditChrome);
    _sync();
  };
  // Already a grid (the desktop's expanded column): only the wiggle starts
  if (_gridLayout()) apply();
  else _morph(apply);

  _items()[0]?.focus({ preventScroll: true });
  announce(t('favourites.editing'));
}

// `commit`: keep the working list (writing it, if it differs from the stored
// one); else go back to the list the edit started from. `animate: false` for
// leaving while the page is hidden or being left.
// `how`: 'release' steps back off the history entry the edit pushed; 'drop'
// leaves it, for when something else has pushed one over it (the search).
function _exitEdit({ commit, animate = true, how = 'release' } = {}) {
  const s = _edit;
  if (!s) return;
  cancelFavouritesDrag();
  const working = s.history[s.cursor];
  const target = commit ? working : s.base;
  const entries = _entriesOf(target);
  const dirty = !_same(target, working);
  const hadFocus = _container.querySelector('.favourites-section')?.contains(document.activeElement);
  // The layout it lands in: the desktop's expanded column if that is what
  // the user chose, else the strip
  const willGrid = _wantsExpanded && _twoCol.matches && entries.length > 0;

  const finish = () => {
    _editing = false;
    setFavouritesDragEnabled(false);
    _container.classList.remove('favourites-editing');
    _removeEditChrome(animate);
    _sync();
    if (!willGrid) _carousel.scrollLeft = s.scrollLeft;
  };

  _swapActions(false, animate);
  if (!animate) {
    _stopMorph();
    _finishListAnimation();
    if (dirty) { _reconcile(entries); _setEmpty(!entries.length); }
    finish();
  } else if (!entries.length) {
    // The strip empties the usual way once the commit is written, below
    finish();
  } else if (_gridLayout() !== willGrid) {
    _morph(() => {
      const { entered } = dirty ? _reconcile(entries) : { entered: [] };
      _setEmpty(!entries.length);
      finish();
      return entered;
    });
  } else {
    finish();
    if (dirty) _show(entries);
  }

  if (commit && !_same(working, s.base)) {
    // With nothing left, the strip is still showing its last card: let the
    // change be animated like any other.
    if (entries.length) s.committing = true;
    else _edit = null;
    setFavouriteEntries(working.map(_valueOf), 'edit');
  }
  _edit = null;
  how === 'drop' ? _editBack.drop() : _editBack.release();
  if (hadFocus && animate) _editBtn?.focus({ preventScroll: true });
}

export const cancelFavouritesEdit = () => _exitEdit({ commit: false });
export const exitFavouritesEdit = ({ commit = true } = {}) => _exitEdit({ commit });

// Alt+arrow on an item: one place along the list, or one row in the grid.
function _moveItem(el, key) {
  cancelFavouritesDrag();
  const keys = getFavouritesEditList();
  const from = keys.indexOf(el.dataset.favKey);
  if (from === -1) return;
  const cols = getComputedStyle(_carousel).gridTemplateColumns.split(' ').length;
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[key];
  // Down from the last row's neighbour still lands on the very end
  const to = Math.max(0, Math.min(keys.length - 1, from + step));
  if (to === from) return;
  keys.splice(to, 0, ...keys.splice(from, 1));
  setFavouritesEditList(keys);
  // The move may have taken the element out of the DOM and back in
  const moved = _itemByKey(el.dataset.favKey);
  moved?.focus();
  announce(t('favourites.moved').replace('{n}', to + 1).replace('{total}', keys.length));
}

function _initEdit() {
  _editBtn = document.getElementById('favourites-edit-btn');
  const bind = (id, fn) => {
    const btn = document.getElementById(id);
    btn?.addEventListener('click', () => { if (btn.getAttribute('aria-disabled') !== 'true') fn(); });
  };
  _editBtn?.addEventListener('click', enterFavouritesEdit);

  // Dragging a card to a new place (components/favourites-drag.js)
  initFavouritesDrag({
    carousel: _carousel,
    items: _items,
    canDrag: () => _editing,
    settled: () => !_container.classList.contains('favourites-morphing'),
    commit: (keys) => setFavouritesEditList(keys, { animate: false }),
    onEnd: () => {
      if (!_refreshAfterDrag) return;
      _refreshAfterDrag = false;
      renderFavourites();
    },
  });
  bind('favourites-undo-btn', undoFavouritesEdit);
  bind('favourites-redo-btn', redoFavouritesEdit);
  bind('favourites-cancel-btn', cancelFavouritesEdit);
  bind('favourites-done-btn', () => exitFavouritesEdit({ commit: true }));

  // Taps do nothing while editing. Caught on the way down, before the card's
  // own handlers and the document's delegation (which opens the classroom
  // page, or presses the card) get to it: only the badge's own events pass.
  // Stopped, not prevented from reaching other listeners on the strip, so
  // whatever drags the cards can add its own.
  const swallow = (e) => {
    if (!_editing || e.target.closest('.fav-remove') || !e.target.closest('[data-fav-key]')) return;
    e.stopPropagation();
    if (e.type === 'click') e.preventDefault();
  };
  _carousel.addEventListener('click', swallow, true);
  _carousel.addEventListener('pointerdown', swallow, true);
  _carousel.addEventListener('keydown', (e) => {
    if (!_editing) return;
    const el = e.target.closest('[data-fav-key]');
    if (!el) return;
    if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.startsWith('Arrow')) {
      e.preventDefault();   // Alt+←/→ is Back/Forward in some browsers
      e.stopPropagation();
      _moveItem(el, e.key);
    } else if ((e.key === 'Enter' || e.key === ' ') && e.target === el) {
      // Would open the card / the building
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  document.addEventListener('keydown', (e) => {
    // Not behind something opened over the edit meanwhile (on desktop, a
    // classroom page or a building overview from the results): its Escape
    // closes it, and leaves the edit alone.
    if (!_editing || e.isComposing || e.defaultPrevented || !_editBack.onTop) return;
    const el = e.target;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelFavouritesEdit();
    } else if (mod && !e.altKey && key === 'z') {
      e.preventDefault();
      e.shiftKey ? redoFavouritesEdit() : undoFavouritesEdit();
    } else if (e.ctrlKey && !e.altKey && !e.shiftKey && key === 'y') {
      e.preventDefault();
      redoFavouritesEdit();
    }
  });

  // Leaving the screen the edit is on keeps what was done. There is no
  // animation to play for, or the page may not live to see it end.
  const leave = (how) => () => { if (_edit) _exitEdit({ commit: true, animate: false, how }); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) leave('drop')(); });
  window.addEventListener('pagehide', leave('drop'));
  // Another tab (bottom-nav.js takes `visible` off the tab) or the search
  new MutationObserver(() => {
    if (_edit && !_container.classList.contains('visible')) leave('release')();
  }).observe(_container, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(() => {
    if (_edit && document.body.classList.contains('search-overlay-open')) _exitEdit({ commit: true, animate: false, how: 'drop' });
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
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
  _initEdit();
  initFavouriteMarkers();
  window.addEventListener('favourites-changed', _onFavouritesChanged);

  renderFavourites();
}
