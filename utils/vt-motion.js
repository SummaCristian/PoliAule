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

const VARS = ['--zoom-x', '--zoom-y', '--zoom-scale', '--zoom-clip', '--zoom-radius',
  '--zoom-card-radius', '--arc-x', '--arc-y'];

// Peak of each half of the arc, as a fraction of that axis's own distance: the
// horizontal running ahead of the spring, the vertical dragging behind it.
// These are the peaks of detail-zoom-arc's two tracks in classroom-detail.css —
// change one and the other has to be re-derived from the same spring.
const ARC_LEAD = 0.163;  // horizontal, ahead
const ARC_DRAG = 0.148;  // vertical, behind

/**
 * Writes the zoom's starting geometry to <html>.
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
  const style = document.documentElement.style;
  style.setProperty('--zoom-x', `${rect.left}px`);
  style.setProperty('--zoom-y', `${rect.top}px`);
  style.setProperty('--zoom-scale', `${scale}`);
  // clip-path applies in the snapshot's own coordinates, i.e. before the scale,
  // so the card's height has to be divided back out. The left/right insets stay
  // 0 at every point of the animation (the scale comes from the width), which
  // is why only the bottom one is variable.
  style.setProperty('--zoom-clip', `${Math.max(0, vh - rect.height / scale)}px`);
  style.setProperty('--zoom-radius', `${radius / scale}px`);
  // The same radius in screen px, for the hero's own corners to morph along
  // with the page's clip instead of guessing at the card's shape.
  style.setProperty('--zoom-card-radius', `${radius}px`);

  // The arc's two peak offsets. The page travels from the card's top left
  // corner to the viewport's, so its distance is just the card's offset,
  // negated: x runs ahead of that (further left, sooner), y falls behind it
  // (still low, later) — which is what bows the path downwards rather than
  // over the top. Both are written the same way for open and close: the close
  // uses its own keyframes to retrace this same curve, rather than mirroring
  // it, so the two directions follow one path.
  style.setProperty('--arc-x', `${-ARC_LEAD * rect.left}px`);
  style.setProperty('--arc-y', `${ARC_DRAG * rect.top}px`);
  return true;
}

export function clearZoomOrigin() {
  const style = document.documentElement.style;
  for (const v of VARS) style.removeProperty(v);
}

/** The card's corner radius as a number of px, from its computed style. */
export function cardRadius(el) {
  const raw = parseFloat(getComputedStyle(el).borderTopLeftRadius);
  return Number.isFinite(raw) ? raw : 16;
}
