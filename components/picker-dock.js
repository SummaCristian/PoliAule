// Decides whether the campus / date / time-range pickers on the Available tab
// render as compact glass pills or as inline expanded glass panels docked in
// the form column.
//
// The pill/popup design is mobile-first: the pickers live in a sticky bar
// inside the scrollable results grid, so they must stay small. On desktop the
// form is a static left column, so the same panels can sit open in the flow —
// no pill, no morph.
//
// Rule: the form column must NOT need scrolling. In the desktop two-column
// layout (>= 1100px, the breakpoint that also splits the tab into two columns)
// the pickers expand only as far as they all still fit above the viewport
// bottom. When they don't fit, they compact one at a time in priority order —
// campus first (a set-once list), then date, then time-range last — until the
// column fits again. Below 1100px everything stays a pill.
//
// The layout itself (campus beside a date+time stack, wrapping when narrow) is
// pure CSS — see `.picker-substack` in index.html / style.css. This module only
// decides how many pickers are compacted, and re-decides on any real viewport
// or layout change (not just crossing the breakpoint).
//
// Exception: when the Favourites are expanded to fill the left column
// (components/favourites.js), the pickers leave it and ride sticky on top of
// the results panel instead, as on mobile — so they all stay pills. The same
// layout is used (class `pickers-sticky`) when the column is too narrow for
// the docked panels, which would otherwise crowd each other: the stepper
// covering the time label, the date strip overflowing its card.

export function initPickerDock() {
  const row = document.querySelector('.picker-row');
  const date = document.querySelector('date-chip-picker');
  const time = document.querySelector('time-range-chip-picker');
  const campus = document.querySelector('campus-chip-picker');
  const container = document.getElementById('available-classrooms-container');
  if (!row || !date || !time || typeof date.setDocked !== 'function') return;

  // Same breakpoint the Available tab uses to switch to two columns
  // (see the `@media (min-width: 1100px)` block in style.css).
  const twoCol = window.matchMedia('(min-width: 1100px)');

  // Compacted from the front when the column would otherwise overflow.
  const priority = [campus, date, time].filter(
    el => el && typeof el.setDocked === 'function'
  );

  // The narrowest form column the docked panels fit in: the campus list (200)
  // and the time panel (340, the widest of the two) side by side, plus the gap.
  const MIN_DOCK_WIDTH = 552;

  const PAD = 24;   // clearance kept below the last panel
  const HYST = 48;  // extra room required before expanding one more — a deadband
                    // so the decision can't flip-flop at a boundary height

  let compacted = 0;

  // A fingerprint of everything the decision depends on EXCEPT the picker
  // states themselves. `row`'s top edge moves when the content above it
  // (favourites, header) changes height; its own height doesn't affect this.
  // When the fingerprint is unchanged, a settle() is just the ResizeObserver
  // echoing our own toggling — skip the expand probe so we don't thrash.
  let tooNarrow = false;
  const docked = () =>
    twoCol.matches && !tooNarrow && !container?.classList.contains('favourites-expanded');

  // The column's width is the same whether the pickers are docked in it or
  // sticky over the results (both take one grid column), so this can't flip
  // on its own. Skipped while the tab is hidden (the row measures 0).
  const measureNarrow = () => {
    const w = row.getBoundingClientRect().width;
    if (w > 0) tooNarrow = twoCol.matches && w < MIN_DOCK_WIDTH;
    container?.classList.toggle('pickers-sticky', tooNarrow);
  };

  const fingerprint = () =>
    `${docked()}|${window.innerWidth}|${window.innerHeight}|` +
    `${Math.round(row.getBoundingClientRect().top)}`;
  let lastPrint = '';

  const apply = (n) => {
    compacted = Math.max(0, Math.min(priority.length, n));
    priority.forEach((el, i) => el.setDocked(i >= compacted));
  };

  const overflows = (slack = 0) =>
    row.getBoundingClientRect().bottom > window.innerHeight - PAD - slack;

  let running = false;
  const settle = () => {
    if (running) return;
    running = true;

    measureNarrow();
    const changed = fingerprint() !== lastPrint;

    if (!docked()) {
      apply(priority.length);
    } else {
      apply(compacted);

      if (overflows()) {
        // Always compact when it overflows, however we got here.
        while (compacted < priority.length && overflows()) apply(compacted + 1);
      } else if (changed) {
        // The viewport or the layout above changed — the column may now wrap
        // differently and leave room to expand one (or more) back.
        while (compacted > 0) {
          apply(compacted - 1);
          if (overflows(HYST)) { apply(compacted + 1); break; }
        }
      }
    }

    lastPrint = fingerprint();
    running = false;
  };

  new ResizeObserver(settle).observe(row);
  window.addEventListener('resize', settle);
  twoCol.addEventListener('change', settle);
  container?.addEventListener('tabvisible', settle);
  container?.addEventListener('favouritesexpandchange', settle);

  settle();
}
