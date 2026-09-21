import { getMapboxToken } from '../config.js';
import { classroomsData } from '../classroom-search-data.js';
import { t } from '../i18n.js';
import { escapeHtml } from '../utils/html.js';
import { getSelectedCampusId, getSelectedBuildingId, clearSelectedBuildingSilently } from './campus-buildings.js';
import { getSheetHeightPx, heightAfterBuildingSelect, isUserResizing } from './campus-sheet.js';

// Fullscreen Mapbox map that fills the Campus tab. The app chrome (header,
// footer, bottom-nav) floats above it — see components/campus-map.css, which
// also locks the page scroll while this tab is open so every drag / pinch /
// rotate goes to the map instead of the page behind it.
//
// Two zoom levels of markers, MapKit-style: campuses first, and tapping one
// flies in and swaps to that campus's building markers. Zooming back out past
// a threshold returns to the campus overview. Static for now — markers don't
// reflect live occupancy yet.

const MAPBOX_VERSION = '3.9.1';
const CONTAINER_ID = 'search-classrooms-container';

// Milano metro — 4 of 7 campuses and almost every classroom sit here; the
// others (Cremona, Lecco, Mantova) are a pan away and always keep their marker.
const INITIAL_CENTER = [9.195, 45.488];
const INITIAL_ZOOM = 11.3;
// A loose leash around Lombardy so a stray fling can't lose the map. Applied as
// a soft post-move clamp rather than the constructor's `maxBounds` — the latter
// silently caps the map's pitch (and blocks flyTo/setPitch from raising it), so
// with it set the 3D tilt never engages. See panBackInBounds().
const MAX_BOUNDS = [[8.3, 44.5], [11.6, 46.8]];
// Below this zoom we're "looking at the region" → show campuses, not buildings.
const CAMPUS_ZOOM = 12.3;
// Where a campus tap settles.
const CAMPUS_FLY_ZOOM = 16.5;
// Where a building tap settles — close enough to read as "looking at just
// this building," one deliberate step in from the campus-wide view.
const BUILDING_FLY_ZOOM = 18;

// The campus sheet (components/campus-sheet.{js,css}) covers part of the map
// — a right-pinned panel on desktop, a bottom one on mobile — so a plain
// `center` lands a picked campus in the middle of the WHOLE canvas, part of
// which is actually hidden under the sheet. `padding` (below) tells Mapbox to
// center within the remaining, actually-visible area instead.
//
// Desktop's panel is a fixed 420px wide (+ its own 20px right gap) regardless
// of its drag detent — only its *height* varies, and since it's pinned to the
// map's bottom-right, that height never eats into the padding's horizontal
// reservation the way it does on mobile — so `right` alone, both mirrored
// from campus-sheet.css, is enough there.
//
// Mobile's bottom sheet instead spans the full width, so its live *height*
// (campus-sheet.js's own drag-detent spring, mirrored here via the
// 'campussheetresize' listener below) is exactly what needs to be reserved —
// same 20px gap, kept in sync with every manual drag/wheel resize, the settle
// spring that follows one, and the auto-expand a building selection triggers,
// alike, rather than just the sheet's initial collapsed footprint.
const SHEET_DESKTOP_WIDTH = 420;
const SHEET_DESKTOP_GAP = 20;
const SHEET_MOBILE_GAP = 20;
// However tall the mobile sheet grows (up to its own 'full' detent, close to
// the whole screen — see campus-sheet.js's bounds()), always leave at least
// this much of the map genuinely visible above it. Without this, a
// near-fullscreen sheet would make the padded "visible area" vanishingly
// small (or fight itself trying to center a marker in it) instead of just
// keeping it pinned in the sliver that's actually left.
const SHEET_MOBILE_MIN_VISIBLE = 140;
const desktopMQ = matchMedia('(min-width: 600px)');

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const darkScheme = window.matchMedia('(prefers-color-scheme: dark)');

let map = null;
let bootPromise = null;  // single-flight: the Map() is constructed exactly once per page load
let campusContainer = null;
let mapEl = null;        // the .campus-map element the one Map() lives in — reparented, never rebuilt
let mapboxglLib = null;  // set once loaded — reused by the picker's change listener below
let mode = 'campus';   // 'campus' | 'buildings'
let markers = [];      // currently-rendered mapboxgl.Marker[]
let markerCampus = null; // the campus whose building markers are up (mode 'buildings')

// The classroom detail page borrows this very map (see embedMap() at the
// bottom) for its 3D building preview: the same Map() instance is moved into
// the page's card and back, never recreated. `embed` is the live request
// ({host, lat, long, label}, host null while parked); `embedActive` is true
// once the map's camera/markers/handlers are switched to the preview.
const EMBED_ZOOM = 17.5;
// The preview's point of view, switchable from the detail card's 2D/3D picker.
const POV = { '3d': { pitch: 60, bearing: -20 }, '2d': { pitch: 0, bearing: 0 } };
let embedPov = '3d';
let embed = null;
let embedActive = false;
let embedToken = 0;
let embedShownKey = null;     // building the preview camera is already framing (skips a re-tilt on re-render)
let createdForEmbed = false;  // map was built by a direct-URL detail load: no campus view to restore
let savedView = null;         // campus-tab camera/markers captured when the preview took over

