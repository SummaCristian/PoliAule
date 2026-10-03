// State restoration for the home-screen app. iOS kills a suspended home-screen
// web app soon after it goes to the background, and relaunching it loads the
// page from scratch. Like a native app, it saves where the user was whenever it
// goes to the background and, when relaunched shortly after, opens there again
// instead of at the start: tab, campus, date, time range, scroll position and
// an open classroom page. Transient views (search, building overview, settings,
// info page) are left out; they reopen fresh.
//
// Whether this launch is a resume is decided before first paint by the inline
// script in index.html, which also hides the splash logo (it adds `.resuming`
// to <html>); it holds the age limit and the standalone check. In a browser tab
// nothing is restored: a reload there is expected to start over.

const KEY = 'poliAule_resume'; // also read by the inline script in index.html

function read() {
  if (!document.documentElement.classList.contains('resuming')) return null;
  try {
    return JSON.parse(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

/** The saved state to restore, or null when this launch starts fresh. */
export const resumeState = read();

/**
 * Saves `collect()`'s state every time the app goes to the background.
 * visibilitychange is what iOS reliably fires before suspending; pagehide
 * covers a close or reload.
 */
export function initResumeSnapshot(collect) {
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), ...collect() }));
    } catch {
      // Storage full or blocked: the next launch just starts fresh
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save();
  });
  window.addEventListener('pagehide', save);
}
