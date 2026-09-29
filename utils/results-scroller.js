// Where the Available results' scrollable area "starts" on screen, and how to
// scroll it, for the two places the results live: in the page (mobile /
// tablet) or inside the self-scrolling results panel (desktop ≥1100px).
// Shared by the building overview (components/building-overview.js) and the
// building scrubber (components/building-scrubber.js).

// "visibleTop" is the client-y a stuck building header parks at — i.e. where
// a section's top should sit to read as "scrolled to this building".
export function scrollerFor(container, stickyTop) {
  const selfScrolls = /auto|scroll/.test(getComputedStyle(container).overflowY);
  if (selfScrolls) {
    return {
      visibleTop: () => container.getBoundingClientRect().top + container.clientTop + stickyTop,
      visibleBottom: () => container.getBoundingClientRect().top + container.clientTop + container.clientHeight,
      scrollBy: (dy) => container.scrollBy({ top: dy, behavior: 'instant' }),
      contentHeight: () => container.scrollHeight,
    };
  }
  return {
    visibleTop: () => stickyTop,
    visibleBottom: () => window.innerHeight,
    // The page has `scroll-behavior: smooth` — every scroll here has to be
    // explicitly instant or it turns into a visible glide.
    scrollBy: (dy) => window.scrollBy({ top: dy, behavior: 'instant' }),
    contentHeight: () => document.documentElement.scrollHeight,
  };
}

// Client-y a stuck building header parks at (the used `top` of the sticky
// header — header height + picker bar + margins, or 1rem inside the panel
// on desktop).
export function stickyTopOf(section) {
  const header = section?.querySelector('.building-section-header');
  const px = header ? parseFloat(getComputedStyle(header).top) : NaN;
  return Number.isFinite(px) ? px : 80;
}
