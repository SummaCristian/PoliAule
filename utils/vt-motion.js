// Geometry for the card <-> detail-page zoom (SwiftUI `.zoom`-style), shared by
// classroom-detail.js and the @keyframes in classroom-detail.css.
//
// The page's own snapshot is the root one, which is always exactly the size of
// the viewport — so "grow the page out of the card" is a plain transform: scale
// the whole screen down until its width matches the card's, put its top left
// corner on the card's, and clip away everything below the card's bottom edge.
// The page's hero photo is full-bleed and starts at the very top of the page,
// which is what makes that single transform land the photo on the card.
//
// The motion itself is pure CSS (--vt-spring); all this has to do is write the
// starting geometry into custom properties for the keyframes to read.
//
// They go on <html>, registered as not inherited (see classroom-detail.css,
// which hands them down the transition's pseudo-elements): inherited, every
// change to one restyled every element in the page (~20ms on an older phone),
// in the frame the transition captures the old state in.
const VARS = ['--zoom-x', '--zoom-y', '--zoom-scale', '--zoom-clip', '--zoom-radius',
  '--zoom-card-radius', '--arc-x', '--arc-y'];

function writeVars(vars) {
  const style = document.documentElement.style;
  for (const v of VARS) {
    if (vars) style.setProperty(v, vars[v]);
    else style.removeProperty(v);
  }
}

// Peak of each half of the arc, as a fraction of that axis's own distance: the
// horizontal running ahead of the spring, the vertical dragging behind it.
// These are the peaks of detail-zoom-arc's two tracks in classroom-detail.css —
// change one and the other has to be re-derived from the same spring.
const ARC_LEAD = 0.163;  // horizontal, ahead
const ARC_DRAG = 0.148;  // vertical, behind

/**
 * Writes the zoom's starting geometry for the transition's pseudo-elements.
 *
 * @param rect   the card's viewport rect (from getBoundingClientRect, so a
 *               pressed card's scale is already baked in — the zoom then
 *               continues out of the pressed state instead of jumping)
 * @param radius the card's corner radius, in px
 * @returns      false when the rect is unusable (zero-sized, off-screen), so
 *               the caller can fall back to a plain cross-fade
 */
export function setZoomOrigin(rect, radius = 16) {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  if (!rect || rect.width < 1 || rect.height < 1 || !vw || !vh) return false;

  // One scale for both axes, taken from the width: the hero photo is as wide as
  // the page, so matching widths is what aligns it with the card.
  const scale = rect.width / vw;
  writeVars({
    '--zoom-x': `${rect.left}px`,
    '--zoom-y': `${rect.top}px`,
    '--zoom-scale': `${scale}`,
    // The snapshot's height and corner radius are in its own coordinates, i.e.
    // before the scale, so the card's height has to be divided back out. Its
    // width stays whole at every point of the animation (the scale comes from
    // the width), which is why only the bottom edge is variable.
    '--zoom-clip': `${Math.max(0, vh - rect.height / scale)}px`,
    '--zoom-radius': `${radius / scale}px`,
    // The same radius in screen px, for the hero's own corners to morph along
    // with the page's clip instead of guessing at the card's shape.
    '--zoom-card-radius': `${radius}px`,
    // The arc's two peak offsets. The page travels from the card's top left
    // corner to the viewport's, so its distance is just the card's offset,
    // negated: x runs ahead of that (further left, sooner), y falls behind it
    // (still low, later) — which is what bows the path downwards rather than
    // over the top. Both are written the same way for open and close: the
    // close uses its own keyframes to retrace this same curve, rather than
    // mirroring it, so the two directions follow one path.
    '--arc-x': `${-ARC_LEAD * rect.left}px`,
    '--arc-y': `${ARC_DRAG * rect.top}px`,
  });
  return true;
}

// The splash logo's flight (splash-icon): each axis on its own spring, so the
// path bows by itself (x quicker, running ahead; y slower, dragging behind)
// and the logo never swings past its target the way an added arc offset can.
// The size is a little less damped than the travel, so it lands with a small
// settle into the header instead of a hard stop. [response s, damping ratio]
const FLIGHT_X = [0.3, 0.95];
const FLIGHT_Y = [0.46, 0.94];
const FLIGHT_SIZE = [0.38, 0.8];
const FLIGHT_STEP = 1 / 120;  // keyframe spacing, s (one per frame on a 120Hz screen)
const FLIGHT_SETTLE = 0.6;    // px: the flight ends once every axis is this close (the rest is invisible creep)

// A spring released from rest at 0 towards 1, as a function of time in s
function spring([response, damping]) {
  const w0 = 2 * Math.PI / response;
  const wd = w0 * Math.sqrt(1 - damping * damping);
  return t => 1 - Math.exp(-damping * w0 * t) * (Math.cos(wd * t) + (damping * w0 / wd) * Math.sin(wd * t));
}

/**
 * Replaces the UA's straight-line morph of a view-transition group with the
 * splash flight above. Call once `vt.ready` has resolved: the group's own
 * animation is read for its start and end boxes, then cancelled. Leaves the
 * UA's (or the stylesheet's) morph in place if anything about it is unexpected.
 */
export function springFlight(name) {
  const pseudo = `::view-transition-group(${name})`;
  const ua = document.getAnimations().find(a => a.effect?.pseudoElement === pseudo);
  const frames = ua?.effect.getKeyframes();
  if (!frames || frames.length < 2) return;
  const box = (f) => {
    const m = new DOMMatrix(f.transform);
    const w = parseFloat(f.width), h = parseFloat(f.height);
    return { cx: m.e + w / 2, cy: m.f + h / 2, w, h };
  };
  const a = box(frames[0]), b = box(frames[frames.length - 1]);
  if (![a.w, a.h, b.w, b.h].every(Number.isFinite)) return;

  const X = spring(FLIGHT_X), Y = spring(FLIGHT_Y), S = spring(FLIGHT_SIZE);
  const keyframes = [];
  for (let t = 0; ; t += FLIGHT_STEP) {
    const s = S(t);
    const w = a.w + (b.w - a.w) * s, h = a.h + (b.h - a.h) * s;
    const cx = a.cx + (b.cx - a.cx) * X(t), cy = a.cy + (b.cy - a.cy) * Y(t);
    const settled = t > 0 && Math.max(Math.abs(cx - b.cx), Math.abs(cy - b.cy), Math.abs(w - b.w)) < FLIGHT_SETTLE;
    keyframes.push(settled
      ? { transform: frames[frames.length - 1].transform, width: `${b.w}px`, height: `${b.h}px` }
      : { transform: `translate(${cx - w / 2}px, ${cy - h / 2}px)`, width: `${w}px`, height: `${h}px` });
    if (settled || t > 2) break;
  }
  ua.cancel();
  document.documentElement.animate(keyframes, {
    duration: (keyframes.length - 1) * FLIGHT_STEP * 1000,
    easing: 'linear',
    fill: 'both',
    pseudoElement: pseudo,
  });
}

export function clearZoomOrigin() {
  writeVars(null);
}

/** The card's corner radius as a number of px, from its computed style. */
export function cardRadius(el) {
  const raw = parseFloat(getComputedStyle(el).borderTopLeftRadius);
  return Number.isFinite(raw) ? raw : 16;
}
