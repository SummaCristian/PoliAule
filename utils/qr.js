// QR code → SVG string, with a customizable look.
//
// qrcode-generator only supplies the module matrix (which cells are dark); the
// drawing is ours, so every part of the code can be styled: data modules,
// the three finder patterns (the big corner "eyes"), colours, and an optional
// logo in the centre.
//
//   renderQrSvg('https://poliaule.com/#import=…', {
//     moduleShape: 'dot', finderShape: 'rounded', logo: '/favicons/main/favicon.svg',
//   });
//
// Colours default to CSS custom properties (--qr-fg / --qr-finder / --qr-bg,
// see settings.css), so the look can also be changed from CSS alone. Keep the
// background light: inverted codes (light on dark) don't scan on some phones.
import qrcode from 'qrcode-generator';
import { escapeHtml } from './html.js';

export const QR_DEFAULTS = {
  fg: 'var(--qr-fg, #1c1c1e)',          // data modules
  finderColor: 'var(--qr-finder, #1c1c1e)', // finder patterns (defaults to the modules' colour)
  bg: 'var(--qr-bg, #ffffff)',
  moduleShape: 'rounded',   // 'square' | 'rounded' | 'dot'
  finderShape: 'rounded',   // 'square' | 'rounded' | 'circle'
  logo: null,               // image URL (trusted, same-origin), drawn on a plate in the centre
  logoScale: 0.22,          // logo plate size as a fraction of the code's width
  quietZone: 3,             // empty border, in modules (4 is the spec; phones cope with less)
  ecLevel: null,            // 'L' | 'M' | 'Q' | 'H'; null → 'H' with a logo, 'M' without
};

const FINDER = 7; // finder patterns are 7×7 modules

// Rounded-rect path, one sub-path; used for finder rings/centres.
function roundRect(x, y, w, h, r) {
  return `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}` +
    `h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;
}

function circle(cx, cy, r) {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
}

// One finder pattern at (x, y): a 7×7 ring (1 module thick) around a 3×3 centre.
// The ring is an even-odd path of outer + inner outline.
function finderPath(x, y, shape) {
  if (shape === 'circle') {
    return {
      ring: circle(x + 3.5, y + 3.5, 3.5) + circle(x + 3.5, y + 3.5, 2.5),
      eye: circle(x + 3.5, y + 3.5, 1.5),
    };
  }
  const r = shape === 'rounded' ? [2, 1.2, 0.9] : [0, 0, 0];
  return {
    ring: roundRect(x, y, 7, 7, r[0]) + roundRect(x + 1, y + 1, 5, 5, r[1]),
    eye: roundRect(x + 2, y + 2, 3, 3, r[2]),
  };
}

function modulePath(x, y, shape) {
  if (shape === 'dot') return circle(x + 0.5, y + 0.5, 0.45);
  if (shape === 'rounded') return roundRect(x + 0.05, y + 0.05, 0.9, 0.9, 0.3);
  return `M${x} ${y}h1v1h-1z`;
}

export function renderQrSvg(text, options = {}) {
  const o = { ...QR_DEFAULTS, ...options };
  const ec = o.ecLevel ?? (o.logo ? 'H' : 'M');

  const qr = qrcode(0, ec); // type 0 = smallest version that fits
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();

  const inFinder = (r, c) =>
    (r < FINDER && c < FINDER) || (r < FINDER && c >= n - FINDER) || (r >= n - FINDER && c < FINDER);

  // Modules hidden behind the logo plate, rounded out to whole modules and
  // kept centred (same parity as n). EC level H recovers up to ~30%; the
  // default 0.22 scale clears about 5%.
  let logoSize = 0;
  let logoStart = n;
  if (o.logo) {
    logoSize = Math.round(n * o.logoScale);
    if ((n - logoSize) % 2) logoSize += 1;
    logoStart = (n - logoSize) / 2;
  }
  const underLogo = (r, c) =>
    r >= logoStart && r < logoStart + logoSize && c >= logoStart && c < logoStart + logoSize;

  let modules = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c) || inFinder(r, c) || underLogo(r, c)) continue;
      modules += modulePath(c, r, o.moduleShape);
    }
  }

  let rings = '';
  let eyes = '';
  for (const [x, y] of [[0, 0], [n - FINDER, 0], [0, n - FINDER]]) {
    const f = finderPath(x, y, o.finderShape);
    rings += f.ring;
    eyes += f.eye;
  }

  let logo = '';
  if (o.logo) {
    const pad = 0.6;
    const inner = logoSize - 2 * pad;
    logo =
      `<rect class="qr__logo-plate" x="${logoStart}" y="${logoStart}" width="${logoSize}" height="${logoSize}" rx="${logoSize * 0.22}" style="fill:${escapeHtml(o.bg)}"/>` +
      `<image class="qr__logo" href="${escapeHtml(o.logo)}" x="${logoStart + pad}" y="${logoStart + pad}" width="${inner}" height="${inner}" preserveAspectRatio="xMidYMid meet"/>`;
  }

  const q = o.quietZone;
  const size = n + 2 * q;
  return (
    `<svg class="qr" xmlns="http://www.w3.org/2000/svg" viewBox="${-q} ${-q} ${size} ${size}" shape-rendering="geometricPrecision" role="img">` +
      `<rect class="qr__bg" x="${-q}" y="${-q}" width="${size}" height="${size}" style="fill:${escapeHtml(o.bg)}"/>` +
      `<path class="qr__modules" d="${modules}" style="fill:${escapeHtml(o.fg)}"/>` +
      `<path class="qr__finder-ring" d="${rings}" fill-rule="evenodd" style="fill:${escapeHtml(o.finderColor)}"/>` +
      `<path class="qr__finder-eye" d="${eyes}" style="fill:${escapeHtml(o.finderColor)}"/>` +
      logo +
    `</svg>`
  );
}
