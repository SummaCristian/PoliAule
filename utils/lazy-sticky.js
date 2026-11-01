// Sticky only where it can stick. Below 1100px the Available tab's picker bar
// and the results' building headers are `position: sticky`, and iOS Safari
// colours its bottom bar from the sticky and fixed elements it finds at the
// bottom edge: the picker bar pushed down there (by the favourites' edit grid)
// turned the bottom safe area solid, and a building header scrolling up into
// view didn't show through it like the rest of the page.
//
// So they sit in the flow (`.lazy-sticky`, static) until the element they
// follow (their previous sibling, else their parent) has come up past a line
// across the screen, the middle or a little under where the lowest of them
// sticks, whichever is lower. From there they are sticky. Nothing moves as
// they switch either way: an element only sticks above that line, and below it
// a sticky one rests where a static one would.

const _narrow = window.matchMedia('(max-width: 1099.98px)');
const _watched = new Map();   // element -> the anchor it is watched by (null until observed)
const _byAnchor = new Map();  // anchor -> element
const _waits = new Map();     // element not in the page yet -> frames waited for it
let _io = null;
let _line = 0;
let _queued = false;

const _stickTop = (el) => parseFloat(getComputedStyle(el).top);

export function lazySticky(el) {
  if (!el || _watched.has(el)) return;
  el.classList.add('lazy-sticky');
  _watched.set(el, null);
  _queue();
}

function _queue() {
  if (_queued) return;
  _queued = true;
  // After the caller has put the element in the page (a building section is
  // built first and attached after)
  requestAnimationFrame(_flush);
}

function _flush() {
  _queued = false;
  // One that sticks lower than the line allows: the line moves down for it
  if (_io) {
    for (const [el, anchor] of _watched) {
      if (!anchor && el.isConnected && _stickTop(el) + 16 > _line) { _rebuild(); return; }
    }
  }
  let pending = false;
  for (const [el, anchor] of _watched) {
    if (anchor) {
      // Gone with a rebuilt list: let it go
      if (!el.isConnected) { _io?.unobserve(anchor); _byAnchor.delete(anchor); _watched.delete(el); }
      continue;
    }
    if (!el.isConnected) {
      // Built and never attached (a list thrown away): given up on after a while
      const n = (_waits.get(el) ?? 0) + 1;
      if (n > 30) { _waits.delete(el); _watched.delete(el); } else { _waits.set(el, n); pending = true; }
      continue;
    }
    _waits.delete(el);
    const a = el.previousElementSibling ?? el.parentElement;
    _watched.set(el, a);
    _byAnchor.set(a, el);
    _observer()?.observe(a);
  }
  // Built but not attached yet: look again next frame
  if (pending) _queue();
}

// The line is set from where the elements stick, so it is rebuilt with the
// viewport.
function _observer() {
  if (!_narrow.matches) return null;
  if (_io) return _io;
  let lowest = 0;
  for (const el of _watched.keys()) {
    const top = el.isConnected ? _stickTop(el) : NaN;
    if (Number.isFinite(top)) lowest = Math.max(lowest, top);
  }
  const line = _line = Math.round(Math.max(window.innerHeight / 2, lowest + 16));
  // Everything from far above the page down to the line: an anchor anywhere
  // in there has come up past it.
  _io = new IntersectionObserver((entries) => {
    for (const e of entries) _byAnchor.get(e.target)?.classList.toggle('is-sticky', e.isIntersecting);
  }, { rootMargin: `100000px 0px ${line - window.innerHeight}px 0px` });
  return _io;
}

function _rebuild() {
  _io?.disconnect();
  _io = null;
  _byAnchor.clear();
  for (const el of _watched.keys()) {
    _watched.set(el, null);
    // Wide, they're sticky (or not) by the stylesheet alone
    if (!_narrow.matches) el.classList.remove('is-sticky');
  }
  _queue();
}

let _resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(_rebuild, 150);
});
_narrow.addEventListener('change', _rebuild);
