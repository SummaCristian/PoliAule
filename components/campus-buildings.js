import { CampusChipPicker } from './campus-picker.js';
import { getContentScroll, setContentScroll } from './campus-sheet.js';
import { classroomsData as staticClassroomsData } from '../classroom-search-data.js';
import { getClassroomStatusNow } from '../available-rooms-script.js';
import { buildCardForClassroom } from './classroom-list.js';
import { t } from '../i18n.js';
import { escapeHtml } from '../utils/html.js';
import { haptics, defaultPatterns } from './haptics.js';

// The Campus tab's own "pages" inside the campus sheet (components/campus-sheet.js):
//
//   - Campus page: a campus picker on top, a grid of that campus's buildings
//     below (tapping one opens the building page).
//   - Building page: a back button + that building's name/classroom count on
//     top, a grid of its classrooms below (tapping one opens the classroom
//     detail page, same as the Available/Search tabs).
//
// Navigating between the two pages slides the grid horizontally, mobile-nav
// style (see #slideTo below) — the header row itself isn't part of that
// animation, its title/subtitle/back-button just update in place.
//
// The picker is a second instance of the exact same morphing <campus-chip-
// picker> used on the Available tab (components/campus-picker.js) — a
// different element (its own tag), but wired to act as the SAME logical
// picker as the Available tab's: both share the plain `campuschange` event
// (this subclass doesn't override changeEventName), so picking a campus in
// either one dispatches it, and the listener below mirrors that pick onto
// whichever picker didn't just change (selectCampusById() no-ops once a
// picker's value already matches, so this can't loop). Riding the same event
// also means this picker inherits everything else already keyed off it: the
// Available tab's own live search re-running, and settings.js's "remember
// last campus" persistence — genuinely the same picker, just two faces of
// it, rather than a lookalike that happens to start on the same campus.
//
// The building cards reuse the Available tab's "zoom out" building-overview
// cards (.bo-card, building-overview.css) — same glass card, just without the
// occupancy counts row, since browsing here isn't tied to a date/time. The
// classroom cards on the building page reuse the shared classroom card
// (components/classroom-list.js) — same card used on the Available tab.
//
// Building selection is kept in sync with the map's own building markers
// (components/campus-map.js) via a shared `buildingchange` document event —
// riding it either way, same trick as `campuschange` above: tapping a card
// here dispatches it (and the map flies in), tapping a marker there
// dispatches it (and this page swaps to that building), and either side
// no-ops once already showing that selection. The back button always
// returns to the campus page — it never leaves a stack of visited buildings
// behind.
class CampusSheetPicker extends CampusChipPicker {}
customElements.define('campus-sheet-picker', CampusSheetPicker);

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const SLIDE_DUR = 420; // ms
const SLIDE_EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

let picker = null;
let hiddenInput = null;
let recenterBtn = null;
let backBtn = null;
let titleBox = null;   // wraps titleEl + subtitleEl — see flipTitleBox()
let titleEl = null;
let subtitleEl = null;
let pageSwap = null;   // wraps whichever page is on screen; slid horizontally between the two
let currentPage = null; // the in-flow (position:static) page element
let transitioning = false; // a slideTo()/crossfadePage() animation is in flight — see cancelPageTransition()

let view = 'campus';          // 'campus' | 'building'
let selectedBuildingId = null; // building.name (unique within a campus — see findBuilding()), or null
// The campus grid's own scroll offset, saved the moment a building is opened
// from it and restored on the way back — so the two pages scroll
// independently instead of a building page inheriting wherever the campus
// grid happened to be scrolled to, and the campus grid losing its place
// every time a building is visited.
let savedCampusScroll = 0;

