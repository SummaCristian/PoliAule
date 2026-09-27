import { getApiBase } from '../config.js';

// classroom id (number) → resolved URL string
export const photoUrlCache = new Map();
// classroom id (number) → resolved thumbnail URL string
export const thumbUrlCache = new Map();

export async function fetchPhotoUrl(classroomId) {
  if (photoUrlCache.has(classroomId)) return photoUrlCache.get(classroomId);

  const url = `${getApiBase()}/v1/photos/${classroomId}`;
  photoUrlCache.set(classroomId, url);
  return url;
}

/**
 * The room's thumbnail URL, without marking it as loaded. It's 640px on its
 * long side (scripts/fetch_photos.py writes it next to the full photo), where
 * the full photo is 1500x1125, about 6.7 MB once decoded, for a card ~160 CSS
 * px wide; a list of those was what made older phones stutter.
 */
export function thumbUrl(classroomId) {
  return `${getApiBase()}/v1/photos/${classroomId}/thumb`;
}

// Rooms whose photo failed to load: an idfoto the API has no image for (it
// couldn't be fetched from PoliMi). Shown as photo-less for the rest of the
// session instead of being asked for, and failing, again on every render.
const brokenPhotos = new Set();

export function markPhotoBroken(classroomId) {
  brokenPhotos.add(classroomId);
}

export function isPhotoBroken(classroomId) {
  return brokenPhotos.has(classroomId);
}

/** fetchPhotoUrl for the thumbnail: what cards, search rows and the detail page's zoom show. */
export async function fetchThumbUrl(classroomId) {
  if (thumbUrlCache.has(classroomId)) return thumbUrlCache.get(classroomId);

  const url = thumbUrl(classroomId);
  thumbUrlCache.set(classroomId, url);
  return url;
}

// photo URL → CSS color string, or null when it couldn't be read (canvas taint, decode error)
const photoColorCache = new Map();
// photo URL → average relative luminance (0–1, linear light) of the same bottom strip
const photoLumCache = new Map();
// photo URL → average relative luminance of the whole photo (drives dark-mode dimming)
const photoAvgLumCache = new Map();
// photo URL → the photo 96px wide, kept from extractPhotoColor's load for blurredBackdrop
const photoSmallCache = new Map();
// photo URL + box → data URL of its pre-blurred backdrop
const backdropCache = new Map();

/** Synchronous read of the whole photo's average luminance (null if not extracted yet / unreadable). */
export function getCachedPhotoAverageLuminance(url) {
  return photoAvgLumCache.get(url) ?? null;
}

/** Synchronous read of the strip's average luminance (null if not extracted yet / unreadable). */
export function getCachedPhotoLuminance(url) {
  return photoLumCache.get(url) ?? null;
}

/** Synchronous read of extractPhotoColor's cache (null if not extracted yet / unreadable). */
export function getCachedPhotoColor(url) {
  return photoColorCache.get(url) ?? null;
}

/**
 * Dominant color of the photo's bottom edge, saturation-boosted so grey/beige
 * rooms don't average to mud. That edge is the one the hero fades out of, so
 * it's what the page background has to match. Lightness is only loosely clamped
 * here; the CSS mixes the result with the theme's background.
 * Reads pixels from a separate CORS-mode load (the API sends ACAO: *).
 */
export function extractPhotoColor(url) {
  if (photoColorCache.has(url)) return Promise.resolve(photoColorCache.get(url));

  return new Promise(resolve => {
    const done = color => { photoColorCache.set(url, color); resolve(color); };
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => done(null);
    img.onload = () => {
      try {
        const W = 32, H = 8;
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const sh = img.naturalHeight * 0.35;
        ctx.drawImage(img, 0, img.naturalHeight - sh, img.naturalWidth, sh, 0, 0, W, H);
        const data = ctx.getImageData(0, 0, W, H).data;

        let r = 0, g = 0, b = 0, wSum = 0, lum = 0;
        for (let i = 0; i < data.length; i += 4) {
          lum += relativeLuminance(data[i], data[i + 1], data[i + 2]);
          const max = Math.max(data[i], data[i + 1], data[i + 2]);
          const min = Math.min(data[i], data[i + 1], data[i + 2]);
          const w = 0.1 + (max - min) / 255; // favor colorful pixels over grey walls
          r += data[i] * w; g += data[i + 1] * w; b += data[i + 2] * w;
          wSum += w;
        }
        photoLumCache.set(url, lum / (data.length / 4));

        // Whole photo, for how bright it reads overall.
        ctx.clearRect(0, 0, W, H);
        ctx.drawImage(img, 0, 0, W, H);
        const all = ctx.getImageData(0, 0, W, H).data;
        let avg = 0;
        for (let i = 0; i < all.length; i += 4) avg += relativeLuminance(all[i], all[i + 1], all[i + 2]);
        photoAvgLumCache.set(url, avg / (all.length / 4));

        // Small enough to keep, and plenty for a copy blurred by tens of px.
        const small = document.createElement('canvas');
        small.width = 96;
        small.height = Math.max(1, Math.round(96 * img.naturalHeight / img.naturalWidth));
        const sctx = small.getContext('2d', { willReadFrequently: true });
        sctx.imageSmoothingQuality = 'high';
        sctx.drawImage(img, 0, 0, small.width, small.height);
        photoSmallCache.set(url, small);

        done(rgbToTint(r / wSum, g / wSum, b / wSum));
      } catch {
        done(null);
      }
    };
    img.src = url;
  });
}

