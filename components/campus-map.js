import { getMapboxToken } from '../config.js';
import { classroomsData } from '../classroom-search-data.js';
import { t } from '../i18n.js';
import { escapeHtml } from '../utils/html.js';
import { haptics, defaultPatterns } from './haptics.js';
import { getSelectedCampusId } from './campus-buildings.js';

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

// The campus sheet (components/campus-sheet.{js,css}) covers part of the map
// — a right-pinned panel on desktop, a bottom one on mobile — so a plain
// `center` lands a picked campus in the middle of the WHOLE canvas, part of
// which is actually hidden under the sheet. `padding` (below) tells Mapbox to
// center within the remaining, actually-visible area instead. Mirrors
// campus-sheet.css's desktop panel width (420px) + its 20px right gap, and
// campus-sheet.js's own COLLAPSED mobile height (192px) + its 20px bottom
// gap — the sheet's own footprint before it's been dragged open any further,
// which is the only state this accounts for (matching the sheet's own
// initial detent, not whatever it's later dragged to).
const SHEET_DESKTOP_WIDTH = 420;
const SHEET_DESKTOP_GAP = 20;
const SHEET_MOBILE_COLLAPSED = 192;
const SHEET_MOBILE_GAP = 20;
const desktopMQ = matchMedia('(min-width: 600px)');

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const darkScheme = window.matchMedia('(prefers-color-scheme: dark)');

let started = false;
let map = null;
let mapboxglLib = null;  // set once loaded — reused by the picker's change listener below
let mode = 'campus';   // 'campus' | 'buildings'
let markers = [];      // currently-rendered mapboxgl.Marker[]

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
  const campus = selectedCampus();
  if (!campus) { setShifted(false); return; }

  const canvas = map.getCanvas();
  const padding = mapPadding();
  const targetX = (padding.left + (canvas.clientWidth - padding.right)) / 2;
  const targetY = (padding.top + (canvas.clientHeight - padding.bottom)) / 2;
  const px = map.project([campus.long, campus.lat]);

  const centered = Math.abs(px.x - targetX) <= CENTER_SLACK_PX && Math.abs(px.y - targetY) <= CENTER_SLACK_PX;
  const zoomed = Math.abs(map.getZoom() - CAMPUS_FLY_ZOOM) <= 0.05;
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
  document.addEventListener('campuschange', (e) => {
    if (!map || !mapboxglLib) return;
    const campus = campuses().find(c => c.id === e.detail.id);
    if (!campus || typeof campus.lat !== 'number' || typeof campus.long !== 'number') return;
    flyToCampus(mapboxglLib, campus);
  });

  // The sheet's own recenter button (shown once `shifted` above goes true).
  document.addEventListener('campusrecenter', () => {
    if (!map || !mapboxglLib) return;
    const campus = selectedCampus();
    if (!campus) return;
    flyToCampus(mapboxglLib, campus);
  });

  const onVisible = () => {
    if (!started) {
      started = true;
      boot(container).catch(err => {
        console.error('Campus map failed to load', err);
        showError(container);
      });
    } else if (map) {
      // Container may have resized (rotation, toolbar) while the tab was hidden.
      map.resize();
    }
  };

  container.addEventListener('tabvisible', onVisible);
  if (container.classList.contains('visible')) onVisible();

  // `touch-action: none` (campus-map.css) only blocks touch/pen scroll
  // gestures on the page, not mouse-wheel or trackpad scroll — a wheel
  // event over the header or bottom-nav (both floating outside this
  // container, above the deliberately overflowing page — see
  // campus-map.css) still scrolls the document. Block it here instead;
  // wheel events that land inside the container are left alone; the map's
  // own listener (onWheel below) already calls preventDefault for those.
  window.addEventListener('wheel', e => {
    if (!container.classList.contains('visible')) return;
    if (container.contains(e.target)) return;
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
    if (!container.classList.contains('visible')) return;
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
    if (!container.classList.contains('visible')) return;
    if (scrollY !== 0) window.scrollTo(0, 0);
  }, { passive: true });
}

async function boot(container) {
  const token = await getMapboxToken();
  const mapboxgl = await loadMapboxGl();
  mapboxglLib = mapboxgl;

  const el = document.createElement('div');
  el.className = 'campus-map';
  el.setAttribute('role', 'application');
  el.setAttribute('aria-label', t('tabs.campus'));
  container.appendChild(el);

  // Opens straight onto whichever campus the sheet's picker already has
  // selected, at the same spot/zoom a marker tap flies to — rather than the
  // region-wide overview.
  const startCampus = selectedCampus();

  mapboxgl.accessToken = token;
  map = new mapboxgl.Map({
    container: el,
    style: 'mapbox://styles/mapbox/standard',
    center: startCampus ? [startCampus.long, startCampus.lat] : INITIAL_CENTER,
    zoom: startCampus ? CAMPUS_FLY_ZOOM : INITIAL_ZOOM,
    minZoom: 8.5,
    maxZoom: 18,
    pitch: startCampus ? 55 : 0,
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

  // Match the map's daylight to the app theme (Standard style only).
  map.on('style.load', applyLightPreset);
  darkScheme.addEventListener('change', applyLightPreset);

  map.on('load', () => {
    map.resize();
    if (startCampus) showBuildingMarkers(mapboxgl, startCampus);
    else showCampusMarkers(mapboxgl);
  });

  // Zoom back out past a campus → return to the campus overview.
  map.on('zoomend', () => {
    if (mode === 'buildings' && map.getZoom() < CAMPUS_ZOOM) {
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
  if (!map) return;
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
  if (!map || clampingBounds) return;
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

function clearMarkers() {
  markers.forEach(m => m.remove());
  markers = [];
}

function flyOpts(extra) {
  return { duration: reduceMotion.matches ? 0 : 1200, essential: true, padding: mapPadding(), ...extra };
}

// See the SHEET_* constants above — reserves the sheet's own footprint so
// `center` lands in the middle of the map's actually-visible remainder.
function mapPadding() {
  return desktopMQ.matches
    ? { top: 0, bottom: 0, left: 0, right: SHEET_DESKTOP_WIDTH + SHEET_DESKTOP_GAP }
    : { top: 0, right: 0, left: 0, bottom: SHEET_MOBILE_COLLAPSED + SHEET_MOBILE_GAP };
}

// Flies to a campus and swaps to its building markers — shared by a marker
// tap and either picker's 'campuschange' (see initCampusMap()).
function flyToCampus(mapboxgl, campus) {
  showBuildingMarkers(mapboxgl, campus);
  // `bearing: 0` resets any rotation too — see updateShifted()'s facingNorth
  // check, and moveend re-derives `shifted` once this settles.
  map.flyTo(flyOpts({ center: [campus.long, campus.lat], zoom: CAMPUS_FLY_ZOOM, pitch: 55, bearing: 0 }));
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
      haptics.trigger(defaultPatterns.light);
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

  for (const b of campus.buildings || []) {
    const { lat, long } = b;
    if (typeof lat !== 'number' || typeof long !== 'number') continue;

    const label = buildingLabel(b);

    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'campus-marker campus-marker--building';
    el.innerHTML = `<span class="campus-marker__dot"></span><span>${escapeHtml(label)}</span>`;

    const popup = new mapboxgl.Popup({ offset: 18, closeButton: false }).setHTML(
      `<div class="campus-popup__title">${escapeHtml(label)}</div>` +
      (b.address ? `<div class="campus-popup__addr">${escapeHtml(b.address)}</div>` : '')
    );

    markers.push(
      new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([long, lat])
        .setPopup(popup)
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
