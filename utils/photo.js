import { getApiBase } from '../config.js';

// classroom id (number) → resolved URL string
export const photoUrlCache = new Map();

export async function fetchPhotoUrl(classroomId) {
  if (photoUrlCache.has(classroomId)) return photoUrlCache.get(classroomId);

  const url = `${getApiBase()}/v1/photos/${classroomId}`;
  photoUrlCache.set(classroomId, url);
  return url;
}

// photo URL → CSS color string, or null when it couldn't be read (canvas taint, decode error)
const photoColorCache = new Map();
// photo URL → average relative luminance (0–1, linear light) of the same bottom strip
const photoLumCache = new Map();

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
        done(rgbToTint(r / wSum, g / wSum, b / wSum));
      } catch {
        done(null);
      }
    };
    img.src = url;
  });
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
