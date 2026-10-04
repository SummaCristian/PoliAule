// Cracked glass for Vitrium's glass surfaces: a crack generated for one
// element, spreading from a point of impact as jagged branches (some
// splitting off), with a couple of rings of short broken cracks and a chip of
// missing glass where it was hit. Every branch stops at the element's real
// rounded outline. Drawn as an SVG inside the element: each line twice, a
// bright one for the broken edge catching the light and a soft dark one under
// it (style.css, .glass-crack).
//
//   crackStatic(el, seed)        already cracked, at a spot picked from seed
//   attachTapCrack(el, opts)     tap it quickly and it cracks: the first two
//                                taps do nothing, the third is the impact
//                                (where it was tapped) and the fourth and
//                                fifth spread that same crack further. Ten
//                                seconds after the last tap it heals. Taps
//                                on anything interactive inside don't count,
//                                so only use it on surfaces that do nothing
//                                when tapped.
//
// A crack is built once, whole, and only revealed further as it grows, so
// its branches never move from one tap to the next.

const BRANCHES = 6;
const REACH = 0.5;        // how far the branches run, as a share of the element's size
const TAP_WINDOW = 700;   // ms between taps that still count as one series
const HEAL_AFTER = 10000;

const INTERACTIVE = 'button, a, input, select, textarea, label, [role="button"], [tabindex]';

function rng(seed) {
  let s = seed || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function radiusOf(el) {
  const cs = getComputedStyle(el);
  return Math.min(parseFloat(cs.borderTopLeftRadius) || 0, el.clientHeight / 2, el.clientWidth / 2);
}

// The whole crack inside a w×h box rounded with radius R, from (ox, oy).
// Each point carries its distance from the impact along the crack, which is
// what renderCrack() reveals by.
function buildCrack(w, h, R, seed, ox, oy) {
  const r = rng(seed);
  const inset = 1.5;
  const inside = (x, y) => {
    if (x < inset || y < inset || x > w - inset || y > h - inset) return false;
    const rr = Math.max(0, R - inset);
    const cx = Math.min(Math.max(x, rr + inset), w - rr - inset);
    const cy = Math.min(Math.max(y, rr + inset), h - rr - inset);
    return Math.hypot(x - cx, y - cy) <= rr;
  };
  // Never shorter than a 110px element's, so small surfaces crack all the way across
  const maxLen = Math.max(w, h, 110) * REACH;
  const lines = [];

  function grow(x, y, ang, len, depth, dist0) {
    const pts = [[x, y, dist0]];
    let travelled = 0;
    while (travelled < len) {
      const step = 3 + r() * 6;
      ang += (r() - 0.5) * 0.65;
      const nx = x + Math.cos(ang) * step, ny = y + Math.sin(ang) * step;
      if (!inside(nx, ny)) {
        // Run up to the outline and stop there
        let lo = 0, hi = 1;
        for (let k = 0; k < 8; k++) {
          const m = (lo + hi) / 2;
          if (inside(x + Math.cos(ang) * step * m, y + Math.sin(ang) * step * m)) lo = m;
          else hi = m;
        }
        pts.push([x + Math.cos(ang) * step * lo, y + Math.sin(ang) * step * lo, dist0 + travelled + step * lo]);
        break;
      }
      x = nx; y = ny; travelled += step;
      pts.push([x, y, dist0 + travelled]);
      if (depth < 2 && r() < 0.16) {
        grow(x, y, ang + (r() < 0.5 ? -1 : 1) * (0.45 + r() * 0.6), (len - travelled) * (0.4 + r() * 0.3), depth + 1, dist0 + travelled);
      }
    }
    if (pts.length > 1) lines.push(pts);
  }

  const spokes = [];
  for (let i = 0; i < BRANCHES; i++) {
    const ang = (i / BRANCHES) * Math.PI * 2 + (r() - 0.5) * (Math.PI * 2 / BRANCHES) * 0.8;
    spokes.push(ang);
    grow(ox, oy, ang, maxLen * (0.45 + r() * 0.65), 0, 0);
  }
  // Rings of short, broken cracks around the impact, the inner one first
  const rings = [];
  for (let k = 1; k <= 2; k++) {
    const rad = 4 + k * (5 + r() * 3);
    for (let i = 0; i < BRANCHES; i++) {
      if (r() < 0.35) continue;
      const a1 = spokes[i];
      const a2 = spokes[(i + 1) % BRANCHES] + (i + 1 === BRANCHES ? Math.PI * 2 : 0);
      const pts = [];
      for (let s = 0; s <= 3; s++) {
        const a = a1 + (a2 - a1) * (s / 3);
        const rad2 = rad * (0.85 + r() * 0.3);
        const x = ox + Math.cos(a) * rad2, y = oy + Math.sin(a) * rad2;
        if (!inside(x, y)) break;
        pts.push([x, y]);
      }
      if (pts.length > 1) rings.push({ pts, from: k === 1 ? 0.3 : 0.6 });
    }
  }
  const chip = [];
  for (let i = 0; i < 6; i++) chip.push([(i / 6) * Math.PI * 2 + r() * 0.6, 0.6 + r() * 0.7]);
  return { lines, rings, chip, ox, oy, maxLen };
}

// The crack's paths as far as `level` (0..1) has spread it.
function renderCrack(crack, level) {
  const f = (v) => v.toFixed(1);
  // Eased, so the first blow leaves a small star and the later ones carry it out
  const reach = crack.maxLen * 1.1 * Math.pow(level, 1.7);
  let d = '';
  for (const pts of crack.lines) {
    if (pts[0][2] >= reach) continue;          // a side branch the crack hasn't reached yet
    let seg = `M${f(pts[0][0])} ${f(pts[0][1])}`;
    for (let i = 1; i < pts.length; i++) {
      const [x, y, dist] = pts[i];
      if (dist <= reach) { seg += `L${f(x)} ${f(y)}`; continue; }
      // Cut the last stretch where the crack has got to
      const [px, py, pd] = pts[i - 1];
      const t = (reach - pd) / (dist - pd);
      seg += `L${f(px + (x - px) * t)} ${f(py + (y - py) * t)}`;
      break;
    }
    d += seg;
  }
  for (const { pts, from } of crack.rings) {
    if (level >= from) d += 'M' + pts.map(([x, y]) => `${f(x)} ${f(y)}`).join('L');
  }
  let chip = '';
  if (level > 0.3) {
    const cr = 1.6 + 2.2 * level;
    chip = 'M' + crack.chip.map(([a, k]) => `${f(crack.ox + Math.cos(a) * cr * k)} ${f(crack.oy + Math.sin(a) * cr * k)}`).join('L') + 'Z';
  }
  return { d, chip };
}

function draw(el, crack, level) {
  let svg = el.querySelector(':scope > .glass-crack');
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'glass-crack');
    svg.setAttribute('aria-hidden', 'true');
    el.appendChild(svg);
  }
  svg.classList.remove('glass-crack--healing');
  svg.setAttribute('viewBox', `0 0 ${el.clientWidth} ${el.clientHeight}`);
  const { d, chip } = renderCrack(crack, level);
  svg.innerHTML = `<g transform="translate(.5 .7)"><path class="glass-crack__shade" d="${d}"/></g>` +
    (chip ? `<path class="glass-crack__chip" d="${chip}"/>` : '') +
    `<path class="glass-crack__light" d="${d}"/>`;
}