export function initCampusBuildingsPage(headerContainer, gridContainer) {
  headerContainer.innerHTML = '';
  gridContainer.innerHTML = '';

  // [Back?] Title            [Recenter] [Picker?]
  const topRow = document.createElement('div');
  topRow.className = 'campus-sheet-toprow';

  const leftGroup = document.createElement('div');
  leftGroup.className = 'campus-sheet-leftgroup';

  backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'campus-sheet-backbtn liquid-glass';
  backBtn.hidden = true;
  backBtn.setAttribute('aria-label', t('campus.back'));
  backBtn.innerHTML = '<i class="hgi-stroke hgi-chevron-left" aria-hidden="true"></i>';
  backBtn.addEventListener('click', () => {
    haptics.trigger(defaultPatterns.light);
    goToCampusPage({ animate: true });
  });
  leftGroup.appendChild(backBtn);

  titleBox = document.createElement('div');
  titleBox.className = 'campus-sheet-titlebox';

  titleEl = document.createElement('h3');
  titleEl.className = 'campus-sheet-title';
  titleBox.appendChild(titleEl);

  subtitleEl = document.createElement('span');
  subtitleEl.className = 'campus-sheet-subtitle secondary';
  titleBox.appendChild(subtitleEl);

  leftGroup.appendChild(titleBox);
  topRow.appendChild(leftGroup);

  const actions = document.createElement('div');
  actions.className = 'campus-sheet-actions';

  // Recenters the map (components/campus-map.js) on the current selection —
  // whichever campus/building this sheet is currently showing — only shown
  // once the map is actually panned/zoomed away from it (see the
  // 'campusmapshifted' listener below), so it doesn't clutter the sheet the
  // rest of the time.
  recenterBtn = document.createElement('button');
  recenterBtn.type = 'button';
  recenterBtn.className = 'campus-sheet-recenter liquid-glass';
  recenterBtn.hidden = true;
  recenterBtn.setAttribute('aria-label', t('campus.recenter'));
  recenterBtn.innerHTML = '<i class="hgi-stroke hgi-gps-01" aria-hidden="true"></i>';
  recenterBtn.addEventListener('click', () => {
    haptics.trigger(defaultPatterns.light);
    document.dispatchEvent(new CustomEvent('campusrecenter'));
  });
  actions.appendChild(recenterBtn);

  picker = document.createElement('campus-sheet-picker');
  hiddenInput = document.createElement('input');
  hiddenInput.type = 'hidden';
  picker.appendChild(hiddenInput);
  actions.appendChild(picker);

  topRow.appendChild(actions);
  headerContainer.appendChild(topRow);

  pageSwap = document.createElement('div');
  pageSwap.className = 'campus-sheet-pageswap';
  gridContainer.appendChild(pageSwap);

  picker.setup(staticClassroomsData);

  currentPage = buildCampusPage(hiddenInput.value);
  pageSwap.appendChild(currentPage);
  renderCampusHeader(hiddenInput.value);

  document.addEventListener('campuschange', (e) => {
    // A different campus was picked (from either picker) — whatever building
    // was selected belongs to the old campus, so drop it and show the new
    // campus's own grid. No slide (the campus itself just changed, nothing
    // was "navigated") and no 'buildingchange' dispatch of our own: the map
    // is already flying to the new campus via its own 'campuschange'
    // listener, and dispatching one here would just race it.
    selectedBuildingId = null;
    view = 'campus';
    savedCampusScroll = 0; // a saved scroll belongs to the old campus's grid, not this one
    setContentScroll(0);
    swapCampusPage(e.detail.id, { animate: false });
  });
  document.addEventListener('campusmapshifted', (e) => { recenterBtn.hidden = !e.detail.shifted; });

  // Two-way sync with the Available tab's own picker (see the file header
  // comment) — whichever one changed, bring the other along. No-ops on
  // whichever picker is already showing this campus (itself included), so
  // this can't bounce back and forth forever.
  document.addEventListener('campuschange', (e) => {
    picker.selectCampusById(e.detail.id);
    document.querySelector('campus-chip-picker')?.selectCampusById(e.detail.id);
  });

  // The map's own building markers (components/campus-map.js) dispatch this
  // same event on tap — see the file header comment.
  document.addEventListener('buildingchange', (e) => {
    const { campusId, buildingId } = e.detail;
    if (campusId !== hiddenInput.value) return; // stale — a campus switch is already in flight
    if (buildingId === selectedBuildingId) return; // already showing this, incl. our own dispatch
    if (buildingId) openBuilding(buildingId, { animate: view === 'campus', notify: false });
    else goToCampusPage({ animate: true, notify: false });
  });
}

