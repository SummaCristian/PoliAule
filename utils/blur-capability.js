// utils/blur-capability.js
//
// Perf-gated glass blur. backdrop-filter is expensive to composite on weak
// GPUs, so instead of shipping it to every device we benchmark it during the
// splash screen — dead time we already pay for asset loading — and cache the
// verdict. No blur is the safe baseline: before the first-ever benchmark
// resolves, and on any device that fails it, [data-blur] stays "off" and
// every backdrop-filter in the app is disabled (see style.css). Blur is
// granted, never assumed.

export const BLUR_MODE_KEY = 'poliAule_blurMode'; // 'auto' | 'on' | 'off'
const BENCHMARK_CACHE_KEY = 'poliAule_blurBenchmark';

// Bump this whenever the benchmark logic or thresholds change, so stale
// cached verdicts from an older version don't linger — they'll re-run once.
const BENCHMARK_VERSION = 2;

const SAMPLE_MS = 220;         // benchmark window; bounded by the splash's own min display time
const WARMUP_FRAMES = 2;       // ignore the first frames — one-time compositing-layer setup, not sustained cost
const JANK_THRESHOLD_MS = 20;  // a frame slower than this counts as dropped
const MAX_JANK_RATIO = 0.15;   // capable if fewer than 15% of sampled frames are dropped

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

// Resolves whether blur should render, applying the manual Settings override
// first. In 'auto' mode, `prefers-reduced-transparency` is honored ahead of
// the benchmark (cheap, and it's the user's OS-level call, not a perf one).
export async function resolveBlurCapability() {
  const mode = getBlurMode();
  if (mode === 'on') return true;
  if (mode === 'off') return false;

  if (window.matchMedia?.('(prefers-reduced-transparency: reduce)').matches) return false;

  const cached = readCachedResult();
  if (cached !== null) return cached;

  const capable = await runBenchmark();
  writeCachedResult(capable);
  return capable;
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
