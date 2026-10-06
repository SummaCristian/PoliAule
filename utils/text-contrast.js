/**
 * Colours for the detail page's title and subtitle over the hero photo, chosen
 * to read at 4.5:1 or better wherever a colour can.
 *
 * With the page at rest it rebuilds what is painted behind each line of text:
 * the page's tinted background, the blurred backdrop and the sharp photo, each
 * faded by its mask, dimmed in dark mode. It takes the 95th percentile of that,
 * not the mean (a bright window behind one word is what you can't read), picks
 * one tone for both lines (black or white, whichever their weaker line does
 * better with), and in that tone the least extreme lightness, in the photo's
 * hue, that still reaches the target; plain white or black where none does (a
 * mid-grey photo can leave even those short).
 *
 * Only the title's way into its pill is moving; that is covered by the pill's
 * glass (see "The pin" in classroom-detail.css).
 */

const TARGET = 4.5;
const MARGIN = 1.1; // aim 10% over the target: the model is close, not exact
const PCT = 95;
const CHROMA = { light: 0.03, dark: 0.06 };

// The masks of .detail-photo and .detail-photo-backdrop (classroom-detail.css),
// as [position, alpha] stops. Keep in sync.
const MASK_PHOTO = [[0, 1], [0.45, 1], [0.55, 0.92], [0.65, 0.75], [0.75, 0.5], [0.85, 0.27], [0.93, 0.1], [1, 0]];
const MASK_BACKDROP = [[0, 1], [0.45, 1], [0.55, 0.85], [0.65, 0.6], [0.75, 0.35], [0.85, 0.15], [0.93, 0.04], [1, 0]];

/* ── colour ── */

const toLin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const lumOf = ([r, g, b]) => 0.2126 * toLin(r) + 0.7152 * toLin(g) + 0.0722 * toLin(b);
const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function hueOf([r, g, b]) {
  const R = toLin(r), G = toLin(g), B = toLin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const Bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return (Math.atan2(Bb, A) * 180 / Math.PI + 360) % 360;
}

/** OKLCH → sRGB (0..1), pulling chroma in until it fits the gamut. */
function oklch(L, C, h) {
  for (let c = C; c >= 0; c -= 0.005) {
    const A = c * Math.cos(h * Math.PI / 180), B = c * Math.sin(h * Math.PI / 180);
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
    const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
    const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
    const rgb = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ].map(toGamma);
    if (rgb.every(v => v >= -0.001 && v <= 1.001)) return rgb.map(v => Math.min(1, Math.max(0, v)));
  }
  return [L, L, L];
}

let parseCtx = null;
/** Any CSS colour → [r, g, b] (0..1), resolved by a canvas. */
function parseColor(str) {
  if (!parseCtx) {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    parseCtx = c.getContext('2d', { willReadFrequently: true });
  }
  parseCtx.clearRect(0, 0, 1, 1);
  parseCtx.fillStyle = '#000';
  parseCtx.fillStyle = str;
  parseCtx.fillRect(0, 0, 1, 1);
  const d = parseCtx.getImageData(0, 0, 1, 1).data;
  return [d[0] / 255, d[1] / 255, d[2] / 255];
}

const cssRgb = rgb => `rgb(${rgb.map(c => Math.round(c * 255)).join(' ')})`;

/* ── the photo ── */

const pixelCache = new WeakMap(); // small canvas → { w, h, data, blurred: Map }

function pixelsOf(canvas) {
  let p = pixelCache.get(canvas);
  if (p) return p;
  const { width: w, height: h } = canvas;
  const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const data = new Float32Array(w * h * 3);
  for (let i = 0, j = 0; i < d.length; i += 4, j += 3) {
    data[j] = d[i] / 255; data[j + 1] = d[i + 1] / 255; data[j + 2] = d[i + 2] / 255;
  }
  p = { w, h, data, blurred: new Map() };
  pixelCache.set(canvas, p);
  return p;
}

/** Three box blurs ≈ a Gaussian of std dev `sigma` px; x wraps (the backdrop tiles sideways), y clamps. */
function blurredOf(p, sigma) {
  const r = Math.max(1, Math.round(sigma));
  if (p.blurred.has(r)) return p.blurred.get(r);
  const { w, h } = p;
  const a = Float32Array.from(p.data), b = new Float32Array(a.length);
  const pass = (from, to, horizontal) => {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let s0 = 0, s1 = 0, s2 = 0;
        for (let k = -r; k <= r; k++) {
          const xx = horizontal ? ((x + k) % w + w) % w : x;
          const yy = horizontal ? y : Math.min(h - 1, Math.max(0, y + k));
          const j = (yy * w + xx) * 3;
          s0 += from[j]; s1 += from[j + 1]; s2 += from[j + 2];
        }
        const j = (y * w + x) * 3, n = 2 * r + 1;
        to[j] = s0 / n; to[j + 1] = s1 / n; to[j + 2] = s2 / n;
      }
    }
  };
  for (let i = 0; i < 3; i++) { pass(a, b, true); pass(b, a, false); }
  p.blurred.set(r, a);
  return a;
}