// The campus currently picked here — read by campus-map.js so the map opens
// centered on it, and stays centered on whichever campus is picked next (see
// the 'campuschange' listener there).
export function getSelectedCampusId() {
  return hiddenInput?.value ?? null;
}

// The building currently drilled into here, if any — read by campus-map.js
// to know whether the recenter button / 'shifted' check should target a
// building's camera instead of the campus's.
export function getSelectedBuildingId() {
  return selectedBuildingId;
}

// Called by the Available tab's building header jump button (script.js) to
// drive this sheet straight to a building's detail page, from cold (the tab
// may never have been opened yet) or from wherever it currently is. Brings
// the picker along first if it's on a different campus — synchronously, via
// the same 'campuschange' path a manual pick takes (see selectCampusById in
// components/campus-picker.js) — so openBuilding() below finds the right
// campus already selected. No slide animation: this is a teleport, not an
// in-sheet navigation.
export function goToBuilding(campusId, buildingId) {
  if (hiddenInput.value !== campusId) {
    picker.selectCampusById(campusId, false);
    document.querySelector('campus-chip-picker')?.selectCampusById(campusId, false);
  }
  openBuilding(buildingId, { animate: false });
}

// Called by campus-map.js when a big enough zoom-out reverts the map to the
// campus overview on its own (not via the back button below) — snaps the
// sheet back to its campus page in sync. No slide (nothing was
// "navigated" — the map just zoomed out) and, unlike goToCampusPage(), no
// outgoing 'buildingchange' dispatch: the map already knows, and dispatching
// one back at it would fly the camera right back in, fighting the zoom-out
// gesture that got here.
export function clearSelectedBuildingSilently() {
  if (view !== 'building') return;
  const campusId = hiddenInput.value;
  selectedBuildingId = null;
  view = 'campus';
  renderCampusHeader(campusId);
  setContentScroll(savedCampusScroll);
  const next = buildCampusPage(campusId);
  currentPage?.replaceWith(next);
  currentPage = next;
}

// Called from script.js alongside the Available tab's own picker retranslate,
// on every language switch.
export function retranslateCampusBuildingsPage() {
  if (!picker) return;
  picker.retranslate();
  recenterBtn?.setAttribute('aria-label', t('campus.recenter'));
  backBtn?.setAttribute('aria-label', t('campus.back'));
  if (view === 'campus') {
    swapCampusPage(hiddenInput.value, { animate: false });
  } else {
    const building = findBuilding(hiddenInput.value, selectedBuildingId);
    if (building) {
      renderBuildingHeader(building);
      currentPage?.replaceWith(buildBuildingPage(building));
      currentPage = pageSwap.firstElementChild;
    }
  }
}

// ---------- CAMPUS PAGE ----------

// Sets the title/subtitle text and, when `fade` is true, gives both a quick
// fade-in as their new value lands — used whenever the grid below is doing
// its own in-place crossfade (crossfadePage()) rather than a push/pop slide,
// so the header reads as part of the same "content updated" moment instead
// of just snapping. `csp-fade-in` (campus-sheet.css) is the same class
// crossfadePage() puts on its incoming page — removed and immediately
// re-added (with a forced reflow between, or the browser won't replay an
// already-applied animation) so repeated calls (marker tap after marker tap)
// each get their own fresh run instead of only the first one animating.
function setHeaderText(title, subtitle, fade) {
  titleEl.textContent = title;
  subtitleEl.textContent = subtitle;
  if (!fade || reduceMotion.matches) return;
  for (const el of [titleEl, subtitleEl]) {
    el.classList.remove('csp-fade-in');
    void el.offsetWidth; // force reflow so the re-added class restarts the animation
    el.classList.add('csp-fade-in');
  }
}

