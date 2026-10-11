// Forces the header's progressive backdrop-filter to re-sample what is behind
// it. See the .header-blur-refresh rules in style.css for why that is needed
// after a view transition, and what the two classes here do.

let pending = 0;
let timers = [];
let alt = false;

function clearPending() {
  if (pending) cancelAnimationFrame(pending);
  pending = 0;
}

/* Why this exists: after a view transition, Safari keeps showing the header's
   backdrop-filter as it sampled the page *before* the transition (the list), so
   the blur over the detail photo is missing until the next scroll repaints it.
   Chromium and Firefox do not do this.

   Changing the blur radius or the layers' box is only a hint, and Safari is
   allowed to ignore it — it did, across several earlier fixes. Taking the
   layers out of the render tree and putting them back is not ignorable:
   `display: none` plus a forced style/layout flush destroys their renderers and
   compositing layers, so what comes back is built, and samples its backdrop,
   from scratch against what is painted behind the header now.

   Don't hint the wrapper with `will-change: backdrop-filter` as a "nudge": in
   WebKit that makes it the backdrop root of the very layers it wraps, which
   then sample nothing. */
function rebuild() {
  const layers = document.querySelector('.header-blur-layers');
  if (!layers) return;
  layers.style.display = 'none';
  void layers.offsetHeight;
  layers.style.display = '';
}

/* One nudge: change the layers for two frames, then put them back.
   Two frames rather than one because a single frame can be skipped — if the
   frame the class goes on is also the frame it comes off, the two styles
   coalesce into no change at all, which is exactly what we are trying to
   avoid. Alternating the class means consecutive nudges differ from each
   other too, not just from the resting state. */
function nudge() {
  const root = document.documentElement;
  clearPending();
  rebuild();
  alt = !alt;
  root.classList.remove('header-blur-refresh', 'header-blur-refresh-alt');
  root.classList.add(alt ? 'header-blur-refresh-alt' : 'header-blur-refresh');
  pending = requestAnimationFrame(() => {
    pending = requestAnimationFrame(() => {
      pending = 0;
      root.classList.remove('header-blur-refresh', 'header-blur-refresh-alt');
    });
  });
}

/**
 * Re-samples the header blur after whatever just changed behind it.
 *
 * Callers reach this from `vt.finished`, which is the end of the animation but
 * not necessarily the end of the *compositing* the transition set up: the
 * snapshot layers are torn down around that same frame. Nudging synchronously
 * there risks re-sampling the snapshots a frame before they go away — which
 * leaves the blur holding a layer that no longer exists, i.e. the stale blur
 * this function is supposed to prevent. So the first nudge waits two frames,
 * by which point the live DOM is what is painted behind the header.
 *
 * Then twice more, because the page keeps changing behind the header after
 * that: the photo fades in and the page tint transitions over ~0.6s. The last
 * sweep is past the end of both.
 */
export function refreshHeaderBlur() {
  for (const t of timers) clearTimeout(t);
  timers = [];
  requestAnimationFrame(() => requestAnimationFrame(nudge));
  timers.push(setTimeout(nudge, 340), setTimeout(nudge, 720));
}
