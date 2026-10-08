// Back closes what's open. An overlay that isn't a page of its own (the
// search, a picker's panel, a dialog, the building popup) pushes a history
// entry while it's up — same URL, only a state object — so the browser's Back
// (Android's key or gesture, the toolbar, a swipe) pops that entry and closes
// it, instead of leaving the page. The pages with an address of their own
// (classroom, Info, Settings, Changelog) keep their hash routes.
//
//   const back = ownBack(({ uaAnimated }) => close());
//   back.push();      // on open
//   back.release();   // on every close: steps back off the entry, unless Back
//                     // already popped it (then it's a no-op)
//   back.drop();      // closed by a navigation that pushes its own entry
//                     // over ours: the entry stays, and is stepped past when
//                     // Back lands on it later (leaveStaleEntry() when the
//                     // navigation may not come)
//
// Every entry carries its place in the history (`pos`), stamped on our own
// entries, on the one an overlay is opened from, and on the hash routes'
// entries as they're pushed. That's what tells Back *where* it landed: an
// overlay closes only when Back went below its entry. A building popup under
// a classroom page under Settings stays open when Back leaves Settings.
//
// `uaAnimated`: the browser played its own back animation (Safari's swipe),
// so the overlay should just go. Chrome for Android also crashes the renderer
// on a view transition during a browser back (see classroom-detail.js): an
// overlay closing with one must fade instead there (IS_ANDROID).

export const IS_ANDROID = /Android/i.test(navigator.userAgent);

const KEY = 'poliAuleBack';
let nextId = Date.now(); // ids stay unique across reloads, as entries outlive the page
let pos = 0;             // the current entry's place, as last seen
const open = [];         // handles with an entry, in push order
let pendingBacks = 0;    // our own history.go(-n) calls still to land
let afterBacks = [];     // run once they have

const entryOf = (state) => state?.[KEY] ?? null;

function stamp(p, id) {
  const state = history.state && typeof history.state === 'object' ? history.state : {};
  history.replaceState({ ...state, [KEY]: id == null ? { pos: p } : { pos: p, id } }, '');
}

// The current entry's place, stamping it if nothing has yet: a hash route's
// push (fires popstate/hashchange before anything reads it), or an entry
// someone replaced with a bare state.
function landedPos() {
  const entry = entryOf(history.state);
  if (entry) return entry.pos;
  stamp(pos + 1);
  return pos + 1;
}

function whenSettled(fn) {
  if (pendingBacks) afterBacks.push(fn);
  else fn();
}

function flush() {
  const fns = afterBacks;
  afterBacks = [];
  fns.forEach(fn => fn());
}

function goBack(n) {
  pendingBacks++;
  history.go(-n);
  // Never landed (nothing to go back to): don't hold pushes back forever
  const mine = pendingBacks;
  setTimeout(() => { if (pendingBacks === mine) { pendingBacks = 0; flush(); } }, 1500);
}

function onNavigate(e) {
  if (e.type === 'popstate' && pendingBacks > 0) pendingBacks--;
  const landed = entryOf(history.state);
  // A hash push (popstate then hashchange): only the first one stamps it
  if (e.type === 'hashchange' && landed) { pos = landed.pos; return; }
  pos = landedPos();
  const landedId = entryOf(history.state).id;

  // Everything whose entry is now ahead of us was closed by this Back, the
  // newest first. Its entry being where we are but not ours (a new branch)
  // counts too.
  for (let i = open.length - 1; i >= 0; i--) {
    const h = open[i];
    if (h.pos < pos || (h.pos === pos && h.id === landedId)) continue;
    open.splice(i, 1);
    h.onBack({ uaAnimated: !!e.hasUAVisualTransition });
  }

  // Landed on the entry of an overlay that's gone already (Back from a page
  // opened out of it, or Forward onto one): step past it.
  if (landedId != null && !open.some(h => h.id === landedId)) {
    goBack(1);
    return;
  }

  if (!pendingBacks) flush();
}

window.addEventListener('popstate', onNavigate);
window.addEventListener('hashchange', onNavigate);

// Loaded on one of our entries (a reload with something open): nothing is
// open any more, and stepping back off it would load the page again. Its
// place is kept.
{
  const entry = entryOf(history.state);
  if (entry) { pos = entry.pos; if (entry.id != null) stamp(entry.pos); }
}

export function ownBack(onBack) {
  const h = { id: 0, pos: 0, onBack, queued: false };

  const handle = {
    get active() { return open.includes(h) || h.queued; },

    push() {
      if (handle.active) return;
      // A release still landing would otherwise take this new entry with it
      h.queued = true;
      whenSettled(() => {
        if (!h.queued) return; // closed again before it got its entry
        h.queued = false;
        // The entry it's opened from gets its place now, if it lost it
        // (someone's replaceState) or never had one (the page's first)
        if (!entryOf(history.state)) stamp(pos);
        else pos = entryOf(history.state).pos;
        h.id = ++nextId;
        h.pos = pos + 1;
        history.pushState({ [KEY]: { pos: h.pos, id: h.id } }, '');
        pos = h.pos;
        open.push(h);
      });
    },

    // Steps back off the entry, along with those of anything opened over it
    // since (they close with it). Resolves once the history has landed, for a
    // caller about to reload. When something else's entry is on top (a page
    // opened over it), it's left for Back to step past.
    release() {
      h.queued = false;
      const i = open.indexOf(h);
      if (i < 0) return new Promise(whenSettled);
      const above = open.splice(i);
      if (entryOf(history.state)?.id === above[above.length - 1].id) goBack(above.length);
      return new Promise(whenSettled);
    },

    drop() {
      h.queued = false;
      const i = open.indexOf(h);
      if (i >= 0) open.splice(i, 1);
    },
  };
  return handle;
}

// After a drop() that turned out not to be followed by a navigation: the
// dropped entry is still the current one, and would make the next Back do
// nothing visible. Steps off it.
export function leaveStaleEntry() {
  const id = entryOf(history.state)?.id;
  if (id != null && !pendingBacks && !open.some(h => h.id === id)) goBack(1);
}

// A Vitrium alert, presented with Back as its cancel: the cancel action if it
// has one, the only action if that's all there is (an acknowledgement), else
// a plain dismiss. Resolves like present(), once the history has settled too.
export async function presentWithBack(alert, options) {
  const back = ownBack(() => {
    const buttons = [...alert.el.querySelectorAll('.lg-alert__action')];
    const cancel = buttons.find(b => b.dataset.role === 'cancel') ?? (buttons.length === 1 ? buttons[0] : null);
    if (cancel) cancel.click();
    else alert.dismiss();
  });
  back.push();
  try {
    return await alert.present(options);
  } finally {
    await back.release();
  }
}

// A Vitrium morph popup whose open/close the caller has no hook for (the list
// picker keeps them): followed through its trigger's aria-expanded, which the
// popup flips on open, close and destroy.
export function ownBackForTrigger(trigger, close) {
  const back = ownBack(close);
  new MutationObserver(() => {
    if (trigger.getAttribute('aria-expanded') === 'true') back.push();
    else back.release();
  }).observe(trigger, { attributes: true, attributeFilter: ['aria-expanded'] });
  return back;
}