// The mobile sheet's current live height (px) — seeded from its resting
// value up front (safe even before campus-sheet.js's own init runs, see
// getSheetHeightPx()'s comment), kept current via the 'campussheetresize'
// listener in initCampusMap(). Unused on desktop (see mapPadding()).
let sheetHeightPx = getSheetHeightPx();

// True while a flyTo we triggered (flyToCampus/flyToBuilding) still owns the
// camera — the sheet-resize follow below defers to it instead of fighting
// its animation with a hard jump every frame; see followSheetResize()'s own
// comment.
let autoFlying = false;
// The in-flight fly's own destination (center/zoom/pitch/bearing) — null
// whenever autoFlying is false. Lets a genuine user drag on the sheet mid-
// flight (see followSheetResize()) retarget the same destination with the
// sheet's actual current padding, rather than the flight finishing against
// whatever padding it happened to snapshot when it started.
let flyDestination = null;
let lastFlyRetargetAt = 0;
// Minimum gap between mid-flight retargets — the sheet dispatches a resize
// event on every animation frame while being dragged, and restarting the
// flyTo that often would read as a jittery chase instead of one flight
// correcting itself.
const FLY_RETARGET_THROTTLE_MS = 120;

// Whether the map's actual camera differs from the auto-centered view of the
// current selection — recomputed after every settle (`moveend`, see boot()),
// not inferred from *how* it got there. A few Mapbox-native gestures (the
// NavigationControl compass's own drag-to-rotate, its click-to-reset-north)
// turned out not to consistently tag their originalEvent the way a plain
// drag/wheel/pinch does, which made a "was this user-caused?" heuristic
// unreliable — diffing the actual state instead sidesteps that entirely, for
// every kind of move (pan, zoom, rotate, pitch) alike. Drives the sheet's
// recenter button (components/campus-buildings.js).
let shifted = false;
function setShifted(v) {
  if (shifted === v) return;
  shifted = v;
  document.dispatchEvent(new CustomEvent('campusmapshifted', { detail: { shifted } }));
}

// Small pixel/degree slack so floating-point settle noise from an easeTo/
// flyTo we ourselves triggered never reads as "shifted".
const CENTER_SLACK_PX = 2;
const ANGLE_SLACK_DEG = 0.5;

function updateShifted() {
  if (embed) return;
  const focus = selectedFocus();
  if (!focus) { setShifted(false); return; }

  const canvas = map.getCanvas();
  const padding = mapPadding();
  const targetX = (padding.left + (canvas.clientWidth - padding.right)) / 2;
  const targetY = (padding.top + (canvas.clientHeight - padding.bottom)) / 2;
  const px = map.project([focus.long, focus.lat]);

  const centered = Math.abs(px.x - targetX) <= CENTER_SLACK_PX && Math.abs(px.y - targetY) <= CENTER_SLACK_PX;
  const zoomed = Math.abs(map.getZoom() - focus.zoom) <= 0.05;
  const pitched = Math.abs(map.getPitch() - 55) <= ANGLE_SLACK_DEG;
  const facingNorth = Math.abs(map.getBearing()) <= ANGLE_SLACK_DEG;

  setShifted(!(centered && zoomed && pitched && facingNorth));
}

