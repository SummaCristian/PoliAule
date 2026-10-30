// Blossom petals for the Easter season (components/easter.js): a few dozen
// drifting down over the whole app, tumbling as they go.
//
// Like the snow (components/snowfall.js) it is one canvas over the page (in
// front of its glass, so no blur there ever has to sample it), under the
// header (--fx-z-fall in style.css) and one
// requestAnimationFrame loop. A petal is a small teardrop drawn through a
// transform: it turns, and it flips about its own long axis (its width goes
// through zero and back), which is what makes it read as a petal and not a
// dot. The petals nearer the viewer are bigger, faster and more opaque, and
// a slow wind comes and goes. They don't land on anything.
//
// Everything stops while the tab is hidden and while held (the Campus map
// has its own scenery). With reduced motion nothing falls.

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// How many petals a phone-sized screen gets; bigger screens get more, to a limit
const BASE_COUNT = 46;
const MAX_COUNT = 110;
// Petals fade out over this much at the canvas' bottom edge, which stops
// short of the safe area (see .ea-petals in style.css)
const FADE = 36;

const rand = (a, b) => a + Math.random() * (b - a);

let canvas = null;
let ctx = null;
let w = 0, h = 0, dpr = 1;
let raf = 0;
let last = 0;
let petals = [];
let colors = ['#f6a9c4', '#f9c2d6', '#ee8db3'];
let wind = 0;
let windGoal = 0;
let windEnds = 0;
let running = false;
let resizeObs = null;
const paused = new Set(); // reasons the petals are held (e.g. 'map')

// A petal pointing along +x, a unit long: round at the base, a notch at the
// tip, as a cherry petal has
const PETAL = new Path2D('M0 0C0.1 -0.34 0.62 -0.4 0.86 -0.12L1 0L0.86 0.12C0.62 0.4 0.1 0.34 0 0Z');

function makePetal(p, y) {
  const z = Math.random();               // 0 = far, 1 = near
  p.x = Math.random() * w;
  p.y = y;
  p.z = z;
  p.len = (7 + z * 9) * (0.8 + Math.random() * 0.4);
  p.vy = 22 + z * 40 + Math.random() * 8;
  p.sway = 14 + z * 26;
  p.ph = Math.random() * 6.2832;
  p.rot = Math.random() * 6.2832;
  p.spin = (Math.random() - 0.5) * 2.4;
  p.flip = Math.random() * 6.2832;
  p.flipSpeed = 1.5 + Math.random() * 2.5;
  p.alpha = 0.55 + z * 0.4;
  p.color = Math.floor(Math.random() * colors.length);
  return p;
}

function fit() {
  if (!canvas) return;
  dpr = Math.min(devicePixelRatio || 1, 2);
  w = canvas.clientWidth;
  h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  // A bigger screen gets more petals, to a limit
  const want = Math.min(MAX_COUNT, Math.round(BASE_COUNT * Math.sqrt((w * h) / (390 * 800))));
  while (petals.length < want) petals.push(makePetal({}, Math.random() * h));
  petals.length = want;
}

function readColors() {
  const style = getComputedStyle(document.documentElement);
  colors = ['--ea-petal-1', '--ea-petal-2', '--ea-petal-3'].map((name, i) => style.getPropertyValue(name).trim() || colors[i]);
}

function frame(t) {
  raf = 0;
  if (!running || paused.size || document.hidden) return;
  const dt = Math.min((t - last) / 1000, 0.05);
  last = t;

  // A slow wind, now one way, now the other, now still
  if (t > windEnds) {
    windGoal = Math.random() < 0.3 ? 0 : rand(8, 34) * (Math.random() < 0.5 ? -1 : 1);
    windEnds = t + rand(6, 16) * 1000;
  }
  wind += (windGoal - wind) * (1 - Math.exp(-dt / 2.5));

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const fadeFrom = h - FADE;
  for (const p of petals) {
    p.y += p.vy * dt;
    p.ph += dt * 0.8;
    p.rot += p.spin * dt;
    p.flip += p.flipSpeed * dt;
    p.x += wind * (0.4 + p.z * 0.8) * dt;
    if (p.x < -30) p.x += w + 60; else if (p.x > w + 30) p.x -= w + 60;
    if (p.y - p.len > h) { makePetal(p, -rand(8, 40)); continue; }
    const x = p.x + Math.sin(p.ph) * p.sway;
    // The flip: the petal's width through zero and back, never quite flat
    const across = 0.25 + 0.75 * Math.abs(Math.cos(p.flip));
    const c = Math.cos(p.rot) * p.len, s = Math.sin(p.rot) * p.len;
    ctx.setTransform(dpr * c, dpr * s, -dpr * s * across, dpr * c * across, dpr * x, dpr * p.y);
    ctx.globalAlpha = p.alpha * (p.y > fadeFrom ? Math.max(0, (h - p.y) / FADE) : 1);
    ctx.fillStyle = colors[p.color];
    ctx.fill(PETAL);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
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
const onScheme = () => readColors();

export function startPetals() {
  if (running) return;
  running = true;
  if (reduceMotion()) return;
  canvas = document.createElement('canvas');
  canvas.className = 'ea-petals';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
  readColors();
  fit();
  for (const p of petals) makePetal(p, Math.random() * h);
  windGoal = wind = 0;
  windEnds = 0;
  resizeObs = new ResizeObserver(fit);
  resizeObs.observe(canvas);
  document.addEventListener('visibilitychange', onVisibility);
  scheme.addEventListener('change', onScheme);
  kick();
}

export function stopPetals() {
  running = false;
  cancelAnimationFrame(raf);
  raf = 0;
  resizeObs?.disconnect();
  resizeObs = null;
  document.removeEventListener('visibilitychange', onVisibility);
  scheme.removeEventListener('change', onScheme);
  canvas?.remove();
  canvas = ctx = null;
  petals = [];
  paused.clear();
}

// Holds the petals for as long as any reason is set: the map tab, which has
// its own scenery.
export function holdPetals(reason, held) {
  if (held) paused.add(reason);
  else paused.delete(reason);
  if (canvas) canvas.classList.toggle('ea-petals--held', paused.size > 0);
  if (!paused.size) kick();
}
