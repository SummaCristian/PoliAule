// Forces the header's progressive backdrop-filter to re-sample what is behind
// it. See the .header-blur-refresh rules in style.css for why that is needed
// after a view transition.

let pending = 0;
let second = 0;

function nudge() {
  const root = document.documentElement;
  if (pending) cancelAnimationFrame(pending);
  root.classList.add('header-blur-refresh');
  // Two frames: one for the nudged filter to be painted, one to go back to the
  // real radii. Dropping it in the same frame would coalesce into no change at
  // all, which is exactly what we are trying to avoid.
  pending = requestAnimationFrame(() => {
    pending = requestAnimationFrame(() => {
      pending = 0;
      root.classList.remove('header-blur-refresh');
    });
  });
}

export function refreshHeaderBlur() {
  nudge();
  // Again once the page underneath has settled: the photo and the page tint
  // fade in over the half-second after the transition, and the first nudge
  // lands before any of that is on screen.
  clearTimeout(second);
  second = setTimeout(nudge, 320);
}