export function initCampusMap() {
  const container = document.getElementById(CONTAINER_ID);
  if (!container) return;

  // Either campus picker changing — the Available tab's or the campus
  // sheet's own (components/campus-buildings.js), now kept in sync as the
  // same logical picker — drives the map: whichever campus it's on, the map
  // flies there and shows its buildings, same motion as tapping that
  // campus's marker directly.
  campusContainer = container;
  document.addEventListener('campuschange', (e) => {
    if (!map || !mapboxglLib || embed) return;
    const campus = campuses().find(c => c.id === e.detail.id);
    if (!campus || typeof campus.lat !== 'number' || typeof campus.long !== 'number') return;
    flyToCampus(mapboxglLib, campus);
  });

  // The sheet's own recenter button (shown once `shifted` above goes true) —
  // targets whichever level (building or campus) is actually selected right
  // now, same as updateShifted()'s own check.
  document.addEventListener('campusrecenter', () => {
    if (!map || !mapboxglLib || embed) return;
    const building = selectedBuilding();
    if (building) { flyToBuilding(mapboxglLib, building); return; }
    const campus = selectedCampus();
    if (!campus) return;
    flyToCampus(mapboxglLib, campus);
  });

  // The sheet's own building page (components/campus-buildings.js) — a
  // building card tap, its back button, or a language-switch re-render, all
  // ride this same event (see that file's header comment). A building
  // marker tap (below) also dispatches it, so this one listener drives the
  // camera for every source uniformly, rather than each source flying the
  // map itself.
  document.addEventListener('buildingchange', (e) => {
    if (!map || !mapboxglLib || embed) return;
    const campus = campuses().find(c => c.id === e.detail.campusId);
    if (!campus) return;
    if (e.detail.buildingId) {
      const building = (campus.buildings || []).find(b => b.name === e.detail.buildingId);
      if (building && typeof building.lat === 'number' && typeof building.long === 'number') {
        flyToBuilding(mapboxglLib, building);
      }
    } else if (typeof campus.lat === 'number' && typeof campus.long === 'number') {
      // Back to the campus page — zoom the camera back out to the
      // campus-level view (building markers stay up, same as a plain campus
      // pick).
      flyToCampus(mapboxglLib, campus);
    }
  });

  // Sheet resize (drag/wheel, its settle spring, or an auto-expand — see
  // components/campus-sheet.js's own dispatch comment) — keep the padding
  // (and, while something's focused, the camera itself) glued to its actual
  // live footprint instead of just the detent it started at.
  document.addEventListener('campussheetresize', (e) => {
    sheetHeightPx = e.detail.height;
    followSheetResize();
  });

  const onVisible = () => {
    if (!bootPromise) {
      deferredBoot(container);
    } else if (map) {
      // Container may have resized (rotation, toolbar) while the tab was hidden.
      map.resize();
    }
  };

  container.addEventListener('tabvisible', onVisible);
  if (container.classList.contains('visible')) onVisible();

  // `container` keeps its `.visible` class even while the classroom detail
  // or info overlay is open on top of this tab (they only collapse
  // `.tab-content` to height 0 via `body.detail-open`/`body.info-open` —
  // see classroom-detail.css/info-page.css) — so every scroll-lock listener
  // below must also check those aren't active, or it keeps blocking/undoing
  // scroll on those (normal, in-flow) overlay pages.
  const isScrollLocked = () =>
    container.classList.contains('visible') &&
    !document.body.classList.contains('detail-open') &&
    !document.body.classList.contains('info-open');

  // `touch-action: none` (campus-map.css) only blocks touch/pen scroll
  // gestures on the page, not mouse-wheel or trackpad scroll — a wheel
  // event over the header or bottom-nav (both floating outside this
  // container, above the deliberately overflowing page — see
  // campus-map.css) still scrolls the document. Block it here instead;
  // wheel events that land inside the container are left alone; the map's
  // own listener (onWheel below) already calls preventDefault for those.
  window.addEventListener('wheel', e => {
    if (!isScrollLocked()) return;
    if (container.contains(e.target)) return;
    // The settings popup renders outside this container, in document.body,
    // and manages its own scroll lock — leave its wheel events alone rather
    // than blocking them as if they were page scroll.
    if (e.target.closest?.('.settings-popup')) return;
    e.preventDefault();
  }, { passive: false });

  // Same idea for the keyboard: Space, Page Up/Down, Home, End, and the
  // arrow keys all scroll the page by default when nothing focused claims
  // them — none of which fire a 'wheel' event, so the blocker above doesn't
  // see them. Skip it when focus is on something that's meant to handle
  // these itself (a map control button, a link, a form field) so keyboard
  // activation/navigation there keeps working.
  const SCROLL_KEYS = new Set([' ', 'Spacebar', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
  window.addEventListener('keydown', e => {
    if (!isScrollLocked()) return;
    if (!SCROLL_KEYS.has(e.key)) return;
    const el = document.activeElement;
    const tag = el?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || el?.isContentEditable || el?.closest?.('a[href]')) return;
    e.preventDefault();
  });

  // iOS Safari's own scroll indicator (the thin translucent strip on the
  // right edge, shown because the page is deliberately overflowing — see
  // campus-map.css) can be grabbed and dragged directly with a finger,
  // scrolling the page — a gesture that bypasses touch-action entirely,
  // since it's the browser's own scroll-affordance chrome, not a touch
  // gesture on the page's content. Since nothing should ever actually be
  // scrolled here, just snap straight back to 0 the instant it isn't,
  // however it happened — catches this and any other stray way in.
  window.addEventListener('scroll', () => {
    if (!isScrollLocked()) return;
    if (scrollY !== 0) window.scrollTo(0, 0);
  }, { passive: true });
}

/* Booting Mapbox — token, script parse, WebGL context, first tiles — is about
   a second of main-thread work, and the tab it lands in is running its own
   0.3s blur-and-scale entrance (`appear` in style.css) at exactly that moment,
   so doing it on `tabvisible` is what made switching to the Campus tab stutter
   the first time in a session. It can't move off the main thread (Mapbox needs
   the DOM and a WebGL context; its own workers only handle tiles), but it can
   wait: first for the tab's entrance animation to finish, then for an idle
   slot. The map fades in when it's ready (see .campus-map in campus-map.css),
   which is also why nothing is missed by waiting.

   The classroom detail page defers its own embed the same way, and waits for
   the map section to be scrolled near as well — see _scheduleMapEmbed() in
   classroom-detail.js. */
function deferredBoot(container) {
  const entrance = container.getAnimations?.() ?? [];
  // Raced against a deadline: waiting on an animation is only worth doing if
  // it actually ends, and nothing here should be able to hold the map back for
  // longer than the entrance itself takes.
  const settled = entrance.length
    ? Promise.race([
        Promise.allSettled(entrance.map(a => a.finished)),
        new Promise(resolve => setTimeout(resolve, 400)),
      ])
    : Promise.resolve();
  settled.then(() => {
    // A short idle deadline, not a long one: by now the entrance is over and
    // the thread is usually free anyway, so this is about slotting in politely
    // rather than about waiting.
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => ensureMap(), { timeout: 150 });
    else setTimeout(ensureMap, 60);
  });
}

// Boots the map once (from whichever surface asks first: the Campus tab or a
// directly-loaded detail page) and hands every later caller the same promise.
function ensureMap() {
  if (!bootPromise) {
    bootPromise = boot().catch(err => {
      console.error('Campus map failed to load', err);
      if (!embed && campusContainer) showError(campusContainer);
    });
  }
  return bootPromise;
}

