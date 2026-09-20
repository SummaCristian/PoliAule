// Glass sheet that floats over the campus map: inset on all sides at the
// bottom on mobile, pinned to the right on desktop. It is Vitrium's sheet
// (detents, nested drag from anywhere on it, wheel and trackpad, the
// squash/stretch); this file only adds what is PoliAule's:
//
//   - the geometry: on mobile it is concentric with the floating tab bar when
//     collapsed, and eases to a plain inset panel as it opens; on desktop it is
//     a fixed 420px panel below the header;
//   - its footprint, exported for components/campus-map.js, which keeps its
//     own padding (and, while a building or campus is focused, the camera)
//     glued to the sheet through the `campussheetresize` event;
//   - opening a collapsed sheet when a building is selected.
//
// Lives inside #search-classrooms-container, alongside the map (see
// components/campus-map.js) and above it, below the header / footer /
// bottom-nav chrome.
import { createSheet } from 'vitrium';
import { t } from '../i18n.js';
import { initCampusBuildingsPage } from './campus-buildings.js';

const CONTAINER_ID = 'search-classrooms-container';
const desktopMQ = matchMedia('(min-width: 600px)');

// px, the "peek" height. Tall enough that the handle clears the floating
// bottom-nav pill (which sits ~16px above the true screen edge on mobile):
// too short and the pill's own hit area sits right on top of the handle,
// swallowing the drag before it starts.
const COLLAPSED = 192;

// The mobile sheet's plain (full-height) left/right inset and corner radius.
// GAP is the clearance the tabbar keeps below itself, reused as the gap kept
// concentric with it at the collapsed detent.
const PLAIN_INSET = 8;
const PLAIN_RADIUS = 28;
const GAP = 8;
// A superellipse ("squircle") reads as less round than a circular arc at the
// same radius. Where it's supported, scale the radius up so the corner still
// reads as concentric with the tabbar's true circular pill ends. Elsewhere
// (Safari, as of this writing) the property is ignored and the radius stays a
// plain circle, so scaling would only throw the concentricity off.
const SQUIRCLE_RADIUS_SCALE = (typeof CSS !== 'undefined' && CSS.supports('corner-shape', 'superellipse')) ? 1.15 : 1;

let sheet = null;
let header = null;
let content = null;
let container = null;
let settleTimer = 0;
let builtGeometryKey = '';

const rootPx = (name, fallback) => {
  const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// Read/write the sheet's own scroll offset: used by campus-buildings.js to keep
// the campus grid's and each building page's scroll positions independent of
// one another (save the campus scroll before drilling into a building, reset
// the new page to the top, restore it on the way back).
export function getContentScroll() {
  return sheet?.scrollTop ?? 0;
}

export function setContentScroll(value) {
  if (sheet) sheet.scrollTop = value;
}

// The sheet's current live height (px): mobile's actual footprint (it's a
// bottom sheet, full width) driving components/campus-map.js's own
// auto-alignment padding. Safe to call before initCampusSheet() ever runs.
export function getSheetHeightPx() {
  return sheet?.height ?? COLLAPSED;
}

// Where the sheet is *about to* settle once a building gets selected (a
// collapsed sheet expands; anything already open stays put) without actually
// triggering that expansion. components/campus-map.js's building fly-to reads
// this instead of the sheet's current (about-to-be-stale) height, so the
// camera aims at where the sheet will end up.
export function heightAfterBuildingSelect() {
  if (!sheet) return COLLAPSED;
  return sheet.detentHeight(detentAfterBuildingSelect()) ?? sheet.height;
}

// True while an actual user gesture is live on the sheet, as opposed to the
// settle spring just animating on its own afterwards. components/campus-map.js's
// fly-to reads this to tell "the sheet is auto-expanding on its own" apart from
// "the user is dragging it somewhere else mid-flight".
export function isUserResizing() {
  return !!sheet?.isGesturing;
}

function detentAfterBuildingSelect() {
  const current = sheet.detent;
  return current === 'collapsed' ? (desktopMQ.matches ? 'full' : 'half') : current;
}

// Mobile: two independent quantities, both easing linearly back to the plain
// 8px/28px as the sheet grows, fully there by the full detent.
//  - inset: the sheet's straight edge sits *outside* the pill's own outer edge
//    by GAP, to contain the tabbar rather than clip into it.
//  - radius: to be concentric with the pill's rounded end it equals that end's
//    radius (half the tabbar's height) plus the vertical clearance the tabbar
//    keeps below it, which is the same GAP.
// The tab bar's metrics as last seen in its mobile row layout. Not read live
// when the sheet is built: on a resize from desktop the bar is still animating
// from the rail (a tall column with no side inset) to the row, so a live read
// would bake the rail's numbers into the corners. They are refreshed once the
// bar has settled (see initCampusSheet).
const navMetrics = { tabbarHeight: 72, outerInset: 28 };
const geometryKey = () => `${navMetrics.tabbarHeight}|${navMetrics.outerInset}`;

function readNavMetrics() {
  if (desktopMQ.matches) return;
  const tabbarHeight = rootPx('--bn-tabbar-height', 0);
  const outerInset = rootPx('--bn-tabbar-outer-inset', 0);
  if (tabbarHeight && outerInset) Object.assign(navMetrics, { tabbarHeight, outerInset });
}

function mobileGeometry() {
  const { tabbarHeight, outerInset } = navMetrics;
  return {
    // Vitrium's inset is extra clearance on top of the 8px inline margin.
    inset: [outerInset - GAP - PLAIN_INSET, 0],
    radius: [(tabbarHeight / 2 + GAP) * SQUIRCLE_RADIUS_SCALE, PLAIN_RADIUS],
  };
}

// The sheet can come to rest a few px short of its detent (its detent sizes
// were measured before the map tab finished laying out). It then doesn't count
// as being at its largest detent, so native scrolling never switches on and a
// touch on the content keeps resizing the sheet instead of scrolling it.
// Re-measuring once it has settled snaps it to the real size.
function remeasureWhenSettled() {
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => sheet?.refresh(), 800);
}

