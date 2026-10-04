// Christmas decorations (Dec 1 – Jan 10), lazy-loaded by utils/season.js.
// The accent, the candy cane on the "now" markers and the festive strings are
// plain CSS / locale entries keyed on <html data-season="christmas">; this
// module adds what needs the DOM:
//   - snow falling over the app, and piling up on what it lands on: cards,
//     the banner, the chips, the building headers, the tab bar, the classroom
//     page's sections (components/snowfall.js)
//   - garlands, string lights, hanging baubles, bows, holly and icicles,
//     drawn to fit the element they hang on (its width and rounded corners)
//   - a gift room per campus and day: its card and page wrapped in a ribbon
//     (tap the bow on its page to unwrap it), a gift over its building on the
//     map, in its building's folder and next to its name in the search
//   - mistletoe hanging from the settings button
//   - the logo in a Santa hat with a present, in the header and the tab icon
//   - now and then Santa's sleigh across the top of the screen (the Befana on
//     her broom on January 6th)
//   - fireworks at midnight on New Year's Eve, and once on New Year's Day
//   - gifts raining down when something gets starred
//   - 3D Christmas trees, gifts and snowmen in the parks, squares and paths
//     around each campus on the Campus map, and the map's own snow while it's
//     on screen
// With reduced motion nothing falls or flies: the piles are simply there,
// and the lights don't twinkle.

import { setDecorator } from '../utils/season.js';
import { t } from '../i18n.js';
import { addPile, startSnowfall, stopSnowfall, holdSnowfall } from './snowfall.js';
import seasonSpots from '../data/season-spots.json';
import { classroomsData as directory, ensureClassroomDirectory } from '../classroom-search-data.js';

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Randomness that stays put ─────────────────────────────────────────────
// Decorations come from a hash of what they sit on, so a card keeps the same
// garland across re-renders and every visitor sees the same gift room.

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  let s = seed || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

// Today in Milan, YYYY-MM-DD: the gift rooms change at local midnight
function dayKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
}

// Milan's month, day, hour, minute and second right now
function milanNow() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Rome', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23',
  }).formatToParts(new Date());
  const get = (type) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

const f1 = (v) => v.toFixed(1);

// ── Artwork ───────────────────────────────────────────────────────────────

const NEEDLES = ['xm-needle-a', 'xm-needle-b', 'xm-needle-c'];
const BULBS = ['#ffd36b', '#ff5d5d', '#62d4ff', '#86f08f', '#ffb0ee'];
const WARM_BULB = '#ffe2a0';
const BAUBLES = ['#d92b35', '#e8b23a', '#2f6fdc', '#c9cfd8', '#1f8a4c', '#a63bc4'];

// The line a garland or a string of lights follows across the top of a box
// `width` wide with rounded corners `radius`: either hugging the outline
// (`rim`, `inset` px inside it, as far down the corners as they stay gentle)
// or swagging in loops between pins along the top edge, each loop `sag` px
// deep. Points about every 2px.
function topLine(width, radius, { mode = 'swag', inset = 3, sag = 10, loops = null } = {}) {
  const R = Math.max(0, Math.min(radius, width / 2));
  const drop = (x) => {
    const d = Math.min(x, width - x);
    if (d >= R) return 0;
    const u = R - d;
    return R - Math.sqrt(Math.max(0, R * R - u * u));
  };
  const pts = [];
  if (mode === 'rim') {
    // From where the corner's curve is about 45° on one side to the other
    const from = R * (1 - Math.SQRT1_2);
    for (let x = from; x <= width - from; x += 2) pts.push([x, drop(x) + inset]);
    return { pts, pins: [] };
  }
  const n = loops ?? Math.max(1, Math.round((width - R) / 72));
  const x0 = Math.max(R * 0.55, 6), x1 = width - x0;
  const pins = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    pins.push([x, drop(x) + inset]);
  }
  for (let i = 0; i < n; i++) {
    const [ax, ay] = pins[i], [bx, by] = pins[i + 1];
    const cx = (ax + bx) / 2, cy = (ay + by) / 2 + sag * 2;
    const steps = Math.max(4, Math.ceil((bx - ax) / 2));
    for (let k = i ? 1 : 0; k <= steps; k++) {
      const s = k / steps;
      const x = (1 - s) * (1 - s) * ax + 2 * (1 - s) * s * cx + s * s * bx;
      const y = (1 - s) * (1 - s) * ay + 2 * (1 - s) * s * cy + s * s * by;
      pts.push([x, y]);
    }
  }
  return { pts, pins };
}

// Pine needles bristling along a line of points: three shades, each one path
function needlesAlong(pts, r, thick = 1) {
  const paths = ['', '', ''];
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    for (let k = 0; k < 3; k++) {
      const a = r() * Math.PI * 2;
      const len = (2.6 + r() * 2.4) * thick;
      const ox = (r() - 0.5) * 1.6, oy = (r() - 0.5) * 1.6;
      const sx = x + ox, sy = y + oy;
      paths[(i + k) % 3] += `M${f1(sx)} ${f1(sy)}l${f1(Math.cos(a) * len)} ${f1(Math.sin(a) * len)}`;
    }
  }
  return paths.map((d, k) => `<path class="xm-needles ${NEEDLES[k]}" d="${d}"/>`).join('');
}

// Bulbs along a line every `gap` px, slightly below it, in three twinkle
// groups; `warm`: all warm white, otherwise in colours
function bulbsAlong(pts, r, { gap = 14, warm = false, size = 1.9, wire = true } = {}) {
  const groups = ['', '', ''];
  let wireD = '';
  let run = 0, next = gap * (0.3 + r() * 0.5), n = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    if (wire) wireD += `${i ? 'L' : 'M'}${f1(x)} ${f1(y)}`;
    if (i) run += Math.hypot(x - pts[i - 1][0], y - pts[i - 1][1]);
    if (run < next) continue;
    next = run + gap;
    const c = warm ? WARM_BULB : BULBS[n % BULBS.length];
    const by = y + size * 0.9;
    groups[n % 3] += `<circle class="xm-glow" cx="${f1(x)}" cy="${f1(by)}" r="${f1(size * 2.4)}" fill="${c}"/>` +
      `<ellipse cx="${f1(x)}" cy="${f1(by)}" rx="${f1(size * 0.8)}" ry="${f1(size)}" fill="${c}"/>`;
    n++;
  }
  return (wire ? `<path class="xm-wire" d="${wireD}"/>` : '') +
    groups.map((g, k) => `<g class="xm-twinkle xm-twinkle--${k}">${g}</g>`).join('');
}

// A ribbon bow centred on (x, y), `s` px wide
function bowAt(x, y, s, cls = 'xm-bow') {
  const k = s / 20;
  return `<g class="${cls}" transform="translate(${f1(x)} ${f1(y)}) scale(${k.toFixed(3)})">` +
    '<path class="xm-bow-tail" d="M-1 1 L-6 11 L-3 10 L-2 13 Z M1 1 L6 11 L3 10 L2 13 Z"/>' +
    '<path class="xm-bow-loop" d="M0 0 C-4 -7 -11 -7 -10 -1 C-9 4 -3 3 0 0 Z M0 0 C4 -7 11 -7 10 -1 C9 4 3 3 0 0 Z"/>' +
    '<circle class="xm-bow-knot" cx="0" cy="0" r="2.2"/></g>';
}

const bowSvg = (s) => `<svg width="${s}" height="${s}" viewBox="${-s / 2} ${-s / 2} ${s} ${s}" aria-hidden="true">${bowAt(0, 0, s)}</svg>`;

