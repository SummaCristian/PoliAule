// Measurement harness for the card <-> detail page view transition. Inert
// unless the URL carries ?vtdebug (e.g. ?vtdebug, or ?vtdebug=live,noclip).
//
// Every open/close is reported to the console and to a small panel on screen
// (so a phone can be read without devtools), and pushed onto window.__vtRuns:
//   start   ms from startViewTransition() to .ready — capturing the old
//           state, running the update callback, capturing the new one. This
//           is the lag between the tap and the first moving frame.
//   cb      how much of `start` the update callback itself took
//   fps     frames drawn between .ready and .finished, per second
//   drop    frames missed in that window, counted against the display's own
//           refresh interval (measured once, at load)
//   worst   longest gap between two frames, ms
//   live    animations running in the page itself (not the transition's
//           pseudo-elements) when the motion starts: each one repaints the
//           snapshot it lives in on every frame
// The console entry also carries `liveNames` (which animations those are) and
// `gaps` (every frame gap, ms), and each run drops vt:<label>:ready /
// vt:<label>:finished performance marks for lining it up in a profile.
//
// The flags switch one piece of the transition off at a time, to find out
// what a given browser is paying for (the vtd-* rules in
// classroom-detail.css, and vtFlag() in classroom-detail.js):
//   live     don't freeze the page under the snapshot (the old behaviour)
//   noclip   no rounded clip on the growing page
//   noarc    no arc, a straight path
//   nohero   no card <-> photo shared element
//   noblur   no blurred photo backdrop
//   noglass  no backdrop-filter anywhere while the transition runs
//   noimg    no photos on the list's cards (all the time, not just in the
//            transition)
//   slow     2s instead of 0.4s, to look at it

const FLAGS = new Set();
let enabled = false;
try {
  const params = new URLSearchParams(location.search);
  if (params.has('vtdebug')) {
    enabled = true;
    for (const f of (params.get('vtdebug') ?? '').split(',')) {
      if (f.trim()) FLAGS.add(f.trim());
    }
  }
} catch { /* no location (tests) */ }

/** True when ?vtdebug is on and carries `name`. */
export function vtFlag(name) {
  return enabled && FLAGS.has(name);
}

// The display's refresh interval, from the median rAF gap over half a second
// of idle. Drops are counted against this rather than a fixed 16.7ms, so a
// 120Hz phone that falls to 60 shows up as dropping every other frame.
let refreshMs = 1000 / 60;
const runs = [];
let panel = null;

if (enabled) {
  for (const f of FLAGS) document.documentElement.classList.add(`vtd-${f}`);
  window.__vtRuns = runs;

  const gaps = [];
  let last = 0;
  const sample = (ts) => {
    if (last) gaps.push(ts - last);
    last = ts;
    if (gaps.length < 30) requestAnimationFrame(sample);
    else {
      gaps.sort((a, b) => a - b);
      refreshMs = gaps[gaps.length >> 1];
      render();
    }
  };
  const begin = () => setTimeout(() => requestAnimationFrame(sample), 500);
  if (document.readyState === 'complete') begin();
  else window.addEventListener('load', begin, { once: true });
}

/**
 * document.startViewTransition(update), measured when ?vtdebug is on.
 * `info` is called once the transition has finished, for whatever the caller
 * only knows by then (whether a hero was found, ...).
 */
export function startTrackedTransition(label, update, info) {
  if (!enabled) return document.startViewTransition(update);

  const t0 = performance.now();
  let cbStart = 0, cbEnd = 0;
  const vt = document.startViewTransition(() => {
    cbStart = performance.now();
    try { return update(); } finally { cbEnd = performance.now(); }
  });

  const stamps = [];
  let done = false;
  let tReady = 0;
  let live = [];
  vt.ready.then(() => {
    tReady = performance.now();
    performance.mark(`vt:${label}:ready`);
    live = document.getAnimations()
      .filter(a => a.playState === 'running'
        && !a.effect?.pseudoElement?.startsWith('::view-transition'))
      .map(describe);
    const tick = (ts) => {
      stamps.push(ts);
      if (!done) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, () => {});

  const finish = () => {
    done = true;
    performance.mark(`vt:${label}:finished`);
    if (!tReady) return; // skipped or aborted before it moved
    const span = stamps.length > 1 ? stamps[stamps.length - 1] - stamps[0] : 0;
    let dropped = 0, worst = 0;
    const gaps = [];
    for (let i = 1; i < stamps.length; i++) {
      const gap = stamps[i] - stamps[i - 1];
      gaps.push(Math.round(gap));
      worst = Math.max(worst, gap);
      dropped += Math.max(0, Math.round(gap / refreshMs) - 1);
    }
    const run = {
      label,
      flags: [...FLAGS].join(',') || '-',
      start: Math.round(tReady - t0),
      cb: Math.round(cbEnd - cbStart),
      fps: span ? Math.round((stamps.length - 1) / span * 1000) : 0,
      drop: dropped,
      worst: Math.round(worst),
      live: live.length,
      liveNames: live,
      gaps,
      ...(info?.() ?? {}),
    };
    runs.push(run);
    console.log('[vtdebug]', run);
    render();
  };
  vt.finished.then(finish, finish);
  return vt;
}

// "pulse-dot on span.status-dot", for the console: which animation is it that
// keeps a snapshot repainting.
function describe(a) {
  const el = a.effect?.target;
  const name = a.animationName ?? a.transitionProperty ?? a.id ?? '?';
  if (!el) return name;
  const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : '';
  return `${name} on ${el.localName}${el.id ? '#' + el.id : ''}${cls}${a.effect.pseudoElement ?? ''}`;
}

function render() {
  if (!enabled || !document.body) return;
  if (!panel) {
    panel = document.createElement('pre');
    // Above the tab bar and click-through, so it never gets in the way of
    // the app it is measuring.
    panel.style.cssText = `
      position: fixed; z-index: 2147483647; left: 8px; right: 8px;
      bottom: calc(var(--bottom-nav-height, 88px) + 8px);
      margin: 0; padding: 6px 8px; border-radius: 8px; overflow: hidden;
      font: 10px/1.35 ui-monospace, Menlo, monospace; white-space: pre; text-align: left;
      color: #fff; background: rgba(0, 0, 0, 0.78); pointer-events: none;`;
    document.body.appendChild(panel);
  }
  // Narrow enough for a phone: the column names are spelled out in the header.
  const pad = (v, n) => String(v).padStart(n);
  const head = `vtdebug [${[...FLAGS].join(',') || 'default'}] ${refreshMs.toFixed(1)}ms\n`
    + '       start  cb fps drop worst live';
  const rows = runs.slice(-6).map(r =>
    `${r.label.padEnd(5)} ${pad(r.start, 6)} ${pad(r.cb, 3)} ${pad(r.fps, 3)} ${pad(r.drop, 4)} `
    + `${pad(r.worst, 5)} ${pad(r.live, 4)}${r.zoom === false ? ' fade' : r.hero ? ' hero' : ''}`);
  // The last run frame by frame, in refresh intervals (1 = on time, 5 = four
  // frames missed there): tells one long stall from a steady struggle.
  const last = runs[runs.length - 1];
  const gaps = last?.gaps?.length
    ? [`${last.label} gaps: ${last.gaps.map(g => Math.max(1, Math.round(g / refreshMs))).join(' ')}`]
    : [];
  panel.textContent = [head, ...rows, ...gaps].join('\n');
}
