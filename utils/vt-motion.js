// Motion for the card <-> detail-page view transition: a critically damped spring
// (no overshoot, no bounce) and an arced path instead of a straight line.
//
// The spring is the same curve as `--vt-spring` in classroom-detail.css (a CSS
// linear() easing, so the transition needs no JS to have the right timing). The
// arc is the only part that has to be done here: the UA animates the group's box
// from the old rect to the new one along a straight line, so a second animation
// on the group's independent `translate` property bends it.

export const VT_DURATION = 440; // ms, keep in sync with --vt-duration in classroom-detail.css
const OMEGA = 19;               // spring stiffness (1/s): ~99.8% settled at VT_DURATION
const ARC = 0.32;               // 0 = straight line; how far the leading axis runs ahead

// Progress (0..1) of a critically damped spring at normalized time t (0..1).
const spring = t => {
  const x = OMEGA * (VT_DURATION / 1000) * t;
  return 1 - (1 + x) * Math.exp(-x);
};

/**
 * Bends the group's path into an arc. The axis with the longer way to go leads
 * (runs on a time-compressed spring) and the other trails on the plain spring, so
 * the box heads for its destination's axis first and then curves in, instead of
 * sliding along the diagonal. Size still interpolates on the UA's own animation.
 *
 * @param vt      the ViewTransition
 * @param name    the view-transition-name of the group
 * @param from    DOMRect the box starts at (old state)
 * @param getTo   () => DOMRect it ends at (new state); read at `ready`, after the
 *                update callback has run
 */
export function arcGroup(vt, name, from, getTo) {
  vt.ready.then(() => {
    const to = getTo();
    if (!from || !to) return;
    const dx = to.left - from.left;
    const dy = to.top - from.top;
    if (Math.abs(dx) + Math.abs(dy) < 2) return;

    const xLeads = Math.abs(dx) >= Math.abs(dy);
    const lead = t => spring(Math.min(1, t * (1 + ARC)));

    const STEPS = 24;
    const frames = [];
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      const base = spring(t);
      const ex = xLeads ? lead(t) : base;
      const ey = xLeads ? base : lead(t);
      // Offset from the straight-line position the UA animation already applies.
      frames.push({ translate: `${(ex - base) * dx}px ${(ey - base) * dy}px` });
    }

    try {
      document.documentElement.animate(frames, {
        duration: VT_DURATION,
        easing: 'linear',
        fill: 'both',
        pseudoElement: `::view-transition-group(${name})`,
      });
    } catch { /* no pseudoElement support: keep the straight (still spring-eased) path */ }
  }).catch(() => {});
}
