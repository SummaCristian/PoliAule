// A small burst of stars when something gets starred, outside the seasons and
// graduation days (each of those has its own burst for the same moment, see
// halloween.js, christmas.js, graduation.js).

import { getAccentColor } from '../utils/star-burst-color.js';

let burst = null;          // { fire, shapes }
let canvas = null;
let lastTap = null;        // { x, y, at }

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const themed = () => !!(document.documentElement.dataset.season || document.documentElement.hasAttribute('data-graduation'));

async function fireStars() {
  if (reduceMotion()) return;
  if (!burst) {
    const { default: confetti } = await import('canvas-confetti');
    canvas = document.createElement('canvas');
    canvas.className = 'star-burst';
    document.body.appendChild(canvas);
    burst = { fire: confetti.create(canvas, { resize: true }), confetti };
  }
  // From the star that was just tapped, or the top of the screen
  const tap = lastTap && performance.now() - lastTap.at < 1500 ? lastTap : { x: innerWidth / 2, y: innerHeight * 0.2 };
  burst.fire({
    particleCount: 14, spread: 70, startVelocity: 18, gravity: 0.9, ticks: 110, scalar: 1.1, flat: true,
    shapes: ['star'],
    colors: ['#facc15', '#fde047', '#fbbf24', getAccentColor()],
    origin: { x: tap.x / canvas.clientWidth, y: Math.min(1, tap.y / canvas.clientHeight) },
    disableForReducedMotion: true,
  });
}

let ready = false;
export function initStarBurst() {
  if (ready) return;
  ready = true;
  window.addEventListener('pointerdown', (e) => {
    lastTap = { x: e.clientX, y: e.clientY, at: performance.now() };
  }, { capture: true, passive: true });
  window.addEventListener('favourites-changed', (e) => {
    if (e.detail?.added != null && !themed()) fireStars();
  });
}