// FLIP (First-Last-Invert-Play): runs `mutate` (a renderCampusHeader() /
// renderBuildingHeader() call, which shows or hides the back button and so
// shifts titleBox over — flex reflowing around it) and animates titleBox
// from where it *was* to where it now sits, instead of letting that reflow
// just jump. Used only for the push/pop navigations (openBuilding's forward
// slide, goToCampusPage's back slide) — the in-place building-to-building
// crossfade never touches the back button's visibility, so there's nothing
// to flip there.
function flipTitleBox(mutate) {
  if (reduceMotion.matches) { mutate(); return; }
  const wasHidden = backBtn.hidden;
  const before = titleBox.getBoundingClientRect();

  mutate();

  const nowHidden = backBtn.hidden;
  if (nowHidden && !wasHidden) {
    // Hiding: backBtn's own [hidden] rule (campus-sheet.css) defers its
    // `display: none` via `transition-behavior: allow-discrete` until its
    // own pop-out transition finishes — so, left alone, it would keep
    // occupying its flex slot (and titleBox wouldn't actually reflow) for
    // that whole ~0.2s, then silently jump once it does. Pull it out of the
    // flex flow ourselves, right now, so titleBox's reflow (and the "after"
    // measurement below) happens in this same synchronous beat instead —
    // its own fade/scale-out is a separate transition, unaffected by this.
    backBtn.style.position = 'absolute';
    const clearAbsolute = () => { backBtn.style.position = ''; };
    backBtn.addEventListener('transitionend', function onEnd(e) {
      if (e.target !== backBtn) return;
      backBtn.removeEventListener('transitionend', onEnd);
      clearAbsolute();
    });
    setTimeout(clearAbsolute, 300);
  }

  const after = titleBox.getBoundingClientRect();
  const dx = before.left - after.left;
  if (Math.abs(dx) < 1) return;
  titleBox.style.transition = 'none';
  titleBox.style.transform = `translateX(${dx}px)`;
  void titleBox.offsetWidth; // force reflow so the transition below actually animates
  titleBox.style.transition = `transform ${SLIDE_DUR}ms ${SLIDE_EASE}`;
  titleBox.style.transform = '';
  const clear = () => { titleBox.style.transition = ''; titleBox.style.transform = ''; };
  titleBox.addEventListener('transitionend', function onEnd(e) {
    if (e.target !== titleBox || e.propertyName !== 'transform') return;
    titleBox.removeEventListener('transitionend', onEnd);
    clear();
  });
  setTimeout(clear, SLIDE_DUR + 150);
}

function renderCampusHeader(campusId, { fade = false } = {}) {
  const campus = staticClassroomsData.find(c => c.id === campusId);
  const buildings = campus?.buildings ?? [];
  setHeaderText(t('overview.title'), t('campus.buildingsCount').replace('{n}', buildings.length), fade);
  backBtn.hidden = true;
  picker.style.display = '';
}

function buildCampusPage(campusId) {
  const page = document.createElement('div');
  page.className = 'campus-sheet-page';
  const grid = document.createElement('div');
  grid.className = 'bo-grid campus-sheet-grid';
  page.appendChild(grid);

  const campus = staticClassroomsData.find(c => c.id === campusId);
  for (const building of campus?.buildings ?? []) {
    grid.appendChild(buildBuildingCard(building));
  }
  return page;
}

// Re-renders the campus page's grid in place (no page-swap animation — used
// whenever the campus itself changes while already showing the campus page).
function swapCampusPage(campusId, { animate = true } = {}) {
  renderCampusHeader(campusId, { fade: animate });
  const next = buildCampusPage(campusId);
  if (animate && !reduceMotion.matches) {
    crossfadePage(next);
  } else {
    currentPage?.replaceWith(next);
    currentPage = next;
  }
}

