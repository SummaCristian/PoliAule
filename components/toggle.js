// iOS-style switch driven by pill-drag-core.js: a two-cell "picker" (off / on)
// whose pill is the thumb, so it lifts into glass on tap, follows the finger
// on drag and commits to the nearer end on release — the same behavior as
// segmented-control.js. The root is a <button>, so Space/Enter toggle natively.
import { createPillDragCore } from 'vitrium';
import { haptics, defaultPatterns } from './haptics.js';

// Returns { el, set, refresh, on, onChange }. Assign `onChange(isOn)` to react
// to user changes; set(isOn) is programmatic (silent) and animates by default.
export function createToggle(isOn) {
  const root = document.createElement('button');
  root.type = 'button';
  root.className = 'settings-toggle seg' + (isOn ? ' on' : '');
  root.setAttribute('role', 'switch');
  root.setAttribute('aria-checked', String(isOn));

  // Two fixed-size cells pinned to the thumb's off/on positions (absolutely
  // placed, since they overlap in the middle) give the core its two anchors.
  const items = document.createElement('div');
  items.className = 'settings-toggle__items';
  for (const pos of ['off', 'on']) {
    const cell = document.createElement('span');
    cell.className = `settings-toggle__cell settings-toggle__cell--${pos}`;
    items.appendChild(cell);
  }

  const pill = document.createElement('div');
  pill.className = 'seg-pill settings-toggle__thumb';
  const inner = document.createElement('div');
  inner.className = 'seg-pill-inner';
  const activeRow = document.createElement('div');
  activeRow.className = 'seg-active-row';
  inner.appendChild(activeRow);
  pill.appendChild(inner);

  const hit = document.createElement('div');
  hit.className = 'seg-hit';

  root.append(items, pill, hit);

  const api = {
    el: root,
    onChange: null,
    get on() { return root.classList.contains('on'); },
    set(v, { animate = true } = {}) {
      apply(v);
      core.select(v ? 1 : 0, { animate, silent: true });
    },
    refresh({ snap = false } = {}) { core.refresh({ snap }); },
  };

  function apply(v) {
    root.classList.toggle('on', v);
    root.setAttribute('aria-checked', String(v));
  }

  const core = createPillDragCore({
    root, items, pill, hit, activeRow,
    cellSelector: '.settings-toggle__cell',
    liftedClass: 'seg-pill--lifted',
    onPillTap: () => flip(),
    onChange(i, { silent }) {
      apply(i === 1);
      if (!silent) { haptics.trigger(defaultPatterns.light); api.onChange?.(i === 1); }
    },
  });

  function flip() { core.select(api.on ? 0 : 1); }

  // A tap on the bare track (padding, or a keyboard Space/Enter click). The
  // thumb and cells handle their own taps; a click that follows a drag
  // targets the hit overlay and must not toggle a second time.
  root.addEventListener('click', (e) => {
    if (e.target === root) flip();
  });

  new ResizeObserver(() => core.refresh()).observe(root);
  core.select(isOn ? 1 : 0, { animate: false, silent: true });

  return api;
}