// A garland across the top of a box, with lights in it and, swagged, a bow on
// each pin
function garlandSvg(width, radius, seed, { mode = 'swag', lights = true, warm = false, bows = true, sag = 9, inset = 3, loops = null, thick = 1 } = {}) {
  const r = rng(seed);
  const { pts, pins } = topLine(width, radius, { mode, inset, sag, loops });
  const H = Math.ceil(Math.max(...pts.map((p) => p[1])) + 10);
  let body = needlesAlong(pts, r, thick);
  if (lights) body += bulbsAlong(pts, r, { gap: 11 + r() * 5, warm, wire: false });
  if (bows && mode === 'swag') body += pins.map(([x, y]) => bowAt(x, y + 1, 13 * thick)).join('');
  return `<svg class="xm-art" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" aria-hidden="true">${body}</svg>`;
}

// A string of lights alone, swagged or along the rim
function lightsSvg(width, radius, seed, { mode = 'swag', warm = false, sag = 7, inset = 2, loops = null, size = 1.9 } = {}) {
  const r = rng(seed);
  const { pts } = topLine(width, radius, { mode, inset, sag, loops });
  const H = Math.ceil(Math.max(...pts.map((p) => p[1])) + 8);
  return `<svg class="xm-art" width="${width}" height="${H}" viewBox="0 0 ${width} ${H}" aria-hidden="true">${bulbsAlong(pts, r, { gap: 12 + r() * 4, warm, size })}</svg>`;
}

// A bauble `d` px across, on its cap
function baubleSvg(d, color, seed) {
  const r = rng(seed);
  const striped = r() < 0.4;
  const R = d / 2;
  const stripe = striped ? `<path d="M${f1(-R * 0.98)} ${f1(-R * 0.2)}Q0 ${f1(R * 0.25)} ${f1(R * 0.98)} ${f1(-R * 0.2)}L${f1(R * 0.92)} ${f1(R * 0.25)}Q0 ${f1(R * 0.7)} ${f1(-R * 0.92)} ${f1(R * 0.25)}Z" fill="rgba(255,255,255,.55)"/>` : '';
  return `<svg class="xm-bauble-art" width="${d + 2}" height="${d + 5}" viewBox="${f1(-R - 1)} ${f1(-R - 4)} ${d + 2} ${d + 5}" aria-hidden="true">` +
    `<rect class="xm-bauble-cap" x="${f1(-R * 0.28)}" y="${f1(-R - 3.4)}" width="${f1(R * 0.56)}" height="3" rx=".8"/>` +
    `<circle cx="0" cy="0" r="${f1(R)}" fill="${color}"/>${stripe}` +
    `<ellipse cx="${f1(-R * 0.36)}" cy="${f1(-R * 0.38)}" rx="${f1(R * 0.26)}" ry="${f1(R * 0.17)}" transform="rotate(-35 ${f1(-R * 0.36)} ${f1(-R * 0.38)})" fill="rgba(255,255,255,.7)"/>` +
    `<circle cx="0" cy="0" r="${f1(R)}" class="xm-bauble-rim"/></svg>`;
}

// A sprig in a corner: holly (spiky leaves, red berries) or mistletoe (soft
// leaves, white berries). Drawn for the top-left corner.
function sprigSvg(s, seed, { mistletoe = false } = {}) {
  const r = rng(seed);
  const leaf = mistletoe
    ? 'M0 0 C3 -3 9 -4 13 -2 C10 1 4 2 0 0 Z'
    : 'M0 0 L2.5 -2.4 L3.8 -0.8 L6.4 -3.2 L7.6 -1.2 L10.6 -2.8 L11 -0.6 L14 -0.8 C11 2.4 5 3 0 0 Z';
  const angles = mistletoe ? [-20, 25, 70, 115] : [-10, 55, 100];
  let leaves = '';
  for (const a of angles) {
    const jitter = (r() - 0.5) * 16;
    leaves += `<path class="${mistletoe ? 'xm-mistle-leaf' : 'xm-holly-leaf'}" d="${leaf}" transform="rotate(${f1(a + jitter)})"/>`;
  }
  let berries = '';
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + r();
    berries += `<circle class="${mistletoe ? 'xm-mistle-berry' : 'xm-holly-berry'}" cx="${f1(Math.cos(a) * 2)}" cy="${f1(Math.sin(a) * 2)}" r="${mistletoe ? 1.5 : 1.8}"/>`;
  }
  return `<svg class="xm-art" width="${s}" height="${s}" viewBox="-6 -6 28 28" aria-hidden="true">${leaves}${berries}</svg>`;
}

// Icicles along a bottom edge `width` wide, the longest `len` px
function iciclesSvg(width, seed, len = 12, radius = 0) {
  const r = rng(seed);
  const R = Math.min(radius, width / 2);
  let d = '';
  let shine = '';
  let x = Math.max(4, R * 0.6);
  while (x < width - Math.max(4, R * 0.6)) {
    const wid = 2.2 + r() * 2.6;
    const l = len * (0.25 + Math.pow(r(), 1.6) * 0.75);
    d += `M${f1(x - wid / 2)} 0 Q${f1(x - wid * 0.2)} ${f1(l * 0.6)} ${f1(x)} ${f1(l)} Q${f1(x + wid * 0.2)} ${f1(l * 0.6)} ${f1(x + wid / 2)} 0 Z`;
    if (l > len * 0.5) shine += `M${f1(x - wid * 0.18)} 1.5 L${f1(x - wid * 0.05)} ${f1(l * 0.55)}`;
    x += wid + 1.5 + r() * 7;
  }
  return `<svg class="xm-art" width="${width}" height="${Math.ceil(len) + 2}" viewBox="0 0 ${width} ${Math.ceil(len) + 2}" aria-hidden="true">` +
    `<path class="xm-icicle" d="${d}"/><path class="xm-icicle-shine" d="${shine}"/></svg>`;
}

// A wreath `d` px across: pine needles round a ring, warm lights in them, a
// few clusters of red berries and pinecones
function wreathSvg(d, seed) {
  const r = rng(seed);
  const R = d * 0.36;
  const pts = [];
  for (let a = 0; a < Math.PI * 2; a += 1.6 / R) {
    for (const off of [-0.22, 0, 0.22]) pts.push([Math.cos(a) * R * (1 + off), Math.sin(a) * R * (1 + off)]);
  }
  let body = `<circle class="xm-wreath-base" r="${f1(R)}"/>` + needlesAlong(pts, r, d / 46);
  const ring = [];
  for (let a = 0; a < Math.PI * 2; a += 0.05) ring.push([Math.cos(a) * R, Math.sin(a) * R]);
  body += bulbsAlong(ring, r, { gap: R * 0.55, warm: true, size: d / 34, wire: false });
  // Berries and pinecones, evenly round it with a little jitter
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.3;
    const x = Math.cos(a) * R * (1 + (r() - 0.5) * 0.2), y = Math.sin(a) * R * (1 + (r() - 0.5) * 0.2);
    if (i % 2) {
      const s = d / 30;
      body += `<g transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(a * 57.3 + 90)})"><ellipse class="xm-cone" rx="${f1(s * 1.3)}" ry="${f1(s * 2)}"/>` +
        `<path class="xm-cone-scale" d="M${f1(-s)} ${f1(-s * 0.8)}L${f1(s)} ${f1(-s * 0.2)}M${f1(-s)} ${f1(s * 0.2)}L${f1(s)} ${f1(s * 0.8)}M${f1(s)} ${f1(-s * 0.8)}L${f1(-s)} ${f1(-s * 0.2)}M${f1(s)} ${f1(s * 0.2)}L${f1(-s)} ${f1(s * 0.8)}"/></g>`;
    } else {
      for (let k = 0; k < 3; k++) {
        const b = r() * 6.28;
        body += `<circle class="xm-holly-berry" cx="${f1(x + Math.cos(b) * d / 28)}" cy="${f1(y + Math.sin(b) * d / 28)}" r="${f1(d / 30)}"/>`;
      }
    }
  }
  return `<svg width="${d}" height="${d}" viewBox="${-d / 2} ${-d / 2} ${d} ${d}" aria-hidden="true">${body}</svg>`;
}