function buildBuildingCard(building) {
  const card = document.createElement('div');
  card.className = 'bo-card campus-sheet-card';
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');

  const total = building.classrooms.length;
  card.innerHTML = `
    <div class="bo-card-body">
      <div class="bo-card-head">
        <span class="bo-card-name">${escapeHtml(t('building.prefix'))} ${escapeHtml(building.name)}</span>
        ${building.altName ? `<span class="bo-card-alt">${escapeHtml(building.altName)}</span>` : ''}
        <span class="bo-card-total secondary">${escapeHtml(t('overview.subtitle').replace('{n}', total))}</span>
      </div>
      ${building.address ? `<span class="campus-sheet-card-address secondary">${escapeHtml(building.address)}</span>` : ''}
    </div>
  `;

  const go = () => {
    haptics.trigger(defaultPatterns.light);
    openBuilding(building.name, { animate: true });
  };
  card.addEventListener('click', go);
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); }
  });

  return card;
}

// ---------- BUILDING PAGE ----------

function buildingLabel(building) {
  const alt = (building.altName || '').trim();
  return alt || `${t('building.prefix')} ${building.name}`;
}

// `idEdificio` (the scraped building id) is missing (null) for a good chunk
// of buildings — not a usable identity. `name` is what's actually unique
// within a campus (same choice building-overview.js's own zoom-out grid
// already made, for the same reason).
function findBuilding(campusId, buildingId) {
  const campus = staticClassroomsData.find(c => c.id === campusId);
  return campus?.buildings.find(b => b.name === buildingId) ?? null;
}

function renderBuildingHeader(building, { fade = false } = {}) {
  setHeaderText(buildingLabel(building), t('overview.subtitle').replace('{n}', building.classrooms.length), fade);
  backBtn.hidden = false;
  picker.style.display = 'none';
}

// Ground floor and basement get their own wording (Italian convention),
// everything else is just "Floor {n}"; `null` (2 classrooms, missing data)
// sorts last under its own "unknown" label rather than being dropped.
function floorLabel(floor) {
  if (floor === null || floor === undefined) return t('overview.floorUnknown');
  if (floor === 0) return t('overview.floorGround');
  if (floor === -1) return t('overview.floorBasement');
  return t('overview.floor').replace('{n}', floor);
}

function buildBuildingPage(building) {
  const page = document.createElement('div');
  page.className = 'campus-sheet-page';
  const grid = document.createElement('div');
  grid.className = 'bo-grid campus-sheet-grid campus-sheet-classroom-grid';
  page.appendChild(grid);

  const sorted = [...building.classrooms].sort((a, b) => {
    const fa = a.floor, fb = b.floor;
    if (fa === fb) return 0;
    if (fa === null || fa === undefined) return 1;
    if (fb === null || fb === undefined) return -1;
    return fa - fb;
  });

  let lastFloor;
  let first = true;
  for (const classroom of sorted) {
    if (first || classroom.floor !== lastFloor) {
      const label = document.createElement('div');
      label.className = 'bo-floor-label';
      label.innerHTML = `<i class="hgi-stroke hgi-stairs-01" aria-hidden="true"></i><span>${floorLabel(classroom.floor)}</span>`;
      grid.appendChild(label);
      lastFloor = classroom.floor;
      first = false;
    }
    const status = getClassroomStatusNow(classroom.id);
    const card = buildCardForClassroom({ ...classroom, status }, building, null, null, false, null, '', true);
    grid.appendChild(card);
  }
  return page;
}

