// utils/blur-capability.js
//
// Perf-gated glass blur. backdrop-filter is expensive to composite on weak
// GPUs, so instead of shipping it to every device we benchmark it once and
// cache the verdict. No blur is the safe baseline: before the first-ever
// benchmark resolves, and on any device that fails it, [data-blur] stays
// "off" and every backdrop-filter in the app is disabled (see style.css).
// Blur is granted, never assumed.
//
// The benchmark deliberately does NOT run during the splash/load sequence.
// It did originally, but even once its rAF sampling was moved past the app's
// own synchronous DOM-building work, page load still isn't a clean window:
// layout/paint settling, font/image rendering, network activity, and (on
// Safari specifically) JIT warm-up on first execution all eat frame budget
// without ever showing up as "the main thread is blocked." That produced
// false negatives on genuinely capable devices — confirmed by the fact that
// manually forcing "Auto" from Settings after load (when nothing else is
// competing) reliably passed on the same hardware. So instead: apply the
// safe "off" default (or a previously cached verdict) instantly at load, and
// schedule the actual benchmark for a moment of real post-load idle time —
// see scheduleIdleBenchmark(). It still only runs once per device (cached
// after), so the "pay the cost once" property is preserved; it's just paid
// at a moment that actually reflects real usage instead of at boot.

export const BLUR_MODE_KEY = 'poliAule_blurMode'; // 'auto' | 'on' | 'off'
const BENCHMARK_CACHE_KEY = 'poliAule_blurBenchmark';

// Bump this whenever the benchmark logic or thresholds change, so stale
// cached verdicts from an older version don't linger — they'll re-run once.
// v3: benchmark no longer runs during splash/load (see module comment above)
// — this also flushes out any "off" verdict a device got misdiagnosed with
// under the old load-time measurement.
// v4: widened sample/loosened jank tolerance (see the constants below) —
// the old thresholds failed devices on a single stray frame.
const BENCHMARK_VERSION = 4;

const IDLE_RECHECK_DELAY_MS = 2500; // fallback delay where requestIdleCallback isn't available (Safari)

// At the old SAMPLE_MS=220/WARMUP_FRAMES=2 this left ~11 sampled frames at
// 60fps, and MAX_JANK_RATIO=0.15 of that is 1.65 — so a single stray slow
// frame (GC pause, compositor hiccup, timer jitter — normal even on capable
// hardware) was enough to fail the device. Now that the benchmark runs at
// idle time instead of during load, there's no splash-budget pressure to
// keep the sample short, so it's widened for a real statistical margin
// instead of reacting to one bad frame.
const SAMPLE_MS = 500;         // benchmark window — ~30 frames at 60fps
const WARMUP_FRAMES = 3;       // ignore the first frames — one-time compositing-layer setup, not sustained cost
const JANK_THRESHOLD_MS = 24;  // a frame slower than this counts as dropped (~1.4x a 60Hz frame budget)
const MAX_JANK_RATIO = 0.3;    // capable if fewer than 30% of sampled frames are dropped

export function getBlurMode() {
  return localStorage.getItem(BLUR_MODE_KEY) ?? 'auto';
}

export function setBlurMode(mode) {
  localStorage.setItem(BLUR_MODE_KEY, mode);
}

function readCachedResult() {
  try {
    const raw = localStorage.getItem(BENCHMARK_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed.version === BENCHMARK_VERSION ? parsed.capable : null;
  } catch {
    return null;
  }
}

function writeCachedResult(capable) {
  try {
    localStorage.setItem(BENCHMARK_CACHE_KEY, JSON.stringify({ version: BENCHMARK_VERSION, capable }));
  } catch {
    // Storage unavailable (private browsing, quota) — just re-benchmark next load.
  }
}

function supportsBackdropFilter() {
  return CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)');
}