const GIFT_SVG = `<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
  <rect class="xm-gift-box" x="3" y="9" width="16" height="11" rx="1.6"/>
  <rect class="xm-gift-lid" x="2" y="6.5" width="18" height="4" rx="1.2"/>
  <rect class="xm-gift-ribbon" x="9.6" y="6.5" width="2.8" height="13.5"/>
  <path class="xm-gift-ribbon" d="M11 6.6C9 2.4 4.6 2.2 5.4 4.8 6 6.6 9.4 6.8 11 6.6ZM11 6.6C13 2.4 17.4 2.2 16.6 4.8 16 6.6 12.6 6.8 11 6.6Z"/></svg>`;

// Santa in his sleigh with a sack of presents, pulled by two reindeer (the
// front one Rudolph). Drawn in colour, each part with a thin edge in the
// theme's contrast colour (--xm-flyer-edge) so it holds up on light and dark.
const SLEIGH_SVG = `<svg width="150" height="46" viewBox="0 0 150 46" aria-hidden="true">
  <path class="xm-f-rein" d="M58 19 Q84 24 103 21M58 19 Q100 18 133 17"/>
  <path class="xm-f-sack" d="M9 23c-1-8 3-13 9-13s10 5 9 13z"/>
  <rect class="xm-f-gift" x="12" y="6.5" width="6" height="5.5" rx=".8"/><rect class="xm-f-gold" x="14.4" y="6.5" width="1.2" height="5.5"/>
  <rect class="xm-f-gift2" x="19" y="8" width="5" height="4" rx=".8"/>
  <path class="xm-f-coat" d="M27 24c0-8 3-12 9-12s9 4 9 12z"/>
  <path class="xm-f-arm" d="M41 15.5 L51 18"/>
  <circle class="xm-f-glove" cx="51.5" cy="18" r="1.6"/>
  <circle class="xm-f-skin" cx="37" cy="9" r="4.4"/>
  <path class="xm-f-white" d="M32.6 9.4c0 5 2.4 7.2 4.4 7.2s4.4-2.2 4.4-7.2c-1.6 1.6-7.2 1.6-8.8 0z"/>
  <path class="xm-f-coat" d="M32.8 7C33 3 35.5 1 38.6 1.5L44.2 5.6 41.4 6.6C40.4 5.6 38.6 5.2 36.4 5.8Z"/>
  <rect class="xm-f-white" x="32" y="5.8" width="10.2" height="2.6" rx="1.3"/><circle class="xm-f-white" cx="44.6" cy="5.8" r="1.5"/>
  <path class="xm-f-sleigh" d="M8 30h44c6 0 10-4 11-10l1-6h-6l-1 5c-1 4-3 6-7 6H22c-4 0-6-3-6-6v-3H10v4c0 4 2 7 5 8H8c-2 0-3 1-3 2s1 2 3 2z"/>
  <path class="xm-f-trim" d="M16 19.5v.5c0 3.5 2 6 6 6h28c4 0 6.5-2 7.5-6l1-5.5"/>
  <path class="xm-f-gold" d="M4 36h56c3 0 5-2 6-4h-3c-1 1-2 2-3 2H4z"/>
  <path class="xm-f-gold" d="M20 31.5v3h2v-3zM46 31.5v3h2v-3z"/>
  <g class="xm-deer"><path class="xm-f-deer" d="M82 26c0-4 4-6 10-6h6c3 0 5-2 6-4l2-3 2 1-1 4 3 1v3l-4-1c-2 3-4 5-8 5h-2l3 8h-3l-4-7-6 1-3 7h-3l2-8c-2 0-3-1-3-1z"/><path class="xm-f-antler" d="M106 13l-1-6M106 9l-3-3M107 10l3-4"/><circle class="xm-f-gold" cx="101.5" cy="21.5" r="1.3"/><circle class="xm-f-nose" cx="111.6" cy="17.6" r="1.1"/></g>
  <g class="xm-deer"><path class="xm-f-deer" d="M112 22c0-4 4-6 10-6h6c3 0 5-2 6-4l2-3 2 1-1 4 3 1v3l-4-1c-2 3-4 5-8 5h-2l3 8h-3l-4-7-6 1-3 7h-3l2-8c-2 0-3-1-3-1z"/><path class="xm-f-antler" d="M136 9l-1-6M136 5l-3-3M137 6l3-4"/><circle class="xm-f-gold" cx="131.5" cy="17.5" r="1.3"/><circle class="xm-rudolph" cx="142" cy="13.5" r="1.9"/></g>
</svg>`;

// The Befana on her broom, with her sack of sweets
const BEFANA_SVG = `<svg width="96" height="50" viewBox="0 0 96 50" aria-hidden="true">
  <path class="xm-f-stick" d="M2 36l64-6 1 3-64 6z"/>
  <path class="xm-f-straw" d="M60 30c6-2 14-4 22-4l-1 4c-6 0-14 2-20 4zM62 34c6 1 12 3 18 7l-2 2c-6-3-11-5-17-6z"/>
  <path class="xm-f-straw-line" d="M64 31l14-2.6M65 35l12 4.6M63 32.6l16 .4"/>
  <path class="xm-f-sack" d="M18 28c-2-5 1-10 7-10s9 5 7 10z"/>
  <path class="xm-f-shoe" d="M28 31l-4 9h3l3-8zM38 31l-1 9h3l1-8z"/>
  <path class="xm-f-skirt" d="M30 31c-2-8 0-15 6-18l2-6 4 0 3 6c5 3 6 10 4 17z"/>
  <rect class="xm-f-patch" x="36" y="22" width="5" height="4.4" rx=".6" transform="rotate(-8 38.5 24.2)"/>
  <path class="xm-f-shawl" d="M33.4 15.4c3-3.4 9.6-3.4 12.6 0l-1.2 4.4c-3-2.2-7.4-2.2-10.2 0z"/>
  <circle class="xm-f-skin" cx="41" cy="11" r="3.4"/><path class="xm-f-nose-long" d="M44.2 10.6l4 1.2-3.4 1.2z"/>
  <path class="xm-f-scarf" d="M37.2 10.2C37 5.6 39.4 3 42 3.4c2.6.4 3.8 3 3.6 5.6-1.2-1.6-2.8-2.4-4.6-2.2-1.8.2-3 1.6-3.8 3.4z"/><path class="xm-f-scarf" d="M37.4 9.6l-4 4.4 3.6-.6z"/>
</svg>`;

const SANTA_HAT_SVG = `<svg width="22" height="18" viewBox="0 0 22 18" aria-hidden="true">
  <path class="xm-hat-red" d="M2 14C3 7 8 2 14 2c3 0 5 2 6 5l-3 1c-1-2-2-3-4-3-3 0-5 4-6 9z"/>
  <rect class="xm-hat-fur" x="1" y="12.5" width="13" height="4.5" rx="2.2"/><circle class="xm-hat-fur" cx="19" cy="8.5" r="2.6"/></svg>`;

// ── Gift rooms ────────────────────────────────────────────────────────────
// One per campus per day, from the rooms people actually book that have a
// photo for the ribbon to wrap. The map puts a gift on its building.

let giftRooms = null; // { day, ids: Set<number>, buildings: Set<"campusId:name"> }

function gifts() {
  const day = dayKey();
  if (giftRooms?.day === day) return giftRooms;
  // Not picked (nor remembered) until the rooms have loaded
  if (!directory) return { day, ids: new Set(), buildings: new Set() };
  giftRooms = { day, ids: new Set(), buildings: new Set() };
  for (const campus of directory ?? []) {
    if (campus.secondary) continue;
    const rooms = [];
    for (const building of campus.buildings ?? []) {
      if (building.secondary) continue;
      for (const room of building.classrooms ?? []) {
        if (!room.eventsOnly && !room.noSchedule && room.idfoto) rooms.push([room.id, building.name]);
      }
    }
    if (!rooms.length) continue;
    const [id, buildingName] = rooms[hash(`gift:${day}:${campus.id}`) % rooms.length];
    giftRooms.ids.add(id);
    giftRooms.buildings.add(`${campus.id}:${buildingName}`);
  }
  return giftRooms;
}

