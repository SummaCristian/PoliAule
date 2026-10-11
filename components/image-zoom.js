// Tap an image to see it larger: a clone grows out of the image's own box
// (FLIP, on a spring) into the middle of the screen, over a dimmed, blurred
// backdrop. A tap anywhere, Escape or Back puts it back where it came from.
//
//   zoomImage(img);   // img: the <img> that was tapped

import { springEasing } from '../utils/spring-easing.js';
import { ownBack } from '../utils/back-stack.js';

const SPRING = springEasing({ stiffness: 260, damping: 28, mass: 1 });
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const MARGIN = 16;

let current = null;

export function zoomImage(img) {
  if (current) return;

  const from = img.getBoundingClientRect();
  if (!from.width || !from.height) return;

  const overlay = document.createElement('div');
  overlay.className = 'img-zoom';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', img.alt);

  const backdrop = document.createElement('div');
  backdrop.className = 'img-zoom-backdrop';

  const clone = document.createElement('img');
  // Transparent images (the changelog's bare figures) get no frame
  clone.className = img.closest('.cl-figure--bare') ? 'img-zoom-img img-zoom-img--bare' : 'img-zoom-img';
  clone.src = img.currentSrc || img.src;
  clone.alt = img.alt;
  clone.draggable = false;

  overlay.append(backdrop, clone);
  document.body.append(overlay);

  // Biggest size that fits the screen, never past the image's own pixels
  const natW = img.naturalWidth || from.width;
  const natH = img.naturalHeight || from.height;
  const scale = Math.min(
    (innerWidth - MARGIN * 2) / natW,
    (innerHeight - MARGIN * 2) / natH,
    Math.max(1, from.width / natW) * 4,
  );
  const w = natW * scale;
  const h = natH * scale;
  clone.style.width = `${w}px`;
  clone.style.height = `${h}px`;
  clone.style.left = `${(innerWidth - w) / 2}px`;
  clone.style.top = `${(innerHeight - h) / 2}px`;

  // The transform that puts the clone exactly over the original
  const over = () => {
    const to = clone.getBoundingClientRect();
    const target = img.isConnected ? img.getBoundingClientRect() : from;
    return `translate(${target.left - to.left}px, ${target.top - to.top}px) scale(${target.width / to.width}, ${target.height / to.height})`;
  };

  const animate = (target, keyframes, opts) => target.animate(keyframes, { fill: 'both', ...opts });
  const motion = reduceMotion.matches
    ? { duration: 150, easing: 'ease-out' }
    : { duration: SPRING.duration, easing: SPRING.easing };

  clone.style.transformOrigin = '0 0';
  img.style.visibility = 'hidden';
  animate(backdrop, [{ opacity: 0 }, { opacity: 1 }], { duration: 250, easing: 'ease-out' });
  const grow = reduceMotion.matches
    ? animate(clone, [{ opacity: 0 }, { opacity: 1 }], motion)
    : animate(clone, [{ transform: over() }, { transform: 'none' }], motion);

  let closing = false;
  const close = ({ instant = false } = {}) => {
    if (closing) return;
    closing = true;
    document.removeEventListener('keydown', onKey, true);
    back.release();
    const done = () => {
      img.style.visibility = '';
      overlay.remove();
      current = null;
    };
    if (instant) return done();
    grow.cancel();
    const shrink = reduceMotion.matches
      ? animate(clone, [{ opacity: 1 }, { opacity: 0 }], { duration: 150 })
      : animate(clone, [{ transform: 'none' }, { transform: over() }], { duration: 300, easing: 'cubic-bezier(0.3, 0, 0.2, 1)' });
    animate(backdrop, [{ opacity: 1 }, { opacity: 0 }], { duration: 250, easing: 'ease-in' });
    shrink.finished.then(done, done);
  };

  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };

  const back = ownBack(({ uaAnimated } = {}) => close({ instant: !!uaAnimated }));
  back.push();
  document.addEventListener('keydown', onKey, true);
  overlay.addEventListener('click', () => close());
  current = overlay;
}
