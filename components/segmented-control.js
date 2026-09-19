// Glass segmented control with the tabbar's tap + drag behavior (see
// pill-drag-core.js). Content-agnostic: every child of `root` marked
// `.seg-item[data-value]` is a selectable cell holding whatever markup the
// caller wants (text, icon + text, ...) — the control just hugs it, and its
// height follows the tallest cell. Any other child (e.g. a `.seg-separator`)
// stays in the flow but isn't selectable.
import { createPillDragCore } from './pill-drag-core.js';

// root: an empty-of-chrome element holding just the `.seg-item`s.
// onSelect(value, { silent }): a different item became the selected one.
export function createSegmentedControl(root, { value, onSelect } = {}) {
  root.classList.add('seg');
  root.setAttribute('role', 'radiogroup');

  // Track (glass background) > items, with the pill + hit overlay as the
  // track's siblings rather than children — same relationship as
  // .bn-pill-outer / .bn-pill-hit next to .bn-tabbar, for the same Safari
  // backdrop-filter reasons.
  const track = document.createElement('div');
  track.className = 'seg-track';
  const items = document.createElement('div');
  items.className = 'seg-items';
  while (root.firstChild) items.appendChild(root.firstChild);
  track.appendChild(items);

  const pill = document.createElement('div');
  pill.className = 'seg-pill';
  const pillInner = document.createElement('div');
  pillInner.className = 'seg-pill-inner';
  const activeRow = document.createElement('div');
  activeRow.className = 'seg-active-row';
  pillInner.appendChild(activeRow);
  pill.appendChild(pillInner);

  const hit = document.createElement('div');
  hit.className = 'seg-hit';

  root.append(track, pill, hit);

  const cellsOf = () => Array.from(items.querySelectorAll('.seg-item'));
  cellsOf().forEach(el => el.setAttribute('role', 'radio'));

  function markActive(i) {
    cellsOf().forEach((el, j) => {
      el.classList.toggle('active', j === i);
      el.setAttribute('aria-checked', j === i ? 'true' : 'false');
      el.tabIndex = j === i ? 0 : -1;
    });
  }

  const core = createPillDragCore({
    root, items, pill, hit, activeRow,
    cellSelector: '.seg-item',
    activeCellClass: 'seg-active-cell',
    liftedClass: 'seg-pill--lifted',
    onChange(i, { silent }) {
      markActive(i);
      onSelect?.(cellsOf()[i].dataset.value, { silent });
    },
  });

  const indexOf = v => cellsOf().findIndex(el => el.dataset.value === String(v));

  // Programmatic selection. Silent by default, since the caller already knows.
  function select(v, { animate = false, silent = true } = {}) {
    const i = indexOf(v);
    if (i === -1) return;
    markActive(i);
    core.select(i, { animate, silent });
  }

  // Re-measure after the labels changed, or right before the control is
  // shown (it can't be measured while display:none / mid-transform).
  function refresh({ snap = false } = {}) { core.refresh({ snap }); }

  new ResizeObserver(() => core.refresh()).observe(root);

  if (value !== undefined) select(value);

  return {
    select,
    refresh,
    get value() { return cellsOf()[core.index]?.dataset.value; },
  };
}