// Unwrapped today (tapped on its page): stays unwrapped until tomorrow's
const UNWRAPPED_KEY = 'poliAule_xmasUnwrapped';

function unwrapped() {
  try {
    const v = JSON.parse(localStorage.getItem(UNWRAPPED_KEY));
    return v?.day === dayKey() ? new Set(v.ids) : new Set();
  } catch { return new Set(); }
}

function markUnwrapped(id) {
  const ids = unwrapped();
  ids.add(id);
  try { localStorage.setItem(UNWRAPPED_KEY, JSON.stringify({ day: dayKey(), ids: [...ids] })); } catch { /* lasts this session */ }
}

// The ribbon round a gift room's card or photo: a band each way, crossing up
// and to the right, with a bow where they cross
function ribbonEl(className) {
  const el = document.createElement('div');
  el.className = `xm-ribbon ${className}`;
  el.innerHTML = '<div class="xm-ribbon-band xm-ribbon-band--v"></div><div class="xm-ribbon-band xm-ribbon-band--h"></div>' +
    `<div class="xm-ribbon-bow">${bowSvg(40)}</div>`;
  return el;
}

// ── Helpers ───────────────────────────────────────────────────────────────

const radiusOf = (el) => parseFloat(getComputedStyle(el).borderTopRightRadius) || 0;

// Runs `fn(width, height)` once, the first time `el` has a size (a garland
// needs the width it spans, which an element built off-screen doesn't have)
const pendingSize = new WeakMap();
const firstSize = new ResizeObserver((entries) => {
  for (const { target, contentRect } of entries) {
    if (!target.isConnected) { firstSize.unobserve(target); continue; }
    if (!contentRect.width) continue;
    firstSize.unobserve(target);
    const fn = pendingSize.get(target);
    pendingSize.delete(target);
    fn?.(target.offsetWidth, target.offsetHeight);
  }
});

function whenSized(el, fn) {
  pendingSize.set(el, fn);
  firstSize.observe(el);
}

function decor(className, html) {
  const el = document.createElement('div');
  el.className = `xm-decor ${className}`;
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = html;
  return el;
}

// Snow piles up on `el`; it needs to be positioned for the pile to sit on it
function pile(el, opts) {
  if (!el) return;
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
  addPile(el, opts);
}

// A bauble or two hanging from a top edge on threads, swinging
function hangBaubles(host, seed, { count = 1, left = 20, spread = 50 } = {}) {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const len = 10 + Math.floor(r() * 26);
    const d = 11 + Math.floor(r() * 6);
    const el = decor('xm-hang', `<div class="xm-hang-thread" style="height:${len}px"></div>` +
      `<div class="xm-hang-bauble" style="top:${len - 1}px">${baubleSvg(d, BAUBLES[Math.floor(r() * BAUBLES.length)], seed + i)}</div>`);
    el.style.left = `${left + r() * spread}%`;
    el.style.setProperty('--xm-swing-delay', `${(-r() * 4).toFixed(2)}s`);
    host.appendChild(el);
  }
}

// ── Classroom cards ───────────────────────────────────────────────────────
// Snow piles on every card. About one in three also gets a garland, a string
// of lights, a bauble or two or a sprig of holly; the gift rooms get their
// ribbon.

let cardRadius = 16;

function decorateCard(card, classroom) {
  const id = classroom.id;
  pile(card, { key: `card:${id}`, radius: cardRadius });
  const clip = card.querySelector('.classroom-card-clip');
  if (!clip) return;
  if (gifts().ids.has(id) && !clip.querySelector(':scope > .xm-ribbon')) clip.appendChild(ribbonEl('xm-ribbon--card'));
  if (clip.querySelector(':scope > .xm-decor')) return;

  const h = hash(`card:${id}`);
  if (h % 3 !== 0) return;
  const kind = ['garland', 'garland', 'lights', 'bauble', 'holly'][(h >>> 4) % 5];
  if (kind === 'bauble') {
    hangBaubles(clip, h, { count: 1 + ((h >>> 9) & 1), left: 16, spread: 60 });
    return;
  }
  if (kind === 'holly') {
    // Top-left: cards that can show the favourite star keep the right free
    clip.appendChild(decor('xm-sprig', sprigSvg(30, h)));
    return;
  }
  whenSized(card, (width) => {
    if (clip.querySelector(':scope > .xm-garland')) return;
    const svg = kind === 'garland'
      ? garlandSvg(width, cardRadius, h, { lights: ((h >>> 12) & 3) !== 0, warm: ((h >>> 14) & 1) === 1, loops: width > 190 ? 3 : 2 })
      : lightsSvg(width, cardRadius, h, { loops: 2, warm: ((h >>> 14) & 1) === 1 });
    clip.appendChild(decor('xm-garland', svg));
  });
}

// ── Building folders ──────────────────────────────────────────────────────
// A wreath on half the folders' glass fronts, a garland across a third of them;
// the gift room's building has a gift sticking up out of its papers.

function decorateFolder(folder, { campusId, building }) {
  if (gifts().buildings.has(`${campusId}:${building.name}`) && !folder.querySelector('.xm-folder-gift')) {
    folder.querySelector('.bo-card-papers')?.appendChild(decor('xm-folder-gift', GIFT_SVG));
  }
  const front = folder.querySelector('.bo-card-front');
  if (!front || front.querySelector(':scope > .xm-decor')) return;
  const h = hash(`folder:${building.name}`);
  if (h % 3 === 0) {
    whenSized(front, (width) => {
      if (front.querySelector(':scope > .xm-garland')) return;
      front.appendChild(decor('xm-garland', garlandSvg(width, 18, h, { loops: 2, sag: 7 })));
    });
  } else if (h % 2) {
    front.appendChild(decor('xm-front-wreath', wreathSvg(34, h)));
  }
}

// ── Building headers (Available results) ──────────────────────────────────
// Snow on every name pill; icicles under a third of them, holly on another
// third.

function decorateBuildingHeader(header, { building }) {
  const pill = header.querySelector('.building-section-titles');
  if (!pill) return;
  pile(pill, { key: `header:${building.name}`, maxHeight: 5 });
  const h = hash(`header:${building.name}`);
  if (pill.querySelector(':scope > .xm-decor')) return;
  if (h % 3 === 0) {
    whenSized(pill, (width, height) => {
      if (pill.querySelector(':scope > .xm-icicles')) return;
      pill.appendChild(decor('xm-icicles', iciclesSvg(width, h, 9, Math.min(radiusOf(pill), height / 2))));
    });
  } else if (h % 3 === 1) {
    pill.appendChild(decor('xm-sprig xm-sprig--pill', sprigSvg(22, h)));
  }
}

// ── Classroom page ────────────────────────────────────────────────────────
// Snow on every section, a garland along the top of one of them, and the
// gift room's photo wrapped in its ribbon: tapping the bow unwraps it.

function decorateDetail(page, { classroom }) {
  const h = hash(`detail:${classroom.id}`);
  const sections = [...page.querySelectorAll('.detail-section:not(.detail-map-section)')];
  sections.forEach((section, i) => pile(section, { key: `detail:${classroom.id}:${i}` }));
  const plain = sections.filter((section) => !section.querySelector('.detail-section-header'));
  const target = plain[h % Math.max(1, plain.length)];
  if (target && !target.querySelector(':scope > .xm-garland')) {
    whenSized(target, (width) => {
      if (target.querySelector(':scope > .xm-garland')) return;
      target.appendChild(decor('xm-garland', garlandSvg(width, radiusOf(target), h, { loops: width > 400 ? 4 : 3 })));
    });
  }

  const photo = page.querySelector('.detail-photo-container');
  if (!photo || photo.querySelector('.xm-ribbon') || !gifts().ids.has(classroom.id) || unwrapped().has(classroom.id)) return;
  const ribbon = ribbonEl('xm-ribbon--photo');
  const bow = ribbon.querySelector('.xm-ribbon-bow');
  bow.setAttribute('role', 'button');
  bow.setAttribute('tabindex', '0');
  bow.setAttribute('aria-label', t('season.christmas.unwrap'));
  const unwrap = (e) => {
    e.stopPropagation();
    e.preventDefault();
    markUnwrapped(classroom.id);
    ribbon.classList.add('xm-ribbon--open');
    const rect = bow.getBoundingClientRect();
    celebrate(rect.left + rect.width / 2, rect.top + rect.height / 2);
    setTimeout(() => ribbon.remove(), reduceMotion() ? 0 : 900);
  };
  bow.addEventListener('click', unwrap);
  bow.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') unwrap(e); });
  photo.appendChild(ribbon);
}