// Renders an offscreen panel sized/blurred like the app's heaviest glass
// surfaces (a full-viewport --glass-blur-lg panel) and measures rAF frame
// gaps while it's composited, so the sample reflects real compositing cost
// rather than a trivial element.
function runBenchmark() {
  return new Promise(resolve => {
    if (!supportsBackdropFilter()) {
      resolve(false);
      return;
    }

    const probe = document.createElement('div');
    probe.style.cssText = `
      position: fixed;
      inset: 0;
      opacity: 0;
      pointer-events: none;
      background: rgba(250, 250, 250, 0.7);
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      z-index: -1;
    `;
    document.body.appendChild(probe);

    const start = performance.now();
    let lastTime = start;
    let totalFrames = 0;
    let jankFrames = 0;

    function tick(now) {
      totalFrames++;
      if (totalFrames > WARMUP_FRAMES && now - lastTime > JANK_THRESHOLD_MS) jankFrames++;
      lastTime = now;

      if (now - start < SAMPLE_MS) {
        requestAnimationFrame(tick);
        return;
      }
      probe.remove();
      const sampledFrames = totalFrames - WARMUP_FRAMES;
      // Too few post-warmup frames to trust (e.g. the tab was backgrounded
      // mid-sample) — don't call that "capable".
      const ratio = sampledFrames > 1 ? jankFrames / sampledFrames : 1;
      resolve(ratio <= MAX_JANK_RATIO);
    }
    requestAnimationFrame(tick);
  });
}

// Resolves whether blur should render *right now*, applying the manual
// Settings override first, without ever running the benchmark itself — see
// the module comment for why. In 'auto' mode with no cached verdict yet,
// this returns the safe "off" default; scheduleIdleBenchmark() fills the
// cache in shortly after and applies the real verdict live.
export function resolveBlurCapability() {
  const mode = getBlurMode();
  if (mode === 'on') return true;
  if (mode === 'off') return false;

  if (window.matchMedia?.('(prefers-reduced-transparency: reduce)').matches) return false;

  return readCachedResult() ?? false;
}

// Schedules a one-time benchmark during real post-load idle time (not during
// splash/load — see module comment) and applies + caches the result. No-op
// if a cached verdict already exists, or the user isn't on 'auto'. Call once
// after the splash dismisses.
export function scheduleIdleBenchmark() {
  if (getBlurMode() !== 'auto') return;
  if (readCachedResult() !== null) return;

  const run = () => {
    // Mode or cache may have changed while waiting (manual override, or a
    // duplicate call from another tab/instance) — bail rather than clobber it.
    if (getBlurMode() !== 'auto' || readCachedResult() !== null) return;
    runBenchmark().then(capable => {
      writeCachedResult(capable);
      applyBlurState(capable);
    });
  };

  if ('requestIdleCallback' in window) {
    requestIdleCallback(run, { timeout: IDLE_RECHECK_DELAY_MS + 1500 });
  } else {
    // Safari has never implemented requestIdleCallback.
    setTimeout(run, IDLE_RECHECK_DELAY_MS);
  }
}

// Fired on every applyBlurState() call (including no-op re-applications) so
// components that can't rely on :root custom-property inheritance — e.g.
// shadow-DOM components that intentionally keep their own concrete palette,
// see components/campus-picker.css — can mirror the verdict onto themselves.
export const BLUR_STATE_EVENT = 'poliaule:blurstatechange';

export function applyBlurState(capable) {
  document.documentElement.dataset.blur = capable ? 'on' : 'off';
  window.dispatchEvent(new CustomEvent(BLUR_STATE_EVENT, { detail: { capable } }));
}

// Re-runs and re-caches the benchmark, then applies the result immediately.
// Used when the user switches Settings back to "Auto" — no need to wait for
// the next reload's splash screen.
export async function reevaluateBlurCapability() {
  const capable = await runBenchmark();
  writeCachedResult(capable);
  applyBlurState(capable);
  return capable;
}
