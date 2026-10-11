// Glides the pickers in `.picker-row` to their new place when the row reflows
// on its own: a pill changing width (the date pill with or without its
// "Today" badge, a longer label) can push the pill after it onto the next line
// or let it back up. Without this they jump.
//
// FLIP from the last known layout: every size change of the row or one of its
// pickers (a ResizeObserver, which runs after layout and before paint) compares
// each picker's position within the row to the previous one and animates
// `translate` over the difference. On the host element, not its pill, whose
// own translate belongs to the liquid-glass press.
//
// Only a reflow in an otherwise unchanged layout animates. A different window
// width, row width, or pill/panel mix (picker-dock.js) just updates the record:
// those are layout switches with their own handling, or a window being dragged.

const HOSTS = 'campus-chip-picker, date-chip-picker, time-range-chip-picker';
const GLIDE = { duration: 450, easing: 'cubic-bezier(0.32, 0.72, 0, 1)' };  // --nav-shift

export function initPickerRowFlip() {
  const row = document.querySelector('.picker-row');
  if (!row) return;
  const hosts = [...row.querySelectorAll(HOSTS)];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const glides = new Map();

  // The picker's current glide offset, so positions are recorded as laid out,
  // and an interrupted glide restarts from where the picker visibly is.
  const offsetOf = (el) => {
    const t = getComputedStyle(el).translate;
    if (!t || t === 'none') return [0, 0];
    const [x, y = '0'] = t.split(' ');
    return [parseFloat(x) || 0, parseFloat(y) || 0];
  };

  // A docked date/time picker holds a .chip-dock; a docked campus picker
  // hides itself and shows its panel beside it.
  const form = (h) => (h.querySelector(':scope > .chip-dock') || h.style.display === 'none') ? 'd' : 'p';

  const record = () => {
    const r = row.getBoundingClientRect();
    return {
      layout: `${window.innerWidth}|${Math.round(r.width)}|${hosts.map(form).join('')}`,
      pos: new Map(hosts.map(h => {
        const b = h.getBoundingClientRect();
        const [tx, ty] = offsetOf(h);
        return [h, { x: b.left - r.left - tx, y: b.top - r.top - ty, shown: b.width > 0 }];
      })),
    };
  };

  let last = null;
  const update = () => {
    const now = record();
    if (last?.layout === now.layout && !reduceMotion.matches) {
      for (const h of hosts) {
        const a = last.pos.get(h), b = now.pos.get(h);
        if (!a.shown || !b.shown) continue;
        if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5) continue;
        const [tx, ty] = offsetOf(h);
        glides.get(h)?.cancel();
        glides.set(h, h.animate(
          { translate: [`${a.x + tx - b.x}px ${a.y + ty - b.y}px`, '0 0'] },
          GLIDE
        ));
      }
    }
    last = now;
  };

  const ro = new ResizeObserver(update);
  ro.observe(row);
  hosts.forEach(h => ro.observe(h));
}