// Opens (or, if already on the building page, swaps to) the given building.
// `animate` controls whether this does the mobile-nav slide (campus → building
// page, or switching straight from one building to another via a marker tap)
// — a marker tap that lands on a building already open just re-renders in
// place (see the 'buildingchange' listener in initCampusBuildingsPage).
// `notify` is false when this is itself running from that listener — the
// 'buildingchange' event that triggered the call has already reached every
// other listener (map.js included), so re-dispatching here would just be a
// redundant, immediately-superseded second copy of the same event.
function openBuilding(buildingId, { animate, notify = true }) {
  const campusId = hiddenInput.value;
  const building = findBuilding(campusId, buildingId);
  if (!building) return;

  const wasCampusPage = view === 'campus';
  // Only save when actually leaving the campus grid — switching straight
  // from one building to another (a marker tap while a building page is
  // already open) must never overwrite the campus scroll saved on the way
  // in, or the back button would land the campus grid at the wrong spot.
  if (wasCampusPage) savedCampusScroll = getContentScroll();
  selectedBuildingId = buildingId;
  view = 'building';
  if (wasCampusPage) {
    // Forward push slide: the back button appearing shifts titleBox over
    // (flex reflow) — flip that shift into a slide instead of a jump.
    flipTitleBox(() => renderBuildingHeader(building));
  } else {
    // In-place building -> building switch: the back button's already
    // showing either way (no title-box shift to flip), just fade the text
    // in alongside the grid's own crossfade.
    renderBuildingHeader(building, { fade: true });
  }

  // Every building page starts at its own top — never inherits the campus
  // grid's scroll position, or another building's.
  setContentScroll(0);

  const next = buildBuildingPage(building);
  if (animate && wasCampusPage) slideTo('forward', next);
  else if (!reduceMotion.matches) crossfadePage(next);
  else { currentPage?.replaceWith(next); currentPage = next; }

  if (notify) document.dispatchEvent(new CustomEvent('buildingchange', { detail: { campusId, buildingId } }));
  // Whenever a building becomes selected — from the grid or a map marker —
  // the sheet should surface it if it's currently just a collapsed peek (see
  // campus-sheet.js's own 'buildingpageopen' listener, a no-op at any other
  // detent).
  document.dispatchEvent(new CustomEvent('buildingpageopen'));
}

function goToCampusPage({ animate, notify = true }) {
  if (view !== 'building') return;
  const campusId = hiddenInput.value;
  selectedBuildingId = null;
  view = 'campus';
  // The back button disappearing lets titleBox slide back left (flex
  // reflow) — flip that shift instead of letting it jump.
  flipTitleBox(() => renderCampusHeader(campusId));

  // Restore the campus grid to wherever it was scrolled to before this
  // building was opened, rather than starting back at the top.
  setContentScroll(savedCampusScroll);

  const next = buildCampusPage(campusId);
  if (animate) slideTo('back', next);
  else { currentPage?.replaceWith(next); currentPage = next; }

  if (notify) document.dispatchEvent(new CustomEvent('buildingchange', { detail: { campusId, buildingId: null } }));
}

// ---------- PAGE TRANSITIONS ----------

const FADE_DUR = 300; // ms
let pendingCleanup = 0;

// Forcibly ends whatever page transition — slideTo() or crossfadePage(),
// either one — might still be running, snapping straight to a clean single,
// normal-flow page. Called at the start of both functions below, before they
// set up their own new transition, so a rapid double-navigation (a marker
// tap landing while the previous one's animation hasn't settled yet) can't
// stack a third layer.
//
// Deliberately generic rather than each function finishing "its own"
// transition via its own closure's prev/next: if slideTo is mid-flight and
// crossfadePage interrupts it, crossfadePage has no reference to slideTo's
// prev (the page from *before* slideTo even started) — calling slideTo's own
// half-built cleanup from the wrong closure would remove the wrong element
// and orphan that one in the DOM permanently. Operating on `pageSwap`'s
// actual children instead — remove anything that isn't `currentPage`, reset
// `currentPage` itself back to a plain in-flow page — works no matter which
// function (or how many nested interruptions) got here first.
function cancelPageTransition() {
  clearTimeout(pendingCleanup);
  transitioning = false;
  if (!pageSwap) return;
  for (const child of [...pageSwap.children]) {
    if (child === currentPage) {
      child.style.position = '';
      child.style.inset = '';
      child.style.transform = '';
      child.classList.remove('csp-fade-in', 'csp-fade-out');
    } else {
      child.remove();
    }
  }
  pageSwap.classList.remove('csp-animating');
  pageSwap.style.height = '';
}