/**
 * The detail page's blurred photo backdrop, rendered once into a small bitmap:
 * the same box its CSS draws (the photo `center / cover` in the content box,
 * tiled into the bleed, blurred and saturated as one), for the CSS to stretch
 * over that box instead of blurring it live. A live blur is redone by the GPU
 * on every frame the page moves or scales, which is every frame of the zoom.
 *
 * `box` is the pseudo-element's border box in CSS px, with its bleed (the
 * padding the tiles fill) and blur radius. Null when the photo hasn't been
 * through extractPhotoColor yet, or a canvas can't blur here.
 */
export function blurredBackdrop(url, { width, height, bleed, blur, repeatY }) {
  const src = photoSmallCache.get(url);
  if (!src || !(width > 0 && height > 0 && blur > 0) || !canvasCanBlur()) return null;
  const key = `${url}|${Math.round(width)}x${Math.round(height)}|${bleed}|${blur}|${repeatY}`;
  if (backdropCache.has(key)) return backdropCache.get(key);

  // One canvas pixel per third of the blur radius: the blur leaves nothing
  // finer than that, and the browser's smooth upscaling fills in between.
  const W = Math.max(2, Math.ceil(width / (blur / 3)));
  const H = Math.max(2, Math.ceil(height / (blur / 3)));
  const sx = W / width, sy = H / height;

  // The tiles first, unfiltered: a canvas filter applies per draw call, and
  // blurring each tile on its own would leave seams between them.
  const tiles = document.createElement('canvas');
  tiles.width = W;
  tiles.height = H;
  // CPU-backed (willReadFrequently), all three: a GPU canvas is slower to set
  // up than a bitmap this size takes to draw, and has to be read back for
  // toDataURL.
  const t = tiles.getContext('2d', { willReadFrequently: true });
  t.imageSmoothingQuality = 'high';
  const cx = bleed * sx, cy = bleed * sy;
  const cw = W - 2 * cx, ch = H - 2 * cy;
  const scale = Math.max(cw / src.width, ch / src.height);
  const iw = src.width * scale, ih = src.height * scale;
  const x0 = cx + (cw - iw) / 2, y0 = cy + (ch - ih) / 2;
  const first = (start, size) => start - Math.ceil(start / size) * size;
  for (let x = first(x0, iw); x < W; x += iw) {
    if (repeatY) {
      for (let y = first(y0, ih); y < H; y += ih) t.drawImage(src, x, y, iw, ih);
    } else {
      t.drawImage(src, x, y0, iw, ih);
    }
  }

  const out = document.createElement('canvas');
  out.width = W;
  out.height = H;
  const o = out.getContext('2d', { willReadFrequently: true });
  o.filter = `blur(${blur * sx}px) saturate(1.25)`;
  o.drawImage(tiles, 0, 0);
  const data = out.toDataURL('image/png');
  backdropCache.set(key, data);
  return data;
}

// Whether a canvas can blur (ctx.filter): Safari only has it from 18.
let canBlur;
function canvasCanBlur() {
  if (canBlur !== undefined) return canBlur;
  try {
    const c = document.createElement('canvas');
    c.width = 5;
    c.height = 1;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.filter = 'blur(1px)';
    ctx.fillRect(2, 0, 1, 1);
    canBlur = ctx.getImageData(0, 0, 1, 1).data[3] > 0;
  } catch {
    canBlur = false;
  }
  return canBlur;
}

// WCAG relative luminance of an 8-bit sRGB pixel
function relativeLuminance(r, g, b) {
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function rgbToTint(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  s = Math.min(1, s * 1.35);
  const cl = Math.min(0.7, Math.max(0.2, l));
  return `hsl(${h.toFixed(0)} ${(s * 100).toFixed(0)}% ${(cl * 100).toFixed(0)}%)`;
}