export function crackStatic(el, seed) {
  const w = el.clientWidth, h = el.clientHeight;
  if (!w || !h) return;
  const ox = w * (0.15 + ((seed >>> 3) % 70) / 100);
  const oy = h * (0.3 + ((seed >>> 9) % 40) / 100);
  draw(el, buildCrack(w, h, radiusOf(el), seed, ox, oy), 1);
}

// `signal`: an AbortSignal that removes the listener (and stops any pending heal).
export function attachTapCrack(el, { seed = 1, signal } = {}) {
  let count = 0, last = 0, level = 0, crack = null, heal = 0, fade = 0;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // A tap meant for a control inside the surface isn't a blow to its glass
    const inner = e.target.closest?.(INTERACTIVE);
    if (inner && inner !== el && el.contains(inner)) return;
    const now = performance.now();
    count = now - last < TAP_WINDOW ? count + 1 : 1;
    last = now;
    if (count < 3 && !level) return;
    if (!level) {
      // The first blow decides the whole crack; later ones only spread it.
      // The surface may be scaled by its press effect, so map the tap back
      // to its unscaled size.
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (el.clientWidth / rect.width);
      const y = (e.clientY - rect.top) * (el.clientHeight / rect.height);
      crack = buildCrack(el.clientWidth, el.clientHeight, radiusOf(el), (seed + Math.round(now)) >>> 0, x, y);
    }
    level = Math.min(1, level + 0.34);
    clearTimeout(heal);
    clearTimeout(fade);
    draw(el, crack, level);
    heal = setTimeout(() => {
      el.querySelector(':scope > .glass-crack')?.classList.add('glass-crack--healing');
      fade = setTimeout(() => {
        el.querySelector(':scope > .glass-crack')?.remove();
        level = 0; count = 0; crack = null;
      }, 1000);
    }, HEAL_AFTER);
  }, { signal });
  signal?.addEventListener('abort', () => { clearTimeout(heal); clearTimeout(fade); });
}

// Removes every crack under `root`.
export function clearCracks(root = document) {
  root.querySelectorAll('.glass-crack').forEach((svg) => svg.remove());
}