// The season's banner (utils/season.js): a garland with lights along its top,
// snow on it and icicles under it
function decorateBanner(banner) {
  pile(banner, { key: 'banner', maxHeight: 8, chance: 0.6 });
  const h = hash(`banner:${dayKey()}`);
  whenSized(banner, (width) => {
    if (banner.querySelector(':scope > .xm-garland')) return;
    const radius = radiusOf(banner);
    banner.appendChild(decor('xm-garland', garlandSvg(width, radius, h, { mode: 'rim', inset: 1, bows: false })));
    banner.appendChild(decor('xm-icicles', iciclesSvg(width, h, 13, radius)));
  });
}

// ── Search ────────────────────────────────────────────────────────────────
// A gift by the gift rooms' names, a sprig of holly on a third of the
// thumbnails, a string of lights across the results box.

let giftLabel = '';

function decorateSearchRow(row, item) {
  if (row.querySelector('.xm-decor, .xm-search-gift')) return;
  if (item.type === 'classroom' && gifts().ids.has(item.room.id)) {
    const badge = document.createElement('span');
    badge.className = 'xm-search-gift';
    badge.innerHTML = GIFT_SVG;
    badge.title = giftLabel;
    badge.setAttribute('role', 'img');
    badge.setAttribute('aria-label', giftLabel);
    row.querySelector('.search-row-title-text')?.appendChild(badge);
  }
  const key = item.type === 'classroom' ? `room:${item.room.id}` : `building:${item.campusId}:${item.name}`;
  const h = hash(`search:${key}`);
  const lead = row.querySelector('.search-row-lead');
  if (h % 3 || !lead) return;
  lead.appendChild(decor('xm-sprig xm-sprig--thumb', sprigSvg(18, h)));
}

function decorateSearchPanel() {
  const frame = document.querySelector('.search-results-frame');
  if (!frame || frame.querySelector(':scope > .xm-decor')) return;
  const h = hash(`searchpanel:${dayKey()}`);
  whenSized(frame, (width) => {
    if (frame.querySelector(':scope > .xm-decor')) return;
    frame.appendChild(decor('xm-garland', lightsSvg(width, radiusOf(frame) || 24, h, { loops: Math.max(2, Math.round(width / 120)), sag: 9, inset: 1 })));
  });
}

// ── The Campus sheet ──────────────────────────────────────────────────────
// Coloured lights along its top rim (warm white ones vanish on light glass). The sheet is rebuilt when the layout flips
// between phone and desktop, so they're put back whenever they're missing.

function decorateSheet() {
  const glass = document.querySelector('.campus-sheet .lg-sheet__glass');
  if (!glass || glass.querySelector(':scope > .xm-decor') || !glass.offsetWidth) return;
  glass.appendChild(decor('xm-garland', lightsSvg(glass.offsetWidth, radiusOf(glass) || 28, hash(`sheet:${dayKey()}`), { mode: 'rim', inset: 3 })));
}

// ── Tab bar and search button ─────────────────────────────────────────────
// Snow on both, lights along the bar's top rim, holly on the search button

function decorateTabBar() {
  const bar = document.querySelector('.bn-wrapper .lg-tabbar__bar');
  if (bar) {
    pile(bar, { key: 'tabbar', maxHeight: 6, chance: 0.6 });
    whenSized(bar, (width, height) => {
      if (bar.querySelector(':scope > .xm-decor')) return;
      bar.appendChild(decor('xm-garland xm-garland--bar', lightsSvg(width, height / 2, hash(`tabbar:${dayKey()}`), { mode: 'rim', inset: 2.5, size: 1.6 })));
    });
  }
  const fab = document.querySelector('.lg-tabbar__prominent');
  if (fab) {
    pile(fab, { key: 'fab', maxHeight: 4, chance: 0.6 });
    // On the rim, where the circle is at 45° (the sprig's centre is 6 of its
    // 28 units in from its box's corner)
    whenSized(fab, (width) => {
      if (fab.querySelector(':scope > .xm-decor')) return;
      const sprig = decor('xm-sprig xm-sprig--fab', sprigSvg(22, hash(`fab:${dayKey()}`)));
      const at = `${f1(width / 2 * (1 - Math.SQRT1_2) - 22 * 6 / 28)}px`;
      sprig.style.left = at;
      sprig.style.top = at;
      fab.appendChild(sprig);
    });
  }
}

// ── Picker chips ──────────────────────────────────────────────────────────
// Snow on all three, holly on one a day, and a Santa hat on the date chip's
// "Today" badge

const CHIP_HOSTS = ['campus-chip-picker', 'date-chip-picker', 'time-range-chip-picker'];

function decorateChips() {
  const day = dayKey();
  const holly = hash(`chips:${day}`) % CHIP_HOSTS.length;
  CHIP_HOSTS.forEach((tag, i) => {
    const chip = document.querySelector(`${tag} .lg-chip`);
    if (!chip) return;
    pile(chip, { key: `chip:${tag}`, maxHeight: 4 });
    if (i === holly && !chip.querySelector(':scope > .xm-decor')) chip.appendChild(decor('xm-sprig xm-sprig--chip', sprigSvg(20, hash(`${tag}:${day}`))));
  });
  decorateTodayBadge();
}

function decorateTodayBadge() {
  const badge = document.querySelector('date-chip-picker .dcp-today-badge');
  if (!badge || badge.querySelector('.xm-hat')) return;
  if (getComputedStyle(badge).position === 'static') badge.style.position = 'relative';
  badge.appendChild(decor('xm-hat', SANTA_HAT_SVG));
}

// ── Map markers ───────────────────────────────────────────────────────────

function decorateMarker(el, { campus, building }) {
  if (el.querySelector(':scope > .xm-map-gift')) return;
  if (!gifts().buildings.has(`${campus.id}:${building.name}`)) return;
  const gift = document.createElement('span');
  gift.className = 'xm-map-gift';
  gift.innerHTML = GIFT_SVG;
  el.prepend(gift);
}

// ── The map ───────────────────────────────────────────────────────────────
// 3D Christmas trees, piles of gifts and snowmen standing in the open spots
// around each campus (data/season-spots.json), as a model layer in the map
// itself, like Halloween's (see components/halloween.js for the details).
// At night (dark mode's night preset) the trees' lights and stars glow, with
// a warm pool of light on the ground under them. The map's own snow falls
// while the Campus tab is on screen; it makes the map redraw constantly, so
// it's off whenever the map isn't showing.

const MAP_MODELS = ['tree', 'gifts', 'snowman', 'tree-night', 'gifts-night', 'snowman-night'];
const MAP_LAYER = 'xm-ground';
const GLOW_LAYER = 'xm-ground-glow';
const MAP_TAB = 'search-classrooms-container';

let mapRef = null;
let mapActive = false;
let mapSnowOn = false;