// Puts the map element where it currently belongs: the detail card while a
// preview is requested, the Campus tab otherwise.
function placeEl() {
  if (!mapEl) return;
  const parent = embed?.host ?? campusContainer;
  if (parent && mapEl.parentNode !== parent) parent.appendChild(mapEl);
  mapEl.classList.toggle('campus-map--embedded', !!embed?.host);
}

async function boot() {
  const token = await getMapboxToken();
  const mapboxgl = await loadMapboxGl();
  mapboxglLib = mapboxgl;

  // Whoever wants the map right now (read after the awaits above): a detail
  // page opened straight from a URL builds it in place, at its building.
  const startEmbed = embed;
  createdForEmbed = !!startEmbed;

  const el = document.createElement('div');
  el.className = 'campus-map';
  el.setAttribute('role', 'application');
  el.setAttribute('aria-label', t('tabs.campus'));
  mapEl = el;
  placeEl();

  // Opens straight onto whichever campus the sheet's picker already has
  // selected, at the same spot/zoom a marker tap flies to — rather than the
  // region-wide overview.
  const startCampus = startEmbed ? null : selectedCampus();

  mapboxgl.accessToken = token;
  map = new mapboxgl.Map({
    container: el,
    style: 'mapbox://styles/mapbox/standard',
    center: startEmbed ? [startEmbed.long, startEmbed.lat] : startCampus ? [startCampus.long, startCampus.lat] : INITIAL_CENTER,
    zoom: startEmbed ? EMBED_ZOOM : startCampus ? CAMPUS_FLY_ZOOM : INITIAL_ZOOM,
    minZoom: 8.5,
    maxZoom: 18,
    pitch: startEmbed ? POV[embedPov].pitch : startCampus ? 55 : 0,
    bearing: startEmbed ? POV[embedPov].bearing : 0,
    maxPitch: 70,
    pitchWithRotate: true,
    touchPitch: true,
    logoPosition: 'bottom-left',
  });

  // The constructor's own `center`/`zoom`/`pitch` above ignore `padding` —
  // only jumpTo/easeTo/flyTo actually offset `center` by it. Re-apply the
  // same camera through jumpTo (no animation, runs before the first paint)
  // so the initial view is padding-aware too, not just later flyTo's (see
  // flyToCampus()).
  if (startCampus) {
    map.jumpTo({
      center: [startCampus.long, startCampus.lat],
      zoom: CAMPUS_FLY_ZOOM,
      pitch: 55,
      padding: mapPadding(),
    });
  }

  // Desktop trackpad: a two-finger swipe should pan the map, not zoom it.
  // Wheel zoom is kept only for the pinch gesture, which the browser reports
  // as a ctrl-wheel event.
  map.scrollZoom.disable();
  el.addEventListener('wheel', e => onWheel(e, el), { passive: false });

  // Safari trackpad pinch doesn't come through as a ctrl+wheel event like
  // Chrome/Firefox synthesize — it fires the non-standard Safari-only
  // gesture* events instead. preventDefault-ing those stops the page zooming
  // and lets us drive the map ourselves.
  //
  // On iPadOS this pinch fires no DOM event at all — confirmed on-device: no
  // wheel, no gesture*, no touch*, nothing. UIKit applies a native page-zoom
  // entirely outside the DOM before JS ever sees it. The only place it
  // becomes visible to JS is afterwards, via `visualViewport`'s scale — by
  // which point the page has already visibly zoomed, and there's no reliable
  // way to force it back to 1 (both `user-scalable=no`/`maximum-scale` and
  // rewriting the viewport meta's `initial-scale` were tried on-device and
  // didn't stop the visible zoom). Left as a known Safari/iPadOS limitation.
  //
  // `'ongesturestart' in window` alone isn't enough to scope this to the
  // trackpad, though — it's true on every WebKit browser, iPadOS Safari's
  // real touchscreen included, and it turns out a two-finger touch pinch
  // *does* fire these there (contradicting the on-device finding above,
  // maybe from an OS update since). Since this handler only ever reads
  // `e.scale` — no pan translation, no `e.rotation` — hijacking a touch
  // gesture into it broke simultaneous pan+zoom and rotate entirely.
  // Gate it to non-touch devices so it's trackpad-only, same as intended.
  if ('ongesturestart' in window && navigator.maxTouchPoints === 0) {
    let gestureStartZoom = 0;
    el.addEventListener('gesturestart', e => {
      e.preventDefault();
      gestureStartZoom = map.getZoom();
    });
    el.addEventListener('gesturechange', e => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const around = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
      map.easeTo({ zoom: gestureStartZoom + Math.log2(e.scale), around, duration: 0 });
    });
    el.addEventListener('gestureend', e => e.preventDefault());
  }

  const navControl = new mapboxgl.NavigationControl({ showZoom: false, showCompass: true });
  map.addControl(navControl, 'top-right');
  const geolocateControl = new mapboxgl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: true,
    showUserHeading: true,
  });
  map.addControl(geolocateControl, 'top-right');

  // `liquid-glass` (components/liquid-glass.js) must go on the actual
  // <button>, not the wrapping .mapboxgl-ctrl-group div: its delegated
  // pointerdown handler treats any `<button>` under the pressed element as
  // an "inner control" and defers to it (that's what lets a link inside a
  // popover keep its own click instead of triggering the panel's deform) —
  // put the class on the group and every press on the real button is
  // silently ignored, which is why it looked completely inert. Only the
  // geolocate button gets it, though: the compass button has Mapbox's own
  // drag-to-rotate handler (NavigationControl's `rl` MouseRotateHandler)
  // bound directly to it, and liquid-glass's pointer-capture-on-press would
  // steal those pointer events out from under it. The compass gets a
  // CSS-only hover/press state instead (see campus-map.css) that mimics the
  // same lit look without capturing the pointer.
  //
  // Swap in a HugeIcons glyph (same `hgi-` icon font already used for the
  // header buttons — index.html) for the geolocate button's baked-in icon
  // SVG, so it reads as part of the app rather than a third-party widget.
  // The compass needle is drawn in pure CSS instead (see campus-map.css) —
  // HugeIcons' own "compass" glyphs read as the drafting tool, not a map
  // compass, and a plain two-triangle needle (red north tip) is clearer here
  // anyway.

  // GeolocateControl builds its actual <button> asynchronously (behind a
  // `navigator.permissions.query(...)` check), so it doesn't exist yet right
  // after addControl() returns — watch for it instead of assuming it's there.
  new MutationObserver((_records, observer) => {
    const button = geolocateControl._container.querySelector('button');
    if (!button) return;
    button.classList.add('liquid-glass');
    button.querySelector('.mapboxgl-ctrl-icon')
      .innerHTML = '<i class="hgi-stroke hgi-gps-01" aria-hidden="true"></i>';
    observer.disconnect();
  }).observe(geolocateControl._container, { childList: true });

  // Same glass + liquid-glass treatment for the attribution control's
  // compact toggle badge (campus-map.css). Mapbox adds this control itself
  // (there's no explicit instance to hold onto like NavigationControl/
  // GeolocateControl above), so watch the whole map container for its
  // button to show up instead.
  new MutationObserver((_records, observer) => {
    const button = map.getContainer().querySelector('.mapboxgl-ctrl-attrib-button');
    if (!button) return;
    button.classList.add('liquid-glass');
    button.querySelector('.mapboxgl-ctrl-icon')
      .innerHTML = '<i class="hgi-stroke hgi-information-circle" aria-hidden="true"></i>';
    observer.disconnect();
  }).observe(map.getContainer(), { childList: true, subtree: true });

  // Match the map's daylight to the app theme (Standard style only), and
  // reveal the map here rather than on 'load': 'load' means the first
  // *visually complete* render — every tile, every glyph — which on a slow
  // connection is seconds away. From 'style.load' the map paints its
  // background and fills in tiles as they arrive, which is what it looked like
  // before any of this was deferred, only now it fades in instead of popping.
  map.on('style.load', () => {
    applyLightPreset();
    el.classList.add('campus-map--ready');
  });
  darkScheme.addEventListener('change', applyLightPreset);

  map.on('load', () => {
    el.classList.add('campus-map--ready');  // belt: a style that loaded without firing style.load
    map.resize();
    if (markers.length) return;  // an embed/release already put its own up
    if (embed) showEmbedMarker(mapboxgl);
    else if (startCampus) showBuildingMarkers(mapboxgl, startCampus);
    else showCampusMarkers(mapboxgl);
  });

  // And braces: a style that never loads at all shouldn't leave the map (and
  // its own error UI) invisible behind the fade-in.
  setTimeout(() => el.classList.add('campus-map--ready'), 3000);

  if (startEmbed) setInteractive(false);

  // Zoom back out past a campus → return to the campus overview.
  map.on('zoomend', () => {
    if (!embed && mode === 'buildings' && map.getZoom() < CAMPUS_ZOOM) {
      // A zoom-out this big leaves any single-building focus behind too —
      // fall the sheet back to its campus page in sync (see
      // clearSelectedBuildingSilently()'s own note on why this doesn't just
      // dispatch 'buildingchange' like every other path here does).
      clearSelectedBuildingSilently();
      showCampusMarkers(mapboxgl);
      if (map.getPitch() > 0) map.easeTo({ pitch: 0, duration: reduceMotion.matches ? 0 : 600 });
    }
  });

  // Soft geographic leash: after any move, if the centre has drifted outside
  // Lombardy, ease it back. Doesn't touch pitch, unlike constructor maxBounds.
  map.on('moveend', panBackInBounds);

  // Re-check "shifted" (see updateShifted() above) after every settle —
  // covers every way the camera can end up off the auto-centered view (pan,
  // zoom, rotate, pitch), from any source (drag, wheel/trackpad, a control
  // button), including Mapbox-native interactions like the NavigationControl
  // compass's own drag-to-rotate/click-to-reset-north.
  map.on('moveend', updateShifted);

  // Keep the GL canvas glued to the panel through rotations / dynamic toolbars.
  new ResizeObserver(() => { if (map) map.resize(); }).observe(el);
}

