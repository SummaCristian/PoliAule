// Draggable sliding indicator for a horizontal ".date-picker-container" row of
// ".date-element-container" cells with a ".date-indicator" pill. All the
// tap/drag/spring behavior lives in pill-drag-core.js (shared with the
// settings segmented controls); this file only maps that onto the date
// picker's existing markup/CSS and its skipped-day rules. Used by both the
// Available tab's date picker (date-picker.js) and the details page's mobile
// day-chip selector (classroom-detail.js), which share the same markup/CSS
// but otherwise have independent selection logic (hidden <select> vs.
// schedule row highlight).
import { createPillDragCore } from 'vitrium';
import { haptics, defaultPatterns } from './haptics.js';

// container: the `.date-picker-container` element (already position:relative,
// already holding a `.date-indicator` sibling and some
// `.date-element-container` children — those may be regenerated later; call
// refresh() after doing so).
//
// isSkipped(el): predicate for "not a selectable day" (shakes on tap, and a
// drag that settles on it snaps back to the last selection instead).
// onSelect(el, { silent }): called whenever a *new* cell commits as the
// active one, whether by tap, drag, or a programmatic selectElement() call.
// `silent` is true only for a caller-initiated selectElement(el, { silent: true })
// (e.g. an initial auto-select) — callers use it to skip haptics/side effects
// that shouldn't fire on page load.
export function createPillSelector(container, { isSkipped = el => el.classList.contains('date-skipped'), onSelect } = {}) {
  // container's own parent — .date-picker / .detail-schedule-day-selector,
  // both already position:relative. The indicator (+ hit overlay) live here
  // as container's siblings, not its children — same relationship as
  // .bn-pill-outer/.bn-pill-hit being siblings of .bn-tabbar rather than
  // nested inside it, and already marked up that way (not reparented at
  // runtime): Safari doesn't reliably recompute an element's backdrop-filter
  // root after it's moved out from under a backdrop-filter'd ancestor via
  // JS, which silently killed the indicator's lift-blur there.
  const wrapper = container.parentElement;

  const indicator = wrapper.querySelector(':scope > .date-indicator');
  wrapper.appendChild(indicator); // move after `container` in case of re-init (refresh() re-runs this)

  // Wrap the real cells in their own layer so a pill-shaped hole can be
  // clipped out of them while the indicator is lifted — same reason
  // .bn-tabbar-items exists in bottom-nav.css/js. Idempotent across repeated
  // createPillSelector() calls on the same container (setupDatePicker can
  // re-run): reuse an existing wrapper and just re-adopt whatever cells
  // currently sit as direct children.
  let items = container.querySelector(':scope > .date-picker-items');
  if (!items) {
    items = document.createElement('div');
    items.className = 'date-picker-items';
    container.insertBefore(items, container.firstChild);
  }
  const adoptCells = () =>
    Array.from(container.querySelectorAll(':scope > .date-element-container')).forEach(el => items.appendChild(el));
  adoptCells();

  // Accent-colored cell duplicates (.bn-active-row's equivalent) live in an
  // overflow:hidden inner layer that blurs while lifted (.bn-pill-inner's).
  indicator.querySelector(':scope > .date-indicator-inner')?.remove();
  const inner = document.createElement('div');
  inner.className = 'date-indicator-inner';
  const activeRow = document.createElement('div');
  activeRow.className = 'date-indicator-active-row';
  inner.appendChild(activeRow);
  indicator.appendChild(inner);

  wrapper.querySelector(':scope > .date-indicator-hit')?.remove();
  const hit = document.createElement('div');
  hit.className = 'date-indicator-hit';
  wrapper.appendChild(hit); // after indicator too

  function shake() {
    indicator.classList.remove('shake');
    void indicator.offsetWidth; // force reflow to restart the animation
    indicator.classList.add('shake');
    indicator.addEventListener('animationend', () => indicator.classList.remove('shake'), { once: true });
    haptics.trigger(defaultPatterns.error);
  }

  const core = createPillDragCore({
    root: wrapper, items, pill: indicator, hit, activeRow,
    cellSelector: '.date-element-container',
    activeCellClass: 'date-indicator-cell',
    liftedClass: 'date-indicator--lifted',
    tapScale: 1.6,
    // Wide row → the whole thing trails a bit more than the compact tabbar.
    trail: { follow: 0.12, give: 8, giveCross: 5 },
    canSelect: i => !isSkipped(core.cells[i]),
    onReject: shake,
    haptic: null, // onSelect callers buzz (or deliberately don't) themselves
    // The shake keyframes (date-indicator-shake in date-picker.css) rotate
    // around the pill's current x.
    onRender: ({ pos }) => indicator.style.setProperty('--indicator-x', `${pos}px`),
    onChange: (i, { silent }) => onSelect?.(core.cells[i], { silent }),
  });

  // Recompute anchors from the current `.date-element-container` children.
  // Call after (re)generating the cells, and whenever their layout can shift
  // (window resize, a hide-sundays toggle collapsing some cells).
  function refresh() {
    // Cells regenerated elsewhere (date-picker.js clears + re-appends) land
    // as direct children of `container` again — keep them inside `items`.
    adoptCells();
    core.refresh({ snap: true });
  }

  function selectElement(el, { silent = false, animate = true } = {}) {
    const index = core.indexOf(el);
    if (index === -1) {
      // el isn't part of the currently laid-out set — most commonly because
      // the whole container is display:none (e.g. the mobile-only day
      // selector while on desktop). onSelect still needs to fire so callers
      // reacting to *which* cell is logically selected (not just the
      // indicator's position) stay correct; refresh() + a follow-up
      // selectElement() once the container is visible again will place the
      // indicator properly.
      onSelect?.(el, { silent });
      return;
    }
    // The core only reports *changes*; callers here expect onSelect on every
    // (re-)commit and dedupe themselves.
    if (index === core.index) onSelect?.(el, { silent });
    core.select(index, { animate, silent });
  }

  return {
    refresh,
    selectElement,
    get activeElement() { return core.cells[core.index]; },
  };
}
