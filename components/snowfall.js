// Snow for the Christmas season (components/christmas.js): flakes falling
// over the whole app, and snow piling up live on the top edge of the elements
// they land on.
//
// The flakes are one canvas over everything (in front of the glass, so no
// blur ever has to sample it) and one requestAnimationFrame loop: soft dots on
// a continuous range of depths, the near ones bigger, faster and brighter,
// each swaying on its own sine. The amount of snow wanders between calm
// spells, the usual snowfall and short, windy flurries well above it.
//
// A pile is a small SVG inside its element, rising above the element's top
// edge and hugging its rounded corners, so it scrolls and scales with it for
// free. Near flakes that cross a registered element's top edge may land there
// (if nothing else covers that spot), each adding a little mound to the
// pile's height map, up to a cap that thins out where the corners get steep.
// Pressing the element shakes most of it off, in a puff that falls through
// the canvas.
//
// Everything stops while the tab is hidden and while paused (the Campus map
// has its own snow). With reduced motion nothing falls and the piles are
// simply there, already settled.

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Flakes ────────────────────────────────────────────────────────────────

// The look tuned in the snow test: 150 flakes at 1x speed, 0.4x size
const BASE_COUNT = 150;
const SIZE = 0.4;
const MAX_FLAKES = 560;
// Flakes fade out over this much at the canvas' bottom edge, which stops
// short of the safe area (see .xm-snow in style.css)
const FADE = 36;
// Three alpha bands, each drawn as one path
const BANDS = [0.5, 0.7, 0.9];

// How much snow there is, wandering from one spell to the next. count: flakes
// on screen; wind: px/s sideways (signed at random); speed: fall speed factor.
const SPELLS = {
  calm: { weight: 25, count: [70, 110], wind: [0, 6], speed: [0.85, 0.95], secs: [30, 70] },
  normal: { weight: 45, count: [140, 165], wind: [0, 10], speed: [1, 1], secs: [40, 90] },
  heavy: { weight: 18, count: [220, 290], wind: [8, 22], speed: [1.05, 1.15], secs: [20, 40] },
  flurry: { weight: 12, count: [400, 540], wind: [28, 60], speed: [1.3, 1.45], secs: [8, 18] },
};

const rand = (a, b) => a + Math.random() * (b - a);

let canvas = null;
let ctx = null;
let w = 0, h = 0, dpr = 1;
let raf = 0;
let last = 0;
let color = '#fff';
let flakes = [];
let active = 0;          // flakes[0..active) are falling
let paused = new Set();  // reasons the snow is held (e.g. 'map')
let running = false;
let resizeObs = null;

// The current spell, and the values easing toward it
const now = { count: BASE_COUNT, wind: 0, speed: 1 };
const goal = { count: BASE_COUNT, wind: 0, speed: 1 };
let spellEnds = 0;

function pickSpell(t, first = false) {
  let spell = SPELLS.normal;
  if (!first) {
    const total = Object.values(SPELLS).reduce((s, x) => s + x.weight, 0);
    let roll = Math.random() * total;
    for (const s of Object.values(SPELLS)) {
      roll -= s.weight;
      if (roll <= 0) { spell = s; break; }
    }
  }
  goal.count = Math.round(rand(...spell.count));
  goal.wind = rand(...spell.wind) * (Math.random() < 0.5 ? -1 : 1);
  goal.speed = rand(...spell.speed);
  spellEnds = t + rand(...spell.secs) * 1000;
}

function makeFlake(f, y) {
  const z = Math.random();               // 0 = far, 1 = near
  f.x = Math.random() * w;
  f.y = y;
  f.z = z;
  f.r = (1 + z * 3) * SIZE;
  f.vy = 18 + z * 42;
  f.sway = 10 + z * 20;
  f.ph = Math.random() * 6.2832;
  f.band = z < 0.34 ? 0 : z < 0.67 ? 1 : 2;
  f.dx = 0;                              // swing of the sway, last frame
  return f;
}