function onWheel(e, el) {
  if (!map || embed) return;
  e.preventDefault(); // stop page scroll / trackpad back-swipe navigation

  // deltaMode 1 = lines (Firefox), 2 = pages — normalise to pixels.
  const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;

  if (e.ctrlKey) {
    // Trackpad pinch (or ctrl+wheel) → zoom around the cursor.
    const rect = el.getBoundingClientRect();
    const around = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
    map.easeTo({ zoom: map.getZoom() - e.deltaY * scale * 0.01, around, duration: 0 });
    return;
  }

  // Two-finger swipe → pan the map, following the fingers on both axes.
  map.panBy([e.deltaX * scale, e.deltaY * scale], { duration: 0 });
}

let clampingBounds = false;
function panBackInBounds() {
  if (!map || clampingBounds || embed) return;
  const [[w, s], [e, n]] = MAX_BOUNDS;
  const c = map.getCenter();
  const lng = Math.min(e, Math.max(w, c.lng));
  const lat = Math.min(n, Math.max(s, c.lat));
  if (lng === c.lng && lat === c.lat) return;
  clampingBounds = true;
  map.easeTo({ center: [lng, lat], duration: reduceMotion.matches ? 0 : 300 });
  map.once('moveend', () => { clampingBounds = false; });
}

