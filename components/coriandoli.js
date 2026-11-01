// Coriandoli for the Carnevale season (components/carnival.js): little discs
// of coloured paper, the punched-out kind, drifting down over the page, and
// handfuls of them thrown up from where something was just starred.
//
// Not to be mistaken for graduation's confetti (canvas-confetti, in bursts
// from the sides of the screen): these are round, never rectangles; there are
// always some in the air, a slow shower rather than a shot; and each one is a
// two-sided disc that flips as it falls, one side its colour, the other paler,
// so the shower glitters.
//
// One canvas and one requestAnimationFrame loop, like the snow and the petals
// (components/snowfall.js, components/petals.js), in the same band under the
// header (--fx-z-fall in style.css). Everything stops while the tab is hidden.
// With reduced motion nothing falls or flies.

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// How many are in the air on a phone-sized screen; bigger screens get more
const BASE_COUNT = 70;
const MAX_COUNT = 150;
// They fade out over this much at the canvas' bottom edge, which stops short
// of the safe area (see .cv-coriandoli in style.css)
const FADE = 36;

// Each colour, and the paler back of its paper
const PAPER = [
  ['#e63946', '#f7a3aa'], ['#ffb703', '#ffe08a'], ['#06b6a4', '#9be8de'],
  ['#3a86ff', '#a9c9ff'], ['#8338ec', '#c9a8f7'], ['#ff5fa2', '#ffc0dc'], ['#6cc644', '#c4ecaf'],
];

const rand = (a, b) => a + Math.random() * (b - a);

let canvas = null;
let ctx = null;
let w = 0, h = 0, dpr = 1;
let raf = 0;
let last = 0;
let drifting = [];   // the shower
let thrown = [];     // a handful in flight
let running = false;
let resizeObs = null;

function makeDisc(p, y) {
  const z = Math.random();               // 0 = far, 1 = near
  p.x = Math.random() * w;
  p.y = y;
  p.r = 1.7 + z * 2.6;
  p.vy = 26 + z * 40 + Math.random() * 8;
  p.sway = 8 + z * 16;
  p.ph = Math.random() * 6.2832;
  p.flip = Math.random() * 6.2832;
  p.flipSpeed = 2.5 + Math.random() * 3;
  p.paper = Math.floor(Math.random() * PAPER.length);
  p.alpha = 0.7 + z * 0.3;
  return p;
}

function fit() {
  if (!canvas) return;
  dpr = Math.min(devicePixelRatio || 1, 2);
  w = canvas.clientWidth;
  h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const want = Math.min(MAX_COUNT, Math.round(BASE_COUNT * Math.sqrt((w * h) / (390 * 800))));
  while (drifting.length < want) drifting.push(makeDisc({}, Math.random() * h));
  drifting.length = want;
}

// One disc: it turns about its own diameter, so its height goes through zero
// and back (the paper's back shows on the far side of the turn)
function drawDisc(x, y, r, flip, paper, alpha) {
  const c = Math.cos(flip);
  const ry = Math.max(0.35, Math.abs(c)) * r;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = PAPER[paper][c < 0 ? 1 : 0];
  ctx.beginPath();
  ctx.ellipse(x, y, r, ry, Math.sin(flip * 0.5) * 0.6, 0, 6.2832);
  ctx.fill();
}

function frame(t) {
  raf = 0;
  if (!running || document.hidden) return;
  const dt = Math.min((t - last) / 1000, 0.05);
  last = t;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const fadeFrom = h - FADE;

  for (const p of drifting) {
    p.y += p.vy * dt;
    p.ph += dt * 0.9;
    p.flip += p.flipSpeed * dt;
    if (p.y - p.r > h) { makeDisc(p, -rand(4, 40)); continue; }
    const x = p.x + Math.sin(p.ph) * p.sway;
    drawDisc(x, p.y, p.r, p.flip, p.paper, p.alpha * (p.y > fadeFrom ? Math.max(0, (h - p.y) / FADE) : 1));
  }

  let kept = 0;
  for (const p of thrown) {
    p.age += dt;
    if (p.age > p.life) continue;
    p.vy += 560 * dt;
    p.vx *= 1 - 1.4 * dt;
    p.vy *= 1 - 0.6 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.flip += p.flipSpeed * dt;
    thrown[kept++] = p;
    const left = p.life - p.age;
    drawDisc(p.x, p.y, p.r, p.flip, p.paper, left < 0.4 ? left / 0.4 : 1);
  }
  thrown.length = kept;

  ctx.globalAlpha = 1;
  raf = requestAnimationFrame(frame);
}

function kick() {
  if (raf || !running || document.hidden || reduceMotion()) return;
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

export function startCoriandoli() {
  if (running) return;
  running = true;
  if (reduceMotion()) return;
  canvas = document.createElement('canvas');
  canvas.className = 'cv-coriandoli';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
  fit();
  for (const p of drifting) makeDisc(p, Math.random() * h);
  resizeObs = new ResizeObserver(fit);
  resizeObs.observe(canvas);
  document.addEventListener('visibilitychange', onVisibility);
  kick();
}

export function stopCoriandoli() {
  running = false;
  cancelAnimationFrame(raf);
  raf = 0;
  resizeObs?.disconnect();
  resizeObs = null;
  document.removeEventListener('visibilitychange', onVisibility);
  canvas?.remove();
  canvas = ctx = null;
  drifting = [];
  thrown = [];
}

// A handful thrown up and out from (x, y), in viewport pixels (down and out
// from a star near the top of the screen, which has no room above it), which
// then fall like the rest
export function throwCoriandoli(x, y, { count = 34, down = false } = {}) {
  if (!running || !canvas || reduceMotion()) return;
  const rect = canvas.getBoundingClientRect();
  for (let i = 0; i < count; i++) {
    const a = (down ? Math.PI / 2 : -Math.PI / 2) + (Math.random() - 0.5) * 2.2;
    const speed = rand(140, 420);
    thrown.push({
      x: x - rect.left, y: y - rect.top,
      vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      r: rand(2, 4.2), flip: Math.random() * 6.2832, flipSpeed: rand(5, 11),
      paper: Math.floor(Math.random() * PAPER.length), age: 0, life: rand(1.5, 2.6),
    });
  }
  kick();
}