const darkScheme = matchMedia('(prefers-color-scheme: dark)');
// At night every model has a lit version (the night preset would leave the
// unlit ones near black): the tree's lights glow, the snowman and the gifts
// just stay visible
const glowFor = (dark) => ['match', ['get', 'model'], 'xm-tree', dark ? 0.8 : 0, 'xm-snowman', dark ? 0.6 : 0, 'xm-gifts', dark ? 0.55 : 0, 0];
const modelIdFor = (dark) => (dark ? ['concat', ['get', 'model'], '-night'] : ['get', 'model']);
const poolOpacity = (dark) => (dark ? 0.5 : 0);

const updateGlow = () => {
  const dark = darkScheme.matches;
  if (mapRef?.getLayer(MAP_LAYER)) {
    mapRef.setLayoutProperty(MAP_LAYER, 'model-id', modelIdFor(dark));
    mapRef.setPaintProperty(MAP_LAYER, 'model-emissive-strength', glowFor(dark));
  }
  if (mapRef?.getLayer(GLOW_LAYER)) mapRef.setPaintProperty(GLOW_LAYER, 'circle-opacity', poolOpacity(dark));
};

function groundPoints() {
  const features = [];
  const giftAt = [];
  for (const campus of directory ?? []) {
    for (const b of campus.buildings ?? []) {
      if (gifts().buildings.has(`${campus.id}:${b.name}`) && typeof b.lat === 'number') giftAt.push([campus.id, b.long, b.lat]);
    }
  }
  for (const [campusId, list] of Object.entries(seasonSpots)) {
    if (!Array.isArray(list)) continue;
    // The gift room's building gets gifts on its nearest spots
    const near = new Set();
    for (const [cid, hx, hy] of giftAt) {
      if (cid !== campusId) continue;
      const k = 111320 * Math.cos(hy * Math.PI / 180);
      list.map(([x, y], i) => [Math.hypot((x - hx) * k, (y - hy) * 111320), i])
        .filter(([d]) => d < 90)
        .sort((p, q) => p[0] - q[0])
        .slice(0, 2)
        .forEach(([, i]) => near.add(i));
    }
    list.forEach(([x, y], i) => {
      const h = hash(`xspot:${x},${y}`);
      const roll = h % 100;
      const model = near.has(i) ? 'gifts' : roll < 50 ? 'tree' : roll < 76 ? 'gifts' : 'snowman';
      features.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [x, y] },
        properties: { model: `xm-${model}`, rotation: [0, 0, (h >>> 8) % 360] },
      });
    });
  }
  return { type: 'FeatureCollection', features };
}

function decorateMap(map) {
  mapRef = map;
  updateMapSnow();
  if (mapActive) snowOverMap(map);
  if (!mapActive || map.getLayer(MAP_LAYER)) return;
  try {
    for (const name of MAP_MODELS) {
      try { map.addModel(`xm-${name}`, `/models/christmas/${name}.glb`); } catch { /* exists */ }
    }
    map.addSource(MAP_LAYER, { type: 'geojson', data: groundPoints() });
    map.addLayer({
      id: GLOW_LAYER,
      type: 'circle',
      source: MAP_LAYER,
      slot: 'middle',
      minzoom: 15,
      filter: ['==', ['get', 'model'], 'xm-tree'],
      paint: {
        'circle-pitch-alignment': 'map',
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 15, 14, 16, 20, 17, 26, 18, 32],
        'circle-blur': 1,
        'circle-color': '#ffc46b',
        'circle-opacity': poolOpacity(darkScheme.matches),
        'circle-emissive-strength': 1,
      },
    });
    map.addLayer({
      id: MAP_LAYER,
      type: 'model',
      source: MAP_LAYER,
      slot: 'middle',
      minzoom: 15,
      layout: { 'model-id': modelIdFor(darkScheme.matches) },
      paint: {
        'model-type': 'common-3d',
        // Same scale as Halloween's pumpkins: the tree, 1.5 m at real size,
        // is about 45 px tall at campus zoom
        'model-scale': ['interpolate', ['linear'], ['zoom'],
          15, ['literal', [26, 26, 26]],
          16, ['literal', [20, 20, 20]],
          17, ['literal', [13, 13, 13]],
          18, ['literal', [8, 8, 8]]],
        'model-rotation': ['get', 'rotation'],
        'model-cast-shadows': true,
        'model-receive-shadows': true,
        'model-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 15.6, 1],
        'model-emissive-strength': glowFor(darkScheme.matches),
      },
    });
  } catch (e) {
    console.warn('christmas: map decorations', e);
  }
}

const mapShowing = () => !!document.getElementById(MAP_TAB)?.classList.contains('visible') && !document.hidden;

// The map's snow on while the Campus tab is on screen, and the app's own off
// then (two snowfalls over the map would be one too many)
function updateMapSnow() {
  const showing = mapActive && mapShowing();
  holdSnowfall('map', showing);
  const want = showing && !reduceMotion();
  if (!mapRef || typeof mapRef.setSnow !== 'function' || want === mapSnowOn) return;
  try {
    mapRef.setSnow(want ? {
      density: ['interpolate', ['linear'], ['zoom'], 11, 0, 13, 0.6, 16, 0.75],
      intensity: 0.8,
      color: '#ffffff',
      opacity: 0.9,
      vignette: ['interpolate', ['linear'], ['zoom'], 11, 0, 14, 0.18],
      'vignette-color': darkScheme.matches ? '#c9d6e8' : '#ffffff',
      'center-thinning': 0.3,
      'flake-size': 0.65,
    } : null);
    mapSnowOn = want;
  } catch (e) {
    console.warn('christmas: map snow', e);
  }
}

const onTabVisible = () => requestAnimationFrame(updateMapSnow);

// A snowed-over landscape: Mapbox Standard has no winter option, so its
// ground, parks and campus areas are recoloured toward a cold white and its
// water to ice (its 3D trees stay green, like evergreens under snow). By day
// the buildings go white too. At night the preset's lighting darkens everything, so the snow
// can't get any lighter: it's pure white and the buildings and roads keep
// their own darker colours (null below), so the ground still stands out as
// the brightest thing on the map. Each value the map had is kept, so turning
// the season off puts it back.
const SNOW_COLOURS = {
  day: {
    colorLand: '#eef3f8',
    colorGreenspace: '#e1eaec',
    colorEducation: '#e8eef4',
    colorCommercial: '#e9edf3',
    colorMedical: '#e9edf3',
    colorIndustrial: '#e4e9ef',
    colorBuildings: '#f3f6fa',
    colorRoads: null,
    // Frozen: rivers and lakes as pale grey-blue ice, darker than the snow
    // around them so their banks still show
    colorWater: '#c9dcea',
  },
  night: {
    colorLand: '#ffffff',
    colorGreenspace: '#f2f8ff',
    colorEducation: '#ffffff',
    colorCommercial: '#ffffff',
    colorMedical: '#ffffff',
    colorIndustrial: '#f7faff',
    colorBuildings: null,
    colorRoads: null,
    colorWater: '#dbe8f4',
  },
};
let snowedOver = null;   // { key: the value before }

function snowOverMap(map) {
  if (typeof map.setConfigProperty !== 'function') return;
  if (!snowedOver) {
    snowedOver = {};
    const missed = [];
    for (const key of Object.keys(SNOW_COLOURS.day)) {
      // A property the style doesn't have reads back as nothing. (One it has
      // reads back as Mapbox's own colour object, hence the string.)
      try {
        const before = map.getConfigProperty?.('basemap', key);
        if (before == null) missed.push(key);
        else snowedOver[key] = String(before);
      } catch {
        missed.push(key);
      }
    }
    if (missed.length) console.warn('christmas: snowy map colours not applied (needs a newer Mapbox Standard?)', missed);
  }
  const palette = SNOW_COLOURS[darkScheme.matches ? 'night' : 'day'];
  for (const [key, before] of Object.entries(snowedOver)) {
    try { map.setConfigProperty('basemap', key, palette[key] ?? before); } catch { /* not ready */ }
  }
}

function thawMap(map) {
  if (!snowedOver) return;
  for (const [key, before] of Object.entries(snowedOver)) {
    try { map.setConfigProperty('basemap', key, before ?? null); } catch { /* gone */ }
  }
  snowedOver = null;
}