function loadMapboxGl() {
  if (window.mapboxgl) return Promise.resolve(window.mapboxgl);

  const base = `https://api.mapbox.com/mapbox-gl-js/v${MAPBOX_VERSION}`;

  const css = new Promise(resolve => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${base}/mapbox-gl.css`;
    // Non-fatal if it fails — the map still renders, controls just sit slightly off.
    link.onload = resolve;
    link.onerror = resolve;
    document.head.appendChild(link);
  });

  const js = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${base}/mapbox-gl.js`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load mapbox-gl.js'));
    document.head.appendChild(script);
  });

  return Promise.all([css, js]).then(() => {
    if (!window.mapboxgl) throw new Error('mapbox-gl.js loaded but window.mapboxgl is missing');
    return window.mapboxgl;
  });
}

function applyLightPreset() {
  if (!map || !map.setConfigProperty) return;
  try {
    map.setConfigProperty('basemap', 'lightPreset', darkScheme.matches ? 'night' : 'day');
  } catch {
    /* style not ready or not the Standard style — ignore */
  }
}

function campuses() {
  return Array.isArray(classroomsData) ? classroomsData : [];
}

// The campus sheet's own picker's current selection, if it names a campus
// with known coordinates — null otherwise (picker not set up yet, or a
// campus with no lat/long).
function selectedCampus() {
  const id = getSelectedCampusId();
  if (!id) return null;
  const campus = campuses().find(c => c.id === id);
  return campus && typeof campus.lat === 'number' && typeof campus.long === 'number' ? campus : null;
}

// The campus sheet's building page's current selection (components/
// campus-buildings.js), if it names a building with known coordinates —
// null otherwise (no building selected, or one with no lat/long).
function selectedBuilding() {
  const campus = selectedCampus();
  if (!campus) return null;
  const id = getSelectedBuildingId();
  if (!id) return null;
  const building = (campus.buildings || []).find(b => b.name === id);
  return building && typeof building.lat === 'number' && typeof building.long === 'number' ? building : null;
}

// The camera target implied by the current selection — a building if one's
// selected, else its campus, else null. Shared by updateShifted() and the
// recenter button's handler so both agree on what "centered" means right now.
function selectedFocus() {
  const building = selectedBuilding();
  if (building) return { lat: building.lat, long: building.long, zoom: BUILDING_FLY_ZOOM };
  const campus = selectedCampus();
  if (campus) return { lat: campus.lat, long: campus.long, zoom: CAMPUS_FLY_ZOOM };
  return null;
}

function clearMarkers() {
  markers.forEach(m => m.remove());
  markers = [];
}

function flyOpts(extra, mobileHeightOverride) {
  return { duration: reduceMotion.matches ? 0 : 1200, essential: true, padding: mapPadding(mobileHeightOverride), ...extra };
}

// See the SHEET_* constants above — reserves the sheet's own footprint so
// `center` lands in the middle of the map's actually-visible remainder.
// `mobileHeightOverride` lets a caller target a height the sheet hasn't
// actually reached yet (see flyToBuilding()'s own comment) instead of its
// current live one.
function mapPadding(mobileHeightOverride) {
  if (desktopMQ.matches) {
    return { top: 0, bottom: 0, left: 0, right: SHEET_DESKTOP_WIDTH + SHEET_DESKTOP_GAP };
  }
  const height = mobileHeightOverride ?? sheetHeightPx;
  const bottom = Math.min(height + SHEET_MOBILE_GAP, Math.max(0, innerHeight - SHEET_MOBILE_MIN_VISIBLE));
  return { top: 0, right: 0, left: 0, bottom };
}

// Shared by flyToCampus/flyToBuilding below — starts (or, mid-flight,
// swapped in as the new target of — see followSheetResize()) a flyTo towards
// `destination`, tracking it in `flyDestination` for the duration.
function startFly(destination, mobileHeightOverride) {
  flyDestination = destination;
  autoFlying = true;
  lastFlyRetargetAt = performance.now();
  map.flyTo(flyOpts(destination, mobileHeightOverride));
  map.once('moveend', () => { autoFlying = false; flyDestination = null; });
}

// Flies to a campus and swaps to its building markers — shared by a marker
// tap and either picker's 'campuschange' (see initCampusMap()).
function flyToCampus(mapboxgl, campus) {
  showBuildingMarkers(mapboxgl, campus);
  // `bearing: 0` resets any rotation too — see updateShifted()'s facingNorth
  // check, and moveend re-derives `shifted` once this settles.
  startFly({ center: [campus.long, campus.lat], zoom: CAMPUS_FLY_ZOOM, pitch: 55, bearing: 0 });
}