function sample(data, p, u, v) {
  const x = Math.min(p.w - 1, Math.max(0, Math.floor(u * p.w)));
  const y = Math.min(p.h - 1, Math.max(0, Math.floor(v * p.h)));
  const j = (y * p.w + x) * 3;
  return [data[j], data[j + 1], data[j + 2]];
}

/** A point in a box the image is drawn `cover` into → image uv. */
function coverUv(px, py, bw, bh, p) {
  const s = Math.max(bw / p.w, bh / p.h);
  const dw = p.w * s, dh = p.h * s;
  return [(px - (bw - dw) / 2) / dw, (py - (bh - dh) / 2) / dh];
}

function interp(stops, t) {
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, v0] = stops[i - 1], [t1, v1] = stops[i];
      return v0 + (v1 - v0) * (t - t0) / (t1 - t0);
    }
  }
  return stops[stops.length - 1][1];
}

/**
 * Screen point → the colour painted there, as the page looks once the photo is
 * in: page tint, then the backdrop (the photo blurred, its strip 2 blur radii
 * above the bottom stretched down below it), then the photo, each through its
 * mask and times `dim`.
 */
function painter({ photo, backdrop, pageBg, dim, blur, pixels }) {
  const photoH = backdrop ? backdrop.height / 2 : 0;
  const blurredData = backdrop
    ? blurredOf(pixels, blur / Math.max(backdrop.width / pixels.w, photoH / pixels.h))
    : null;
  return (x, y) => {
    let c = pageBg;
    if (backdrop && x >= backdrop.left && x <= backdrop.right && y >= backdrop.top && y <= backdrop.bottom) {
      const a = interp(MASK_BACKDROP, (y - backdrop.top) / backdrop.height);
      const yy = Math.min(y - backdrop.top, photoH - 2 * blur);
      const [u, v] = coverUv(x - backdrop.left, yy, backdrop.width, photoH, pixels);
      const s = sample(blurredData, pixels, ((u % 1) + 1) % 1, v);
      c = mix(c, [s[0] * dim, s[1] * dim, s[2] * dim], a);
    }
    if (x >= photo.left && x <= photo.right && y >= photo.top && y <= photo.bottom) {
      const a = interp(MASK_PHOTO, (y - photo.top) / photo.height);
      const [u, v] = coverUv(x - photo.left, y - photo.top, photo.width, photo.height, pixels);
      const s = sample(pixels.data, pixels, u, v);
      c = mix(c, [s[0] * dim, s[1] * dim, s[2] * dim], a);
    }
    return c;
  };
}

/* ── the text ── */

function textRects(el) {
  const range = document.createRange();
  range.selectNodeContents(el);
  return [...range.getClientRects()].filter(r => r.width > 1 && r.height > 1);
}

function colorsBehind(paint, rects) {
  const out = [];
  for (const r of rects) {
    for (let y = r.top + 1; y < r.bottom - 1; y += 3) {
      for (let x = r.left + 1; x < r.right - 1; x += 3) out.push(paint(x, y));
    }
  }
  return out;
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))];
const sortedLums = colors => colors.map(lumOf).sort((a, b) => a - b);

/** The background's percentile pixel that `tone` text has to beat: the brightest for light text, the darkest for dark. */
const worstFor = (lums, tone) => pct(lums, tone === 'light' ? PCT : 100 - PCT);

/**
 * The colour for `tone` text: in the photo's hue, the least extreme lightness
 * that still reaches the target against `worst`; the extreme itself when none does.
 */
function inkFor(tone, worst, hue) {
  const [from, to, step] = tone === 'light' ? [0.99, 0.8, -0.005] : [0.16, 0.42, 0.005];
  let best = null;
  for (let L = from; step < 0 ? L >= to : L <= to; L += step) {
    const rgb = oklch(L, CHROMA[tone], hue);
    if (contrast(lumOf(rgb), worst) < TARGET * MARGIN) break;
    best = rgb;
  }
  return best ?? (tone === 'light' ? [1, 1, 1] : [0, 0, 0]);
}

/**
 * Plans the header's text over the photo. `lines` are the elements to read
 * (title, subtitle); the rest describes the page as laid out at rest.
 * Returns null when there is nothing to read against.
 *
 * @returns {{ tone: 'light'|'dark', inks: string[] } | null}
 */
export function planHeaderText({ lines, photoBox, backdropBox, pageBg, dim, blur, tint, small }) {
  if (!small || !photoBox) return null;
  const pixels = pixelsOf(small);
  const paint = painter({ photo: photoBox, backdrop: backdropBox, pageBg: parseColor(pageBg), dim, blur, pixels });
  const hue = hueOf(parseColor(tint));

  const items = lines.flatMap(el => {
    const rects = el ? textRects(el) : [];
    const colors = colorsBehind(paint, rects);
    return colors.length ? [{ lums: sortedLums(colors) }] : [];
  });
  if (items.length !== lines.length) return null;

  // One tone for both: the one whose weaker line does better, white given a
  // nudge (it reads better than its ratio on mid-tones).
  const best = tone => Math.min(...items.map(i => contrast(tone === 'light' ? 1 : 0, worstFor(i.lums, tone))));
  const tone = best('light') * 1.15 >= best('dark') ? 'light' : 'dark';

  return { tone, inks: items.map(i => cssRgb(inkFor(tone, worstFor(i.lums, tone), hue))) };
}