// Mobile-nav push/pop: `next` slides in from the right (forward) or left
// (back) while the current page slides the opposite way out, both full-width
// layers absolutely stacked inside `pageSwap` for the duration. Settles back
// to a single, normal in-flow page once done, so campus-sheet.js's own
// scrollHeight-driven sizing sees a plain single-page layout again.
function slideTo(direction, next) {
  if (!pageSwap || !currentPage || reduceMotion.matches) {
    currentPage?.replaceWith(next);
    currentPage = next;
    return;
  }
  cancelPageTransition();
  const prev = currentPage;
  transitioning = true;

  const prevH = prev.offsetHeight;
  pageSwap.appendChild(next);
  const nextH = next.offsetHeight;
  pageSwap.style.height = `${Math.max(prevH, nextH)}px`;
  pageSwap.classList.add('csp-animating');

  const sign = direction === 'forward' ? 1 : -1;
  for (const el of [prev, next]) { el.style.position = 'absolute'; el.style.inset = '0'; el.style.transition = 'none'; }
  next.style.transform = `translateX(${sign * 100}%)`;
  prev.style.transform = 'translateX(0)';

  void pageSwap.offsetHeight; // flush before animating

  for (const el of [prev, next]) el.style.transition = `transform ${SLIDE_DUR}ms ${SLIDE_EASE}`;
  requestAnimationFrame(() => {
    next.style.transform = 'translateX(0)';
    prev.style.transform = `translateX(${-sign * 100}%)`;
  });

  currentPage = next;
  const finish = () => { if (transitioning) cancelPageTransition(); };
  next.addEventListener('transitionend', function onEnd(e) {
    if (e.target !== next || e.propertyName !== 'transform') return;
    next.removeEventListener('transitionend', onEnd);
    finish();
  });
  pendingCleanup = setTimeout(finish, SLIDE_DUR + 150);
}

// Plain cross-fade, in place — used when the page identity doesn't change
// (re-rendering the current campus/building's grid after a language switch,
// or switching straight from one building to another via a marker tap while
// a building page is already open) so it reads as "this page's content
// updated," not as a forward/back navigation the way slideTo() does. Both
// pages are briefly stacked absolutely (same overlay trick as slideTo, just
// with opacity instead of a transform) — without it, two normal-flow pages
// would stack vertically for the duration instead of overlapping.
//
// Plain declarative CSS `animation` classes (.csp-fade-in/-out, campus-
// sheet.css) rather than a JS-driven CSS `transition` or Web Animations API
// call — the browser starts a CSS animation itself the instant the class
// lands on a rendered element, with no "set start state, force reflow, flip
// to end state next frame" dance to get right. Same mechanism this codebase
// already leans on for exactly this kind of fade-in (.classroom-card's own
// card-appear, classroom-list.css) — reusing something already proven
// reliable here rather than another bespoke JS-timed implementation.
function crossfadePage(next) {
  if (!pageSwap || !currentPage || reduceMotion.matches) {
    currentPage?.replaceWith(next);
    currentPage = next;
    return;
  }
  cancelPageTransition();
  const prev = currentPage;
  transitioning = true;

  const prevH = prev.offsetHeight;
  pageSwap.appendChild(next);
  const nextH = next.offsetHeight;
  pageSwap.style.height = `${Math.max(prevH, nextH)}px`;
  pageSwap.classList.add('csp-animating');
  prev.style.position = 'absolute';
  prev.style.inset = '0';
  prev.classList.add('csp-fade-out');
  next.classList.add('csp-fade-in');

  currentPage = next;
  const finish = () => { if (transitioning) cancelPageTransition(); };
  prev.addEventListener('animationend', function onEnd(e) {
    if (e.target !== prev) return;
    prev.removeEventListener('animationend', onEnd);
    finish();
  });
  // Backstop: an animationend can be missed (the element torn down mid-
  // flight by a faster interruption, or a browser quirk) — settle on our
  // own clock either way.
  pendingCleanup = setTimeout(finish, FADE_DUR + 150);
}