// Zooms in further on a single building, one step past flyToCampus() above —
// the building markers themselves don't change (every building in the
// campus stays visible and tappable, see the sheet's own back-button note),
// only the camera moves.
function flyToBuilding(mapboxgl, building) {
  // Selecting a building auto-expands a collapsed sheet (campus-sheet.js's
  // own 'buildingpageopen' listener), running concurrently with this fly —
  // aim at the padding it's about to settle at (heightAfterBuildingSelect())
  // rather than its current, about-to-be-stale one, or the marker would land
  // centered against a footprint the sheet has already outgrown by the time
  // the camera gets there.
  startFly({ center: [building.long, building.lat], zoom: BUILDING_FLY_ZOOM, pitch: 55, bearing: 0 }, heightAfterBuildingSelect());
}

// Keeps the camera glued to whatever's currently focused (a building, else
// its campus) as the sheet resizes, so the focused marker never ends up
// hidden behind a sheet that grew out from under it.
function followSheetResize() {
  if (!map || !mapboxglLib || desktopMQ.matches || embed) return;

  if (autoFlying) {
    // A flyTo is mid-flight (see startFly()) — its own padding was only a
    // snapshot from the moment it started (heightAfterBuildingSelect()'s
    // *predicted* final footprint, for a building fly). That's fine while
    // the sheet is just auto-expanding on its own towards that same
    // prediction, but if the user actually grabs the sheet and drags it
    // somewhere else mid-flight, keep retargeting the same destination with
    // its real current footprint instead of landing against a detent it
    // never actually settles at. isUserResizing() is what scopes this to a
    // live gesture — the sheet's own settle spring alone doesn't retrigger
    // this, since it's already tracking towards what the fly predicted.
    if (!flyDestination || !isUserResizing()) return;
    const now = performance.now();
    if (now - lastFlyRetargetAt < FLY_RETARGET_THROTTLE_MS) return;
    lastFlyRetargetAt = now;
    map.flyTo(flyOpts(flyDestination));
    return;
  }

  // No flight in progress — live-follow only while the camera's already on
  // the auto-centered view; if the user's manually panned away from it
  // (`shifted`), updateShifted() above already offers a recenter button for
  // that instead of this silently fighting the pan.
  const focus = selectedFocus();
  if (!focus || shifted) return;
  map.easeTo({ center: [focus.long, focus.lat], padding: mapPadding(), duration: 0 });
}

function buildingLabel(b) {
  const alt = (b.altName || '').trim();
  return alt || `${t('building.prefix')} ${b.name}`;
}

function showCampusMarkers(mapboxgl) {
  clearMarkers();
  mode = 'campus';

  for (const campus of campuses()) {
    const { lat, long } = campus;
    if (typeof lat !== 'number' || typeof long !== 'number') continue;

    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'campus-marker';
    el.innerHTML = `<span class="campus-marker__dot"></span><span>${escapeHtml(campus.name)}</span>`;
    el.addEventListener('click', () => {
      flyToCampus(mapboxgl, campus);
    });

    markers.push(
      new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([long, lat])
        .addTo(map)
    );
  }
}

function showBuildingMarkers(mapboxgl, campus) {
  clearMarkers();
  mode = 'buildings';
  markerCampus = campus;

  for (const b of campus.buildings || []) {
    const { lat, long } = b;
    if (typeof lat !== 'number' || typeof long !== 'number') continue;

    const label = buildingLabel(b);

    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'campus-marker campus-marker--building';
    el.innerHTML = `<span class="campus-marker__dot"></span><span>${escapeHtml(label)}</span>`;
    // Selects the building in the sheet's own building page (components/
    // campus-buildings.js) and, via the 'buildingchange' listener above,
    // flies the camera in — same tap-to-drill-in as a building card there.
    el.addEventListener('click', () => {
      document.dispatchEvent(new CustomEvent('buildingchange', { detail: { campusId: campus.id, buildingId: b.name } }));
    });

    markers.push(
      new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([long, lat])
        .addTo(map)
    );
  }
}

function showError(container) {
  const el = document.createElement('div');
  el.className = 'campus-map-error';
  el.textContent = t('campus.mapError');
  container.appendChild(el);
}

// ── Classroom detail preview ───────────────────────────────────────────
// The detail page's "location" card shows this same map, 3D-tilted onto the
// building. Constructing a Map() is a billed load, so it's never rebuilt:
// embedMap() moves the one instance into the card (booting it there if the
// page was opened straight from a URL), parkMap() steps it out of the way
// before the page wipes its DOM, and releaseMap() sends it back to the
// Campus tab with the camera and markers it had.

const INTERACTION_HANDLERS = ['dragPan', 'dragRotate', 'touchZoomRotate', 'touchPitch', 'doubleClickZoom', 'keyboard', 'boxZoom'];

// The preview sits inside a scrolling page, so it's view-only — leaving the
// gestures on would swallow the page's own touch/wheel scrolling.
function setInteractive(on) {
  for (const h of INTERACTION_HANDLERS) map[h]?.[on ? 'enable' : 'disable']();
}

