// The real sky over the Campus map: the sun where it really is (shadows, and
// a golden hour by day), and the weather at the selected campus (clouds
// softening the shadows, rain and snow falling on the map). Mapbox Standard's
// own lights stay as they are, so light and dark mode keep their look: only
// the sun's direction, and by day its strength and colour, change.
import { currentWeather, skyFromWeather } from '../utils/weather.js';

const darkScheme = matchMedia('(prefers-color-scheme: dark)');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

let map = null;
let opts = null;           // { isShowing(), location() -> [lng, lat] }
let styleLights = null;    // Standard's lights, captured before any override
const CLEAR = { rain: 0, snow: 0, overcast: 0 };
let sky = CLEAR;           // the last weather known
let skyRun = 0;            // the latest refresh, so an older fetch can't win
let shown = '';            // the rain/snow last applied, to skip repeats

// TEMPORARY (components/sky-debug.js): a fixed weather ({ code, cloudCover })
// and time instead of the real ones
const debug = { weather: null, time: null };
export function setSkyDebug(next) {
  Object.assign(debug, next);
  refreshSky();
}
const now = () => debug.time ?? new Date();

export function attachSky(m, options) {
  map = m;
  opts = options;
  // The sun moves about a degree every four minutes; the weather is checked
  // as often (fetched at most every 15 minutes, utils/weather.js)
  setInterval(() => { if (!document.hidden) refreshSky(); }, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', refreshSky);
  // Any tab coming on screen: rain and snow only fall while the map shows
  document.addEventListener('tabvisible', () => requestAnimationFrame(refreshSky));
  reduceMotion.addEventListener('change', refreshSky);
  window.addEventListener('seasonalchange', () => requestAnimationFrame(refreshSky));
}

// On the style's load, before anything overrides them
export function captureSkyLights() {
  styleLights = map?.getLights?.() ?? null;
}

export async function refreshSky() {
  if (!map) return;
  const run = ++skyRun;
  // What's known now first, so the sun doesn't wait on the network
  applyLights();
  applyPrecipitation();
  let next;
  if (debug.weather) {
    next = skyFromWeather(debug.weather);
  } else {
    const [lng, lat] = opts.location();
    try {
      next = skyFromWeather(await currentWeather(lat, lng));
    } catch (e) {
      console.warn('weather:', e);
      return;   // offline or failed: leave it as it was
    }
  }
  if (run !== skyRun) return;
  sky = next;
  applyLights();
  applyPrecipitation();
}

// ── The sun ───────────────────────────────────────────────────────────────
// Its direction, and so the shadows, set to where it really is; below the
// horizon the preset's own fixed angle stays. By day Standard's sun is weak
// next to its ambient light, which leaves the shadows barely visible: some of
// the ambient goes to the sun, about as bright overall, from building zoom in
// (the flat overview stays as it was). Clouds take some light away: the sun
// dims and its shadows soften to half (enough left to read the buildings'
// shape), and the sky takes a cool grey cast. An overcast map is a little
// darker overall, its shade included, never lighter, and no darker than its
// labels stay readable on.
const zoomRamp = (far, near) => ['interpolate', ['linear'], ['zoom'], 13, far, 15, near];
const round = (n) => Math.round(n * 100) / 100;

// Golden hour, by day: the sun warms as it gets low, white from 20° up, gold
// at 10°, Standard's own dawn/dusk orange on the horizon; the ambient light
// takes a touch of it so the shade isn't cold next to it. [altitude, r, g, b]
const SUN_TINT = [[0, 254, 189, 124], [10, 253, 224, 180], [20, 255, 255, 255]];
const AMBIENT_TINT = [[0, 250, 240, 229], [10, 252, 248, 243], [20, 255, 255, 255]];
// The sky's light under full cloud
const OVERCAST_AMBIENT = [218, 223, 231];

function tint(stops, altitude) {
  const a = Math.min(Math.max(altitude, stops[0][0]), stops[stops.length - 1][0]);
  const i = Math.max(stops.findIndex(([at]) => at >= a), 1);
  const [a0, ...from] = stops[i - 1];
  const [a1, ...to] = stops[i];
  return mix(from, to, (a - a0) / (a1 - a0));
}
const mix = (from, to, f) => from.map((v, k) => v + (to[k] - v) * f);

// Standard picks its labels' colours from how bright Mapbox measures the
// lights (`measure-light brightness`): from 0.3 up, dark text on a white halo;
// under 0.25 the night look; in between a blend, dark text on a dark halo
// that can't be read. A low sun or clouds would take the day there, so the
// sky's light is raised just enough to keep it above DAY_BRIGHTNESS. Mapbox's
// own measure (Style.calculateLightsBrightness): the average of the sun's
// and the sky's luminance times their intensity, the sun's weighted by how
// high it is.
const DAY_BRIGHTNESS = 0.34;
const luminance = (rgb255) => {
  const [r, g, b] = rgb255.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const rgb = ([r, g, b]) => `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;

function applyLights() {
  if (!map || !styleLights || typeof map.setLights !== 'function') return;
  const { lat, lng } = map.getCenter();
  const { altitude, azimuth } = sunPosition(now(), lat, lng);
  const up = altitude > 0;
  const day = up && !darkScheme.matches;
  const o = sky.overcast;
  const polar = Math.min(90 - altitude, 80);
  try {
    map.setLights(styleLights.map((light) => {
      const p = { ...light.properties };
      if (light.type === 'directional') {
        // Polar angle from straight overhead; capped so a sun on the horizon
        // doesn't stretch the shadows off to infinity
        if (up) p.direction = [azimuth, polar];
        if (o > 0) p['shadow-intensity'] = ['*', p['shadow-intensity'] ?? 1, round(1 - 0.5 * o)];
        if (day) {
          p.intensity = zoomRamp(round(0.2 * (1 - 0.4 * o)), round(0.5 * (1 - 0.5 * o)));
          p.color = rgb(tint(SUN_TINT, altitude));
        } else if (o > 0) {
          p.intensity = ['*', p.intensity, round(1 - 0.4 * o)];
        }
      } else if (light.type === 'ambient') {
        if (day) {
          const colour = mix(tint(AMBIENT_TINT, altitude), OVERCAST_AMBIENT, 0.6 * o);
          // At building zoom, where the sun is at its strongest and the sky
          // at its weakest (further out both are well above the line)
          const sun = luminance(tint(SUN_TINT, altitude)) * 0.5 * (1 - 0.5 * o) * (1 - polar / 90);
          const near = Math.max(0.6, (2 * DAY_BRIGHTNESS - sun) / luminance(colour));
          p.intensity = zoomRamp(round(Math.max(0.8 - 0.05 * o, near)), round(near));
          p.color = rgb(colour);
        } else if (o > 0) {
          p.intensity = ['*', p.intensity, round(1 - 0.15 * o)];
        }
      }
      return { ...light, properties: p };
    }));
  } catch {
    /* style not ready */
  }
}

// The sun's altitude above the horizon and its azimuth (clockwise from north),
// both in degrees: the usual low-precision formulas, good to a fraction of a
// degree, which is plenty for a shadow
function sunPosition(date, lat, lng) {
  const rad = Math.PI / 180;
  const d = date.getTime() / 86400000 - 10957.5;  // days since J2000
  const g = (357.529 + 0.98560028 * d) * rad;
  const q = 280.459 + 0.98564736 * d;
  const l = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * rad;
  const e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l));
  const dec = Math.asin(Math.sin(e) * Math.sin(l));
  const gmst = 280.46061837 + 360.98564736629 * d;
  const ha = (gmst + lng) * rad - ra;
  const phi = lat * rad;
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const azimuth = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { altitude: altitude / rad, azimuth: ((azimuth / rad + 180) % 360 + 360) % 360 };
}

// ── Rain and snow ─────────────────────────────────────────────────────────
// As hard as it's falling at the campus. Only while the map shows (they
// redraw it every frame), not with reduced motion, and not in the Christmas
// season: its own snow (christmas.js) owns the map's snow then, and rain
// under it would be sleet. Real snow when the Christmas season is turned on
// from the search stays until the next refresh.
function applyPrecipitation() {
  if (!map || typeof map.setRain !== 'function') return;
  const christmas = document.documentElement.dataset.season === 'christmas';
  const on = opts.isShowing() && !document.hidden && !reduceMotion.matches && !christmas;
  const rain = on ? sky.rain : 0;
  const snow = on ? sky.snow : 0;
  const dark = darkScheme.matches;
  const key = `${rain}|${christmas ? '-' : snow}|${dark}`;
  if (key === shown) return;
  shown = key;
  try {
    map.setRain(rain ? {
      // Fades in from the city overview down to campus zoom
      density: ['interpolate', ['linear'], ['zoom'], 11, 0, 13, 0.3 + 0.55 * rain],
      intensity: 0.4 + 0.6 * rain,
      color: dark ? '#7f8aa0' : '#a8adbc',
      opacity: 0.45 + 0.3 * rain,
      // The edges darken under heavier rain, like an overcast sky
      vignette: ['interpolate', ['linear'], ['zoom'], 11, 0, 13, 0.3 + 0.6 * rain],
      'vignette-color': dark ? '#1c2230' : '#5f6672',
      direction: [0, 80],
      'droplet-size': [2.6, 18.2],
      // Kept low: stronger, it smears the map's labels
      'distortion-strength': 0.1 + 0.15 * rain,
      'center-thinning': 0,
    } : null);
    if (!christmas) {
      map.setSnow(snow ? {
        density: ['interpolate', ['linear'], ['zoom'], 11, 0, 13, 0.3 + 0.45 * snow],
        intensity: 0.5 + 0.4 * snow,
        color: '#ffffff',
        opacity: 0.9,
        vignette: ['interpolate', ['linear'], ['zoom'], 11, 0, 14, 0.1 + 0.2 * snow],
        'vignette-color': dark ? '#c9d6e8' : '#ffffff',
        'center-thinning': 0.3,
        'flake-size': 0.55 + 0.2 * snow,
      } : null);
    }
  } catch (e) {
    console.warn('rain/snow:', e);
  }
}