function clearMap() {
  const map = mapRef;
  if (!map) return;
  try {
    if (mapSnowOn && typeof map.setSnow === 'function') map.setSnow(null);
    thawMap(map);
    mapSnowOn = false;
    if (map.getLayer(MAP_LAYER)) map.removeLayer(MAP_LAYER);
    if (map.getLayer(GLOW_LAYER)) map.removeLayer(GLOW_LAYER);
    if (map.getSource(MAP_LAYER)) map.removeSource(MAP_LAYER);
    for (const name of MAP_MODELS) {
      try { map.removeModel(`xm-${name}`); } catch { /* never added */ }
    }
  } catch { /* the map was torn down already */ }
}

// ── Mistletoe under the settings button ───────────────────────────────────
// Hangs on a ribbon from behind it, swaying; a tap gives it a swing

// A bunch of mistletoe tied with a red bow, hanging from the bow's knot (at
// the top centre)
const MISTLETOE_SVG = (() => {
  let leaves = '';
  for (const [a, x, y] of [[60, 0, 4], [120, 0, 4], [35, -2, 9], [145, 2, 9], [80, -1, 12], [100, 1, 12]]) {
    leaves += `<path class="xm-mistle-leaf" d="M0 0 C3 -3 10 -4 15 -2 C11 1.5 4 2 0 0 Z" transform="translate(${x} ${y}) rotate(${a})"/>`;
  }
  const berries = [[-3, 16], [2, 17], [0, 14], [4, 13.5]].map(([x, y]) => `<circle class="xm-mistle-berry" cx="${x}" cy="${y}" r="1.7"/>`).join('');
  return `<svg width="34" height="38" viewBox="-17 -6 34 38" aria-hidden="true"><path class="xm-mistle-stem" d="M0 0V14"/>${leaves}${berries}${bowAt(0, 0, 15)}</svg>`;
})();

let mistletoe = null;
let mistletoeResize = null;

function placeMistletoe() {
  const btn = document.getElementById('settings-btn');
  if (!mistletoe || !btn) return;
  mistletoe.style.left = `${btn.offsetLeft + btn.offsetWidth / 2}px`;
  mistletoe.style.top = `${btn.offsetTop + btn.offsetHeight / 2}px`;
}

function startMistletoe() {
  const btn = document.getElementById('settings-btn');
  const host = btn?.offsetParent;
  if (!host) return;
  mistletoe = document.createElement('div');
  mistletoe.className = 'xm-mistletoe';
  mistletoe.innerHTML = `<div class="xm-mistletoe-sway"><div class="xm-mistletoe-line"></div>` +
    `<button type="button" class="xm-mistletoe-sprig" tabindex="-1" aria-hidden="true">${MISTLETOE_SVG}</button></div>`;
  const sprig = mistletoe.querySelector('.xm-mistletoe-sprig');
  sprig.addEventListener('click', (e) => {
    e.stopPropagation();
    if (reduceMotion()) return;
    const sway = mistletoe.querySelector('.xm-mistletoe-sway');
    sway.classList.remove('xm-mistletoe-sway--swing');
    void sway.offsetWidth;
    sway.classList.add('xm-mistletoe-sway--swing');
  });
  host.appendChild(mistletoe);
  placeMistletoe();
  mistletoeResize = new ResizeObserver(placeMistletoe);
  mistletoeResize.observe(host);
}

// ── Santa's sleigh (and the Befana) ───────────────────────────────────────

let sky = null;
let flyTimer = 0;

function flyBy() {
  if (reduceMotion() || document.hidden || !sky || document.body.classList.contains('detail-open')) return;
  const { month, day } = milanNow();
  const befana = month === 1 && day === 6;
  const W = innerWidth, H = innerHeight;
  const ltr = befana ? Math.random() < 0.5 : true;
  const el = document.createElement('div');
  el.className = 'xm-flyer' + (befana ? ' xm-flyer--befana' : '');
  el.innerHTML = befana ? BEFANA_SVG : SLEIGH_SVG;
  sky.appendChild(el);
  const width = befana ? 96 : 150;
  const y0 = H * (0.06 + Math.random() * 0.12);
  const rise = -20 - Math.random() * 40;
  const x0 = ltr ? -width - 20 : W + 20, x1 = ltr ? W + 20 : -width - 20;
  const flip = ltr ? '' : ' scaleX(-1)';
  const at = (t) => [x0 + (x1 - x0) * t, y0 + rise * t + Math.sin(t * Math.PI * 2) * 10];
  const frames = [];
  for (let k = 0; k <= 12; k++) {
    const tt = k / 12;
    const [x, y] = at(tt);
    frames.push({ transform: `translate(${f1(x)}px, ${f1(y)}px) rotate(${f1(Math.cos(tt * Math.PI * 2) * -4)}deg)${flip}` });
  }
  const duration = 5200 + Math.random() * 1600;
  const anim = el.animate(frames, { duration, easing: 'linear', fill: 'both' });
  // A trail of sparkles from the back of the sleigh
  const started = performance.now();
  const trail = setInterval(() => {
    const p = (performance.now() - started) / duration;
    if (p >= 1 || !sky) { clearInterval(trail); return; }
    const [x, y] = at(p);
    const s = document.createElement('div');
    s.className = 'xm-sparkle';
    s.style.transform = `translate(${f1(x + (ltr ? 4 : width - 4) + (Math.random() - 0.5) * 8)}px, ${f1(y + 30 + (Math.random() - 0.5) * 8)}px)`;
    sky.appendChild(s);
    s.addEventListener('animationend', () => s.remove());
  }, 70);
  anim.onfinish = anim.oncancel = () => { clearInterval(trail); el.remove(); };
}

function scheduleFlyBy(first = false) {
  const wait = first ? 12000 + Math.random() * 15000 : 70000 + Math.random() * 90000;
  flyTimer = setTimeout(() => {
    flyBy();
    scheduleFlyBy();
  }, wait);
}

// ── Confetti: gifts, unwrapping, fireworks ────────────────────────────────

let confettiLib = null;
let fx = null;           // { fire, gifts }
let fxCanvas = null;
let lastTap = null;      // { x, y, at }

const rememberTap = (e) => { lastTap = { x: e.clientX, y: e.clientY, at: performance.now() }; };

async function confettiFx() {
  if (fx) return fx;
  if (!confettiLib) ({ default: confettiLib } = await import('canvas-confetti'));
  if (!sky) return null;   // stopped while loading
  fxCanvas = document.createElement('canvas');
  fxCanvas.className = 'xm-fx';
  document.body.appendChild(fxCanvas);
  let giftShapes = ['circle'];
  try {
    giftShapes = ['🎁', '🎄', '⭐'].map((text) => confettiLib.shapeFromText({ text, scalar: 1.8 }));
  } catch { /* no emoji shapes: squares */ }
  fx = { fire: confettiLib.create(fxCanvas, { resize: true }), gifts: giftShapes };
  return fx;
}

// Starred: a burst of presents, trees and stars from the star that was just
// tapped (Halloween's candy, components/halloween.js, with other shapes)
async function rainGifts() {
  if (reduceMotion()) return;
  const c = await confettiFx();
  if (!c) return;
  const tap = lastTap && performance.now() - lastTap.at < 1500 ? lastTap : { x: innerWidth / 2, y: innerHeight * 0.2 };
  c.fire({
    particleCount: 16, spread: 75, startVelocity: 20, gravity: 0.9, ticks: 140, scalar: 1.8, flat: true,
    shapes: c.gifts,
    colors: ['#d92b35', '#1f8a4c', '#e8b23a', '#ffffff'],
    origin: { x: tap.x / fxCanvas.clientWidth, y: Math.min(1, tap.y / fxCanvas.clientHeight) },
    disableForReducedMotion: true,
  });
}