function showEmbedMarker(mapboxgl) {
  clearMarkers();
  mode = 'embedded';
  const add = (lat, long, cls, label) => {
    const el = document.createElement('div');
    el.className = `campus-marker campus-marker--building campus-marker--static ${cls}`;
    el.innerHTML = `<span class="campus-marker__dot"></span>${label ? `<span>${escapeHtml(label)}</span>` : ''}`;
    markers.push(new mapboxgl.Marker({ element: el, anchor: 'bottom' }).setLngLat([long, lat]).addTo(map));
  };
  // 2D is the campus overview: the rest of the campus as quiet dots, this
  // building labelled. 3D is just the building.
  if (embedPov === '2d') {
    for (const b of embed.siblings ?? []) {
      if (b.lat !== embed.lat || b.long !== embed.long) add(b.lat, b.long, 'campus-marker--dim');
    }
  }
  add(embed.lat, embed.long, 'campus-marker--current', embed.label);
}

// Camera for a point of view: 3D tilts in on the building; 2D pulls back,
// top-down, to fit the whole campus around it.
function embedCamera(pov) {
  const { pitch, bearing } = POV[pov];
  const base = { center: [embed.long, embed.lat], zoom: EMBED_ZOOM, pitch, bearing };
  if (pov !== '2d') return base;
  const pts = [[embed.long, embed.lat], ...(embed.siblings ?? []).map(b => [b.long, b.lat])];
  const bounds = pts.reduce((b, p) => b.extend(p), new mapboxglLib.LngLatBounds(pts[0], pts[0]));
  const fit = map.cameraForBounds(bounds, { padding: 44, maxZoom: EMBED_ZOOM, bearing, pitch });
  return fit ? { ...base, center: fit.center, zoom: fit.zoom } : base;
}

function captureView() {
  return {
    camera: { center: map.getCenter(), zoom: map.getZoom(), pitch: map.getPitch(), bearing: map.getBearing(), padding: map.getPadding() },
    mode,
    campus: markerCampus,
  };
}

function applyEmbedView() {
  setInteractive(false);
  const key = `${embed.lat},${embed.long}`;
  const unchanged = embedShownKey === key && mode === 'embedded';
  embedShownKey = key;
  if (unchanged) {
    // Same building, e.g. a language switch re-render: keep the camera.
    showEmbedMarker(mapboxglLib);
    return;
  }
  showEmbedMarker(mapboxglLib);
  const camera = { ...embedCamera(embedPov), padding: { top: 0, right: 0, bottom: 0, left: 0 } };
  if (reduceMotion.matches || camera.pitch === 0) {
    map.jumpTo(camera);
  } else {
    // Settle in from a flatter angle so the tilt reads as the map rising.
    map.jumpTo({ ...camera, pitch: 25 });
    map.easeTo({ pitch: camera.pitch, duration: 1200 });
  }
}

/**
 * Shows the shared map in `host`, 3D-tilted onto a building. Resolves once
 * it's in place (false if superseded or released meanwhile).
 */
export async function embedMap(host, { lat, long, label, siblings }) {
  const token = ++embedToken;
  embed = { host, lat, long, label, siblings };
  await ensureMap();
  if (token !== embedToken || !map || !embed) return false;

  if (!embedActive) {
    // A map built by this very request has no campus view of its own yet.
    savedView = createdForEmbed ? null : captureView();
    embedActive = true;
  }
  placeEl();
  map.resize();
  applyEmbedView();
  return true;
}

/** Moves the map out of the detail page (still in preview state) before its DOM is rebuilt. */
export function parkMap() {
  if (!embed) return;
  embed.host = null;
  placeEl();
}

/** Ends the preview: the map goes back to the Campus tab exactly as it was left. */
export function releaseMap() {
  embedToken++;
  if (!embed) return;
  embed = null;
  if (!map) return;  // still booting: boot() sees `embed` gone and builds for the tab
  if (!embedActive && !createdForEmbed) return;  // preview never took over this map

  embedActive = false;
  embedShownKey = null;
  setInteractive(true);
  placeEl();
  map.resize();

  const view = savedView;
  savedView = null;
  createdForEmbed = false;
  if (view) {
    map.jumpTo(view.camera);
    if (view.mode === 'buildings' && view.campus) showBuildingMarkers(mapboxglLib, view.campus);
    else showCampusMarkers(mapboxglLib);
    return;
  }
  // Built for the detail page: give the Campus tab its usual opening view.
  const campus = selectedCampus();
  if (campus) {
    map.jumpTo({ center: [campus.long, campus.lat], zoom: CAMPUS_FLY_ZOOM, pitch: 55, bearing: 0, padding: mapPadding() });
    showBuildingMarkers(mapboxglLib, campus);
  } else {
    map.jumpTo({ center: INITIAL_CENTER, zoom: INITIAL_ZOOM, pitch: 0, bearing: 0, padding: mapPadding() });
    showCampusMarkers(mapboxglLib);
  }
}

export const getEmbedPov = () => embedPov;

/** Switches the preview between '2d' (top-down, north up) and '3d' (tilted). */
export function setEmbedPov(pov) {
  if (!POV[pov] || pov === embedPov) return;
  embedPov = pov;
  if (!map || !embedActive) return;
  showEmbedMarker(mapboxglLib);
  map.easeTo({ ...embedCamera(pov), duration: reduceMotion.matches ? 0 : 800, essential: true });
}