function headerHeightPx() {
  return rootPx('--header-height', 84);
}

// The two layouts differ in their detents (desktop's full fills the panel's
// room; mobile's stops short so the map stays reachable), so the sheet is
// rebuilt when the breakpoint flips, keeping its detent, its scroll and its
// content.
function build(detent) {
  const desktop = desktopMQ.matches;
  builtGeometryKey = geometryKey();
  sheet = createSheet({
    header, content, container,
    label: t('tabs.campus'),
    deform: false,           // no squash/stretch while dragging: it fights touch scrolling on the cards
    expandOnFocus: false,    // a tapped card must not pop the sheet open; only a building selection does
    zIndex: 3,               // above the map (0) and its controls (5 is inside the map's own context)
    detents: [
      { id: 'collapsed', size: COLLAPSED },
      { id: 'half', size: 0.5 },
      { id: 'full', size: desktop ? 'full' : 0.85 },
    ],
    detent,
    margin: { top: desktop ? headerHeightPx() + 32 + 20 : 0, bottom: 20, inline: desktop ? 20 : PLAIN_INSET },
    ...(desktop ? { width: 420, side: 'end' } : { geometry: mobileGeometry() }),
    onResize(height) {
      // components/campus-map.js listens for this: any manual drag/wheel, the
      // settle spring that follows one, or the auto-expand a building
      // selection triggers, alike.
      document.dispatchEvent(new CustomEvent('campussheetresize', { detail: { height } }));
    },
    onDetentChange(id) {
      sheet.el.dataset.detent = id;
      remeasureWhenSettled();
    },
  });
  sheet.el.classList.add('campus-sheet');
  sheet.el.dataset.detent = sheet.detent;
  sheet.contentEl.classList.add('campus-sheet-content');
}

export function initCampusSheet() {
  container = document.getElementById(CONTAINER_ID);
  if (!container || sheet) return;

  // Exposed for campus-map.css: lets the map's own bottom-left/right controls
  // (attribution/copyright included) clear the sheet's collapsed height
  // instead of just the bottom-nav's.
  document.documentElement.style.setProperty('--campus-sheet-collapsed-height', `${COLLAPSED}px`);

  header = document.createElement('div');
  content = document.createElement('div');
  readNavMetrics();
  build('collapsed');

  // Only now is `header`/`content` connected to the document: the picker custom
  // element inside the header needs that before .setup().
  initCampusBuildingsPage(header, content);

  // Rebuilt in place (same content, detent and scroll) when the layout it was
  // built for changes: the breakpoint flips, or the tab bar it is concentric
  // with changes size (its height is only known once the bar has laid out and
  // its icon font has loaded).
  const rebuild = () => {
    const detent = sheet.detent;
    const scroll = sheet.scrollTop;
    sheet.destroy();
    build(detent);
    sheet.scrollTop = scroll;
  };
  desktopMQ.addEventListener('change', rebuild);
  // The bar animates to its new size when the layout changes, firing this on
  // every frame: wait until it has stopped before comparing.
  let navSettle = 0;
  document.addEventListener('navsizechange', () => {
    clearTimeout(navSettle);
    navSettle = setTimeout(() => {
      readNavMetrics();
      if (!desktopMQ.matches && geometryKey() !== builtGeometryKey) rebuild();
    }, 250);
  });

  // components/campus-buildings.js dispatches this whenever a building becomes
  // selected (from its grid, or a map marker tap): surface the sheet if it's
  // currently just a collapsed peek. A no-op at 'half'/'full': there's no reason
  // to shrink an already-open sheet just because a different building was picked.
  document.addEventListener('buildingpageopen', () => {
    if (sheet.detent === 'collapsed') sheet.setDetent(detentAfterBuildingSelect());
  });
}