// Puffs shaken off a pile: fall with gravity, then go
let puffs = [];

function fit() {
  if (!canvas) return;
  dpr = Math.min(devicePixelRatio || 1, 2);
  w = canvas.clientWidth;
  h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function readColor() {
  color = getComputedStyle(document.documentElement).getPropertyValue('--xm-flake').trim() || '#fff';
}

function frame(t) {
  raf = 0;
  if (!running || paused.size || document.hidden) return;
  const dt = Math.min((t - last) / 1000, 0.05);
  last = t;

  if (t > spellEnds) pickSpell(t);
  // Eased toward the spell over a few seconds
  const a = 1 - Math.exp(-dt / 3);
  now.count += (goal.count - now.count) * a;
  now.wind += (goal.wind - now.wind) * (1 - Math.exp(-dt / 2.5));
  now.speed += (goal.speed - now.speed) * a;

  // More flakes: wake some up just above the top, spread out so the extra
  // snow drifts in rather than arriving as a line
  const want = Math.min(MAX_FLAKES, Math.round(now.count));
  while (active < want) {
    makeFlake(flakes[active], -rand(4, h * 0.3));
    active++;
  }

  const edges = pileEdges();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = color;
  const fadeFrom = h - FADE;
  const faded = [];

  for (let band = 0; band < 3; band++) {
    ctx.globalAlpha = BANDS[band];
    ctx.beginPath();
    for (let i = 0; i < active; i++) {
      const f = flakes[i];
      if (f.band !== band) continue;
      const y0 = f.y;
      f.y += f.vy * now.speed * dt;
      f.ph += dt * 0.9;
      f.x += now.wind * (0.4 + f.z * 0.8) * dt;
      if (f.x < -20) f.x += w + 40; else if (f.x > w + 20) f.x -= w + 40;
      const x = f.x + Math.sin(f.ph) * f.sway;
      // Landed on a pile, or gone off the bottom: back to the top, or to
      // sleep if there's more snow than wanted
      const landed = f.z > 0.45 && edges.length && tryLand(edges, x, y0, f.y, f.r);
      if (landed || f.y - f.r > h) {
        if (active > want) {
          active--;
          flakes[i] = flakes[active];
          flakes[active] = f;
          i--;
        } else {
          makeFlake(f, -rand(4, 30));
        }
        continue;
      }
      if (f.y > fadeFrom) { faded.push(f, x); continue; }
      ctx.moveTo(x + f.r, f.y);
      ctx.arc(x, f.y, f.r, 0, 6.2832);
    }
    ctx.fill();
  }
  // Near the bottom each flake fades on its own
  for (let i = 0; i < faded.length; i += 2) {
    const f = faded[i], x = faded[i + 1];
    ctx.globalAlpha = BANDS[f.band] * Math.max(0, (h - f.y) / FADE);
    ctx.beginPath();
    ctx.arc(x, f.y, f.r, 0, 6.2832);
    ctx.fill();
  }

  if (puffs.length) {
    ctx.globalAlpha = 0.95;
    ctx.beginPath();
    let kept = 0;
    for (const p of puffs) {
      p.vy += 900 * dt;
      p.vx *= 1 - 1.5 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.y - p.r > h) continue;
      puffs[kept++] = p;
      ctx.moveTo(p.x + p.r, p.y);
      ctx.arc(p.x, p.y, p.r, 0, 6.2832);
    }
    puffs.length = kept;
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  flushPiles(t);
  raf = requestAnimationFrame(frame);
}

function kick() {
  if (raf || !running || paused.size || document.hidden || reduceMotion()) return;
  last = performance.now();
  raf = requestAnimationFrame(frame);
}

const onVisibility = () => {
  if (document.hidden) {
    cancelAnimationFrame(raf);
    raf = 0;
  } else {
    kick();
  }
};

const scheme = matchMedia('(prefers-color-scheme: dark)');
const onScheme = () => readColor();

export function startSnowfall() {
  if (running) return;
  running = true;
  piles.forEach((p) => p.attach());
  if (reduceMotion()) return;
  canvas = document.createElement('canvas');
  canvas.className = 'xm-snow';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
  fit();
  readColor();
  flakes = Array.from({ length: MAX_FLAKES }, () => ({}));
  // Already snowing when the app opens
  active = BASE_COUNT;
  for (let i = 0; i < active; i++) makeFlake(flakes[i], Math.random() * h);
  now.count = goal.count = BASE_COUNT;
  pickSpell(performance.now(), true);
  resizeObs = new ResizeObserver(fit);
  resizeObs.observe(canvas);
  document.addEventListener('visibilitychange', onVisibility);
  scheme.addEventListener('change', onScheme);
  kick();
}

export function stopSnowfall() {
  running = false;
  cancelAnimationFrame(raf);
  raf = 0;
  resizeObs?.disconnect();
  resizeObs = null;
  document.removeEventListener('visibilitychange', onVisibility);
  scheme.removeEventListener('change', onScheme);
  canvas?.remove();
  canvas = ctx = null;
  flakes = [];
  puffs = [];
  active = 0;
  for (const pile of piles.values()) pile.detach();
  piles.clear();
  onScreen.clear();
  seen.disconnect();
}

// Holds the snow (and leaves the piles as they are) for as long as any
// reason is set: the map tab, which has its own.
export function holdSnowfall(reason, held) {
  if (held) paused.add(reason);
  else paused.delete(reason);
  if (canvas) canvas.classList.toggle('xm-snow--held', paused.size > 0);
  if (!paused.size) kick();
}

// ── Piles ─────────────────────────────────────────────────────────────────

const BIN = 3;           // px of width per height-map sample
const SETTLE_MS = 180;   // piles redrawn at most this often

const piles = new Map();         // element -> Pile
const memory = new Map();        // key -> heights, so a rebuilt card keeps its snow
const onScreen = new Set();
const seen = new IntersectionObserver((entries) => {
  for (const { target, isIntersecting } of entries) {
    const pile = piles.get(target);
    if (!pile) continue;
    if (isIntersecting && target.isConnected) {
      onScreen.add(pile);
      // No loop with reduced motion: a settled pile is drawn as it comes on
      // screen
      if (running && reduceMotion() && !pile.box) requestAnimationFrame(() => {
        if (pile.measure(pile.el.getBoundingClientRect()) && pile.dirty) pile.draw();
      });
    } else {
      onScreen.delete(pile);
    }
    if (!target.isConnected) {
      pile.detach();
      piles.delete(target);
      seen.unobserve(target);
    }
  }
});

class Pile {
  constructor(el, { key = null, radius = null, maxHeight = null, chance = 0.5, onFirst = null } = {}) {
    this.el = el;
    this.key = key;
    this.radiusOpt = radius;
    this.maxOpt = maxHeight;
    this.chance = chance;
    this.onFirst = onFirst;
    this.w = 0;
    this.R = 0;
    this.max = 0;
    this.heights = key && memory.get(key) || null;
    this.box = null;
    this.dirty = false;
    this.drawnAt = 0;
    this.hasSnow = false;
    this.rect = null;
    this.onDown = () => this.shake();
  }

  // Measures the element, and (re)samples the height map to its width
  measure(rect) {
    const width = Math.round(rect.width);
    if (!width) return false;
    if (width === this.w && this.heights) return true;
    const cs = getComputedStyle(this.el);
    const R = this.radiusOpt ?? Math.min(parseFloat(cs.borderTopLeftRadius) || 0, rect.height / 2, width / 2);
    this.R = R;
    this.max = this.maxOpt ?? Math.max(3, Math.min(9, width * 0.045));
    const n = Math.max(2, Math.ceil(width / BIN) + 1);
    const old = this.heights;
    const fresh = new Float32Array(n);
    if (old && old.length > 1) {
      for (let i = 0; i < n; i++) fresh[i] = old[Math.min(old.length - 1, Math.round(i * (old.length - 1) / (n - 1)))];
    }
    this.heights = fresh;
    this.w = width;
    this.caps = new Float32Array(n);
    for (let i = 0; i < n; i++) this.caps[i] = this.max * this.capAt(Math.min(i * BIN, width));
    if (this.key) memory.set(this.key, fresh);
    if (reduceMotion() && !this.hasSnow) this.settle();
    this.dirty = true;
    return true;
  }

  // How much of the cap a spot on the top edge can hold: all of it on the
  // flat part, less and less down the corners as they steepen
  capAt(x) {
    const R = this.R, d = Math.min(x, this.w - x);
    if (d < 0.5) return 0;
    if (d >= R) return 1;
    const u = R - d;
    const slope = u / Math.sqrt(Math.max(1e-3, R * R - u * u));
    // Squared, so on a round button the snow sits as a dome, not a peak
    return Math.max(0, Math.min(1, 1.05 - (slope * 0.9) ** 2));
  }

  // How far below the top edge the outline is at x (the rounded corners)
  dropAt(x) {
    const R = this.R, d = Math.min(x, this.w - x);
    if (d >= R) return 0;
    const u = R - d;
    return R - Math.sqrt(Math.max(0, R * R - u * u));
  }

  // Reduced motion: a settled pile from the start, wavy along its length
  settle() {
    const seed = this.key ? [...this.key].reduce((s, c) => s + c.charCodeAt(0), 0) : 1;
    for (let i = 0; i < this.heights.length; i++) {
      const wave = 0.75 + 0.15 * Math.sin(i * 0.31 + seed) + 0.1 * Math.sin(i * 0.83 + seed * 2);
      this.heights[i] = this.caps[i] * wave;
    }
    this.markSnow();
  }

  attach() {
    this.el.addEventListener('pointerdown', this.onDown, { passive: true });
    if (this.heights && this.heights.some((v) => v > 0.2)) this.markSnow();
  }

  detach() {
    this.el.removeEventListener('pointerdown', this.onDown);
    this.box?.remove();
    this.box = null;
    this.el.classList.remove('xm-piled');
  }

  markSnow() {
    if (this.hasSnow) return;
    this.hasSnow = true;
    this.el.classList.add('xm-piled');
    this.onFirst?.(this.el);
  }

  land(localX, r) {
    if (!this.heights) return;
    const c = localX / BIN;
    const n = this.heights.length;
    // A soft mound about the flake's spot; bigger flakes add more
    const amp = 0.55 + r * 0.6;
    const from = Math.max(0, Math.floor(c - 4)), to = Math.min(n - 1, Math.ceil(c + 4));
    for (let i = from; i <= to; i++) {
      const k = (i - c) / 1.7;
      this.heights[i] = Math.min(this.caps[i], this.heights[i] + amp * Math.exp(-k * k));
    }
    this.dirty = true;
    this.markSnow();
  }

  // Pressed: most of the snow falls off, as a puff through the canvas
  shake() {
    if (!this.heights || !this.hasSnow) return;
    const rect = this.el.getBoundingClientRect();
    if (canvas && !reduceMotion()) {
      for (let i = 0; i < this.heights.length; i += 2) {
        const hh = this.heights[i];
        if (hh < 0.8) continue;
        const x = rect.left + i * BIN;
        for (let k = 0; k < Math.min(3, Math.ceil(hh / 2.5)); k++) {
          puffs.push({ x: x + rand(-1.5, 1.5), y: rect.top + this.dropAt(i * BIN) - rand(0, hh), vx: rand(-55, 55), vy: rand(-90, 10), r: rand(0.7, 1.6) });
        }
      }
    }
    for (let i = 0; i < this.heights.length; i++) this.heights[i] *= 0.15;
    this.dirty = true;
    this.draw();
    kick();
  }

  draw() {
    this.dirty = false;
    const H = this.max + 2;
    const R = this.R;
    if (!this.box) {
      this.box = document.createElement('div');
      this.box.className = 'xm-pile';
      this.box.setAttribute('aria-hidden', 'true');
      this.box.innerHTML = '<svg preserveAspectRatio="none"><path class="xm-pile-shade"/><path class="xm-pile-snow"/><path class="xm-pile-edge"/></svg>';
      this.el.appendChild(this.box);
    }
    // The box rises H above the top edge and reaches R below it, over the
    // corners
    const total = H + R + 1;
    this.box.style.height = `${total}px`;
    this.box.style.top = `${-H}px`;
    const svg = this.box.firstChild;
    svg.setAttribute('viewBox', `0 0 ${this.w} ${total.toFixed(1)}`);
    // Smooths the mounds into each other a little every time
    const hs = this.heights, n = hs.length;
    for (let i = 1; i < n - 1; i++) hs[i] = Math.min(this.caps[i], hs[i] * 0.6 + (hs[i - 1] + hs[i + 1]) * 0.2);
    const f = (v) => v.toFixed(1);
    let top = '', bottom = '', edge = '';
    let inSnow = false;
    for (let i = 0; i < n; i++) {
      const x = Math.min(i * BIN, this.w);
      const base = H + this.dropAt(x);
      const y = `${f(x)} ${f(base - Math.max(0, hs[i]))}`;
      top += `${i ? 'L' : 'M'}${y}`;
      // The outline runs only where there's snow to outline
      const snowy = hs[i] > 0.4;
      if (snowy) edge += `${inSnow ? 'L' : 'M'}${y}`;
      inSnow = snowy;
    }
    // Back along the outline itself, a hair inside it so no gap shows
    for (let i = n - 1; i >= 0; i--) {
      const x = Math.min(i * BIN, this.w);
      bottom += `L${f(x)} ${f(H + this.dropAt(x) + 0.6)}`;
    }
    const d = `${top}${bottom}Z`;
    svg.children[0].setAttribute('d', d);
    svg.children[1].setAttribute('d', d);
    // The outline only along the snow's top, not down the element's sides
    svg.children[2].setAttribute('d', edge);
  }
}

// Snow can pile up on `el`'s top edge. `key`: keeps the snow when the element
// is rebuilt (a card re-rendered); `radius`: its corner radius, if not its
// border-radius; `maxHeight`: the deepest the snow gets; `chance`: how likely
// a near flake crossing the edge lands; `onFirst(el)`: when the first snow
// lands.
export function addPile(el, opts) {
  if (!el || piles.has(el)) return;
  const pile = new Pile(el, opts);
  piles.set(el, pile);
  seen.observe(el);
  if (running) pile.attach();
}

export function dropPile(el) {
  const pile = piles.get(el);
  if (!pile) return;
  pile.detach();
  piles.delete(el);
  onScreen.delete(pile);
  seen.unobserve(el);
}

// The top edges flakes can land on this frame, in viewport coordinates
function pileEdges() {
  const edges = [];
  for (const pile of onScreen) {
    const r = pile.el.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > h) continue;
    if (!pile.measure(r)) continue;
    pile.rect = r;
    edges.push(pile);
  }
  return edges;
}

function tryLand(edges, x, y0, y1, r) {
  for (const pile of edges) {
    const { top, left, right } = pile.rect;
    if (y0 > top || y1 < top - 1) continue;
    if (x < left + 1 || x > right - 1) continue;
    if (Math.random() > pile.chance) return false;
    // Only where the edge is really on top: not under the header, the tab
    // bar, a sheet or a page opened over it
    const hit = document.elementFromPoint(x, top + 2);
    if (!hit || !pile.el.contains(hit)) return false;
    const local = x - left;
    if (pile.caps[Math.round(local / BIN)] <= 0) return false;
    pile.land(local, r);
    return true;
  }
  return false;
}

function flushPiles(t) {
  for (const pile of onScreen) {
    if (!pile.dirty || !pile.heights) continue;
    if (t - pile.drawnAt < SETTLE_MS) continue;
    pile.drawnAt = t;
    pile.draw();
  }
}