const onFavouritesChanged = (e) => {
  if (e.detail?.added != null) rainGifts();
};

// The gift room unwrapped: a burst of red, gold and green from the bow
async function celebrate(x, y) {
  if (reduceMotion()) return;
  const c = await confettiFx();
  if (!c) return;
  c.fire({
    particleCount: 70, spread: 80, startVelocity: 32, ticks: 160, scalar: 0.9,
    colors: ['#d92b35', '#e8b23a', '#1f8a4c', '#ffffff'],
    origin: { x: x / fxCanvas.clientWidth, y: y / fxCanvas.clientHeight },
    disableForReducedMotion: true,
  });
}

// Fireworks across the top half of the screen for `ms`, then a big gold one
async function fireworks(ms = 6000) {
  if (reduceMotion()) return;
  const c = await confettiFx();
  if (!c) return;
  const colors = ['#ffd36b', '#ff5d5d', '#62d4ff', '#86f08f', '#ffffff'];
  const end = Date.now() + ms;
  const id = setInterval(() => {
    if (Date.now() > end || !fx) {
      clearInterval(id);
      if (fx) c.fire({ particleCount: 160, spread: 160, startVelocity: 45, origin: { y: 0.5 }, colors: ['#ffd36b', '#ffffff', '#e8b23a'], disableForReducedMotion: true });
      return;
    }
    const o = { startVelocity: 28, spread: 360, ticks: 70, particleCount: 28, colors, gravity: 0.8, disableForReducedMotion: true };
    c.fire({ ...o, origin: { x: 0.1 + Math.random() * 0.3, y: 0.12 + Math.random() * 0.3 } });
    c.fire({ ...o, origin: { x: 0.6 + Math.random() * 0.3, y: 0.12 + Math.random() * 0.3 } });
  }, 320);
}

// New Year: fireworks at midnight if the app is open then, and once when it's
// opened on New Year's Day
let midnightTimer = 0;

function scheduleNewYear() {
  const { month, day, hour, minute, second } = milanNow();
  if (month === 1 && day === 1) {
    setTimeout(() => fireworks(4000), 2500);
  } else if (month === 12 && day === 31) {
    const ms = ((23 - hour) * 3600 + (59 - minute) * 60 + (60 - second)) * 1000;
    midnightTimer = setTimeout(() => fireworks(12000), ms);
  }
}

// ── Logo and tab icon ─────────────────────────────────────────────────────
// The header and splash logos' own <img>s take the Christmas drawing (the
// usual logo in a Santa hat, with a present, the chair at the same spot), as
// Halloween's does (components/halloween.js): .xm-logo sizes it so the chair
// lands exactly where it was (see style.css). index.html already swaps them
// as they're parsed; this covers the season being turned on later, and puts
// the usual logo back when it's turned off. The tab icon changes too.

const LOGO_SRC = '/favicons/christmas/logo.webp';
const USUAL_LOGO_SRC = '/favicons/main/logo.webp';
const ICON_SRC = '/favicons/christmas/favicon-96x96.png';
let logoSwap = null;   // { el, src }
let iconSwap = null;   // [{ link, href, type }]

function startLogo() {
  const el = document.querySelector('.header-logo');
  if (el?.classList.contains('xm-logo')) {
    logoSwap = { el, src: USUAL_LOGO_SRC };
  } else if (el) {
    const img = new Image();
    img.src = LOGO_SRC;
    // Swapped only once it's decoded, so the header never shows a blank logo
    img.decode().then(() => {
      if (logoSwap || !sky) return;
      logoSwap = { el, src: el.getAttribute('src') };
      el.src = LOGO_SRC;
      el.classList.add('xm-logo');
    }).catch(() => { /* keep the usual logo */ });
  }
  iconSwap = [...document.querySelectorAll('link[rel~="icon"]')].map((link) => ({ link, href: link.getAttribute('href'), type: link.type }));
  for (const { link } of iconSwap) {
    link.type = 'image/png';
    link.href = ICON_SRC;
  }
}

function stopLogo() {
  if (logoSwap) {
    logoSwap.el.src = logoSwap.src;
    logoSwap.el.classList.remove('xm-logo');
    logoSwap = null;
  }
  for (const { link, href, type } of iconSwap ?? []) {
    link.type = type;
    link.href = href;
  }
  iconSwap = null;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────

// Whatever was built before this module loaded, or before the rooms did (the
// gift rooms need them)
function decorateBuilt() {
  document.querySelectorAll('.classroom-card').forEach((card) => {
    const id = Number(card.dataset.openClassroom);
    if (id) decorateCard(card, { id });
  });
  document.querySelectorAll('.map-pin[data-building][data-campus]').forEach((el) => {
    decorateMarker(el, { campus: { id: el.dataset.campus }, building: { name: el.dataset.building } });
  });
  document.querySelectorAll('.bo-card[data-building-name]').forEach((folder) => {
    decorateFolder(folder, { campusId: folder.dataset.campusId, building: { name: folder.dataset.buildingName } });
  });
  document.querySelectorAll('.building-section-header').forEach((header) => {
    const section = header.closest('.building-section');
    if (section) decorateBuildingHeader(header, { building: { name: section.dataset.buildingName } });
  });
}

let chipsTimer = 0;
let listeners = new AbortController();

export function start() {
  listeners = new AbortController();
  const { signal } = listeners;
  cardRadius = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--radius-lg')) || 16;
  giftLabel = t('season.christmas.giftRoom');

  startSnowfall();
  setDecorator('card', decorateCard);
  setDecorator('marker', decorateMarker);
  setDecorator('folder', decorateFolder);
  setDecorator('detail', decorateDetail);
  setDecorator('searchRow', decorateSearchRow);
  setDecorator('banner', decorateBanner);
  setDecorator('buildingHeader', decorateBuildingHeader);
  mapActive = true;
  setDecorator('map', decorateMap);
  darkScheme.addEventListener('change', updateGlow, { signal });
  darkScheme.addEventListener('change', () => { if (mapRef && snowedOver) snowOverMap(mapRef); }, { signal });
  document.addEventListener('tabvisible', onTabVisible, { signal });
  document.addEventListener('visibilitychange', updateMapSnow, { signal });
  updateMapSnow();

  decorateBuilt();
  decorateTabBar();
  decorateSearchPanel();
  decorateSheet();
  document.addEventListener('campussheetresize', decorateSheet, { signal });

  Promise.all(CHIP_HOSTS.map((tag) => customElements.whenDefined(tag))).then(() => {
    chipsTimer = setTimeout(decorateChips, 300);
  });

  startMistletoe();
  if (!directory) {
    ensureClassroomDirectory().then(() => {
      if (!mapActive) return;
      decorateBuilt();
      if (mapRef?.getSource(MAP_LAYER)) mapRef.getSource(MAP_LAYER).setData(groundPoints());
    }).catch(() => { /* no gift rooms today */ });
  }

  sky = document.createElement('div');
  sky.className = 'xm-sky';
  sky.setAttribute('aria-hidden', 'true');
  document.body.appendChild(sky);
  scheduleFlyBy(true);
  scheduleNewYear();
  startLogo();

  window.addEventListener('pointerdown', rememberTap, { capture: true, passive: true, signal });
  window.addEventListener('favourites-changed', onFavouritesChanged, { signal });
}

export function stop() {
  mapActive = false;
  stopLogo();
  clearMap();
  listeners.abort();
  holdSnowfall('map', false);
  stopSnowfall();
  firstSize.disconnect();
  clearTimeout(chipsTimer);
  clearTimeout(flyTimer);
  clearTimeout(midnightTimer);
  mistletoeResize?.disconnect();
  mistletoe?.remove();
  mistletoe = null;
  sky?.remove();
  sky = null;
  fxCanvas?.remove();
  fxCanvas = null;
  fx = null;
  document.querySelectorAll('.xm-decor, .xm-ribbon, .xm-map-gift, .xm-search-gift').forEach((el) => el.remove());
}
