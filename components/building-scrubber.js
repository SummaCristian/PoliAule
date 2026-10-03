import { Spring, onSpringFrame } from 'vitrium';
import { t } from '../i18n.js';
import { escapeHtml } from '../utils/html.js';
import { scrollerFor, stickyTopOf } from '../utils/results-scroller.js';
import { buildingOverview } from './building-overview.js';

// The building scrubber: press and hold a building's name pill in the
// Available results, then drag up or down without lifting the finger. The pill
// grows into a glass column listing every building in the results, placed so
// the one you're holding sits under your finger; the row under the finger is
// picked, and letting go jumps the list to that building. The panel then
// shrinks into the destination's (sticky) name pill, which lands where the
// one you grabbed was.
//
// A plain tap on the pill still opens the building overview (script.js).
// Nothing is gated on touch; with a mouse it's press, hold and drag.
//
// It arms on a hold, not on any drag, because a drag on the pill is already
// Vitrium's liquid-glass stretch. The pill can't scroll the page as things
// are (Vitrium gives `.liquid-glass` `touch-action: none`); the non-passive
// touchmove listener below keeps it that way during a scrub even if that
// changes, since a hold means no scroll has started yet.

const HOLD_MS = 280;     // press this long, without moving, to arm
const SLOP = 8;          // px of movement that turns the hold into a scroll
const ROW = 40;          // px per building row, and per row of finger travel
const PAD = 6;           // panel's inner padding
const EDGE = 56;         // px from the band's edge where the list auto-scrolls
const EDGE_SPEED = 900;  // px/s of auto-scroll at the very edge
const HYSTERESIS = 0.12; // rows past a boundary before the pick changes
const OPEN_MS = 300;
const CLOSE_MS = 280;
const EASE_OUT = 'cubic-bezier(0.32, 0.72, 0, 1)';
const PANEL_RADIUS = 22;

// The lens and the panel react like the hour lens's glass (hour-lens.js):
// the lens lifts while held, stretches along its motion and squashes across
// it, and leans toward the finger between rows; the panel stretches toward a
// finger pulled past its first or last building, and springs back.
const LIFT_X = 4, LIFT_Y = 2;  // px the lens grows by, each side, when lifted
const STRETCH_MAX = 8;         // px of speed stretch, at most
const LEAN_GIVE = 7;           // px the lens can lean off its row
const LIFT_IN = { stiffness: 500, damping: 25, mass: 0.5 };
const LIFT_OUT = { stiffness: 350, damping: 30, mass: 0.8 };
const MOVE = { stiffness: 400, damping: 35, mass: 0.8 };
const FOLLOW = { stiffness: 1000, damping: 70, mass: 0.5 };
const PULL_BACK = { stiffness: 300, damping: 16, mass: 0.8 };
const rubber = (x, give) => (x * give) / (give + Math.abs(x));

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// One scrub at a time, whichever pill started it.
let active = null;

// Tears down a running scrub without navigating (the results were re-rendered
// underneath it).
export function cancelBuildingScrubber() {
  active?.destroy();
}

// Wires the scrubber to one building's name pill. `consumed` is true while a
// scrub runs and briefly after it ends: the pill's own tap handlers check it,
// so the release doesn't also open the building overview.
export function attachBuildingScrubber(pill, section) {
  let pointerId = null;
  let startX = 0, startY = 0;
  let downStamp = 0;
  let holdTimer = 0;
  let session = null;
  // This press became a scrub: its release and click aren't a tap. Holds from
  // the arm until shortly after the release (just long enough for the click
  // that follows it), and a new press always clears it.
  let owned = false;
  let releasedAt = Infinity;
  const consumed = () => owned && performance.now() - releasedAt < 300;
  const endGesture = () => { if (owned && releasedAt === Infinity) releasedAt = performance.now(); };

  const cancelHold = () => {
    clearTimeout(holdTimer);
    holdTimer = 0;
  };

  pill.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    owned = false;
    if (active || holdTimer) return;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    downStamp = e.timeStamp;
    holdTimer = setTimeout(() => {
      holdTimer = 0;
      session = Scrub.start({ pill, section, pointerId, y: startY });
      if (!session) return;
      owned = true;
      releasedAt = Infinity;
      session.onEnd = () => { session = null; };
    }, HOLD_MS);
  });

  pill.addEventListener('pointermove', (e) => {
    if (e.pointerId !== pointerId) return;
    if (holdTimer) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) > SLOP) cancelHold();
      return;
    }
    session?.move(e.clientY);
  });

  pill.addEventListener('pointerup', (e) => {
    if (e.pointerId !== pointerId) return;
    cancelHold();
    // The finger left before the hold time, by the events' own clocks: a
    // tap, even if a busy main thread ran the hold timer before this event.
    // Put the scrubber away and let the tap through to the pill.
    if (session && owned && e.timeStamp - downStamp < HOLD_MS) {
      owned = false;
      session.release({ cancel: true });
      return;
    }
    endGesture();
    session?.release();
  });

  pill.addEventListener('pointercancel', (e) => {
    if (e.pointerId !== pointerId) return;
    cancelHold();
    endGesture();
    session?.release({ cancel: true });
  });

  // Holds the page still while scrubbing. Must be registered up front, and
  // non-passive: a listener added mid-gesture gets uncancelable events.
  pill.addEventListener('touchmove', (e) => {
    if (owned && releasedAt === Infinity && e.cancelable) e.preventDefault();
  }, { passive: false });

  // The release has already acted: don't let its click reach whatever is
  // under the finger now (see the building header's tap in script.js).
  pill.addEventListener('touchend', (e) => {
    if (consumed() && e.cancelable) e.preventDefault();
  }, { passive: false });

  // Android's long-press menu / iOS's callout would fire mid-hold.
  pill.addEventListener('contextmenu', (e) => {
    if (holdTimer || consumed()) e.preventDefault();
  });

  return {
    get consumed() { return consumed(); },
  };
}

class Scrub {
  static start({ pill, section, pointerId, y }) {
    const list = section.closest('.list-outer-container');
    if (!list || !section.isConnected) return null;
    // Only what's actually showing (the partial-free filter hides some).
    const sections = [...list.children].filter(
      s => s.classList.contains('building-section') && s.getClientRects().length > 0
    );
    const start = sections.indexOf(section);
    if (sections.length < 2 || start < 0) return null;
    buildingOverview.cancelPrewarm();
    return new Scrub({ pill, sections, start, pointerId, y });
  }

  onEnd = null;
  #pill; #sections; #start; #index;
  #root; #scrim; #panel; #clip; #rows; #lens; #rowEls;
  #anchorY = 0;          // finger's y at arm: the start row is centred on it
  #fingerY = 0;
  #shift = 0;            // auto-scroll offset of the rows (px, + = down)
  #shiftMin = 0; #shiftMax = 0;
  #bandTop = 0; #bandBottom = 0;
  #left = 0; #width = 0;
  #zoneTop = 0; #zoneBottom = 0;
  #raf = 0; #lastT = 0;
  #openAnims = [];
  #closing = false;
  #onResize = () => this.release({ cancel: true });

  // Glass physics (see #render)
  #pos = new Spring(0);  // lens y within the rows, px
  #lift = new Spring(0); // 0 resting … 1 lifted
  #pull = new Spring(0); // panel stretch past the ends, px (+ = down)
  #offFrame = null;
  #lastFrameT = 0; #lastPos = 0; #smooth = 0;
  #lensW = 0; #panelH = 0;

  constructor({ pill, sections, start, pointerId, y }) {
    active = this;
    this.#pill = pill;
    this.#sections = sections;
    this.#start = this.#index = start;
    this.#anchorY = this.#fingerY = y;

    try { pill.setPointerCapture(pointerId); } catch { /* touch has implicit capture */ }

    this.#build();
    this.#measure();
    this.#layout();
    this.#open();

    this.#lensW = this.#width - PAD * 2;
    this.#pos.set(start * ROW);
    this.#lastPos = start * ROW;
    this.#offFrame = onSpringFrame(() => this.#render());
    this.#lift.to(1, LIFT_IN);

    window.addEventListener('resize', this.#onResize);
    const tick = (now) => {
      this.#autoScroll(now);
      this.#raf = requestAnimationFrame(tick);
    };
    this.#raf = requestAnimationFrame(tick);
  }

  move(y) {
    if (this.#closing) return;
    this.#fingerY = y;
    this.#pick();
  }

  // Let go: jump to the picked building, or put things back if it's the one
  // we started on (or the gesture was cancelled).
  release({ cancel = false } = {}) {
    if (this.#closing) return;
    this.#closing = true;
    cancelAnimationFrame(this.#raf);
    window.removeEventListener('resize', this.#onResize);
    // Set the glass down: the lens settles onto its row, the panel unstretches.
    this.#lift.to(0, LIFT_OUT);
    this.#pos.to(this.#index * ROW, MOVE);
    this.#pull.to(0, PULL_BACK);

    const target = this.#sections[this.#index];
    const navigate = !cancel && this.#index !== this.#start && target?.isConnected;
    if (!navigate) {
      this.#close(this.#pill);
      return;
    }

    const container = target.closest('#available-classrooms-results');
    const scroller = scrollerFor(container, stickyTopOf(target));
    scroller.scrollBy(target.getBoundingClientRect().top - scroller.visibleTop());
    // Cards that had never rendered swap their content-visibility placeholder
    // size for their real one once they're on screen; settle once more after
    // that layout, then shrink into the destination pill where it really is.
    requestAnimationFrame(() => {
      if (!target.isConnected) { this.#close(null); return; }
      const off = target.getBoundingClientRect().top - scroller.visibleTop();
      if (Math.abs(off) > 1) scroller.scrollBy(off);
      this.#close(target.querySelector('.building-section-titles'));
    });
  }

  // Instant teardown, no animation.
  destroy() {
    cancelAnimationFrame(this.#raf);
    window.removeEventListener('resize', this.#onResize);
    this.#closing = true;
    this.#finish();
  }

  // ── DOM ─────────────────────────────────────────────────────────────

  #build() {
    const hidePartial = !!this.#sections[0].closest('.hide-partial');
    const rowsHtml = this.#sections.map((sec, i) => {
      const name = sec.dataset.buildingName ?? '';
      const alt = sec.querySelector('.building-alt-name')?.textContent ?? '';
      const rooms = sec.querySelectorAll(
        hidePartial
          ? '.classroom-list-item-container:not([data-status="partially-free"])'
          : '.classroom-list-item-container'
      ).length;
      return `
        <div class="bscrub-row${i === this.#start ? ' is-active' : ''}">
          <span class="bscrub-name">${escapeHtml(t('building.prefix'))} ${escapeHtml(name)}</span>
          ${alt ? `<span class="bscrub-alt">${escapeHtml(alt)}</span>` : ''}
          <span class="bscrub-count">${rooms}</span>
        </div>`;
    }).join('');

    const root = document.createElement('div');
    root.className = 'bscrub';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = `
      <div class="bscrub-scrim"></div>
      <div class="bscrub-panel lg-glass">
        <div class="bscrub-clip">
          <div class="bscrub-rows">
            <div class="bscrub-lens"></div>
            ${rowsHtml}
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    this.#root = root;
    this.#scrim = root.querySelector('.bscrub-scrim');
    this.#panel = root.querySelector('.bscrub-panel');
    this.#clip = root.querySelector('.bscrub-clip');
    this.#rows = root.querySelector('.bscrub-rows');
    this.#lens = root.querySelector('.bscrub-lens');
    this.#rowEls = [...this.#rows.querySelectorAll('.bscrub-row')];
    this.#rows.style.setProperty('--row', `${ROW}px`);
    this.#panel.style.setProperty('--pad', `${PAD}px`);
    this.#lens.style.transform = `translateY(${this.#start * ROW}px)`;
  }

  // One frame of the glass, run by Vitrium's spring loop while anything moves.
  #render() {
    const now = performance.now();
    const gap = now - this.#lastFrameT;
    this.#lastFrameT = now;
    const pos = this.#pos.value;
    if (gap > 100 || gap <= 0) { this.#lastPos = pos; this.#smooth = 0; }
    const v = (pos - this.#lastPos) / Math.min(Math.max(gap, 1), 64); // px/ms
    this.#lastPos = pos;

    // Squash and stretch from speed, in px; gone once the lens has landed.
    const target = this.#pos.resting ? 0 : Math.min(Math.abs(v) * 14, STRETCH_MAX);
    this.#smooth += (target - this.#smooth) * 0.3;
    if (this.#smooth < 0.05) this.#smooth = 0;

    const l = Math.max(0, this.#lift.value);
    const sx = 1 + (2 * LIFT_X * l - 0.5 * this.#smooth) / this.#lensW;
    const sy = 1 + (2 * LIFT_Y * l + this.#smooth) / ROW;
    this.#lens.style.transform = `translateY(${pos}px) scale(${sx}, ${sy})`;

    // The panel: the leading edge follows the pull, the trailing one lags, so
    // it stretches toward the finger like the pill's own liquid glass.
    const p = this.#pull.value;
    const ps = this.#panel.style;
    if (Math.abs(p) < 0.05) {
      ps.translate = ''; ps.scale = '';
    } else {
      ps.translate = `0 ${(p * 0.5).toFixed(2)}px`;
      const k = Math.abs(p);
      ps.scale = `${(1 - (0.3 * k) / this.#width).toFixed(4)} ${(1 + (0.5 * k) / this.#panelH).toFixed(4)}`;
    }
  }

  // Band the panel may use, its width, and how far the rows can auto-scroll.
  #measure() {
    const cs = getComputedStyle(this.#root);
    const vw = document.documentElement.clientWidth;
    this.#bandTop = parseFloat(cs.paddingTop) || 12;
    this.#bandBottom = window.innerHeight - (parseFloat(cs.paddingBottom) || 12);
    // Stay clear of the tab bar when it's a row along the bottom.
    const nav = document.getElementById('bn-wrapper');
    const bar = nav?.querySelector('.lg-tabbar__bar');
    if (bar && !nav.classList.contains('lg-tabbar--vertical')) {
      const barTop = bar.getBoundingClientRect().top;
      if (barTop > this.#anchorY) this.#bandBottom = Math.min(this.#bandBottom, barTop - 10);
    }

    // The pill is mid press-scale: take its untransformed size about its centre.
    const pr = this.#pillRect(this.#pill);
    this.#rows.classList.add('is-measuring');
    const natural = this.#rows.scrollWidth + PAD * 2;
    this.#rows.classList.remove('is-measuring');
    const maxW = vw - 24;
    this.#width = Math.min(maxW, Math.max(pr.width, natural));
    this.#left = Math.min(Math.max(12, pr.left), vw - 12 - this.#width);

    const n = this.#sections.length;
    const top0 = this.#anchorY - (this.#start + 0.5) * ROW; // row 0's top, unshifted
    this.#shiftMax = Math.max(0, this.#bandTop + PAD - top0);
    this.#shiftMin = Math.min(0, this.#bandBottom - PAD - (top0 + n * ROW));
    // Auto-scroll zones start at the band's edge, but never at the finger's
    // own starting point: a pill near the top would otherwise scroll at once.
    this.#zoneTop = Math.min(this.#bandTop + EDGE, this.#anchorY - ROW / 2);
    this.#zoneBottom = Math.max(this.#bandBottom - EDGE, this.#anchorY + ROW / 2);
  }

  #pillRect(pill) {
    const r = pill.getBoundingClientRect();
    const w = pill.offsetWidth, h = pill.offsetHeight;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    return { left: cx - w / 2, top: cy - h / 2, width: w, height: h };
  }

  // Current panel rect: the rows' extent, cut to the band.
  #panelRect() {
    const rowsTop = this.#anchorY - (this.#start + 0.5) * ROW + this.#shift;
    const top = Math.max(this.#bandTop, rowsTop - PAD);
    const bottom = Math.min(this.#bandBottom, rowsTop + this.#sections.length * ROW + PAD);
    return { left: this.#left, top, width: this.#width, height: bottom - top, rowsTop };
  }

  #layout() {
    const r = this.#panelRect();
    const s = this.#panel.style;
    s.left = `${r.left}px`;
    s.top = `${r.top}px`;
    s.width = `${r.width}px`;
    s.height = `${r.height}px`;
    this.#panelH = r.height;
    this.#rows.style.transform = `translateY(${r.rowsTop - r.top}px)`;
    this.#clip.classList.toggle('is-cut-top', r.rowsTop < r.top + PAD - 0.5);
    this.#clip.classList.toggle(
      'is-cut-bottom', r.rowsTop + this.#sections.length * ROW > r.top + r.height - PAD + 0.5);
  }

  // ── Picking ─────────────────────────────────────────────────────────

  #pick() {
    const rowsTop = this.#anchorY - (this.#start + 0.5) * ROW + this.#shift;
    const n = this.#sections.length;
    const pos = (this.#fingerY - rowsTop) / ROW - 0.5; // fractional row under the finger
    if (Math.abs(pos - this.#index) >= 0.5 + HYSTERESIS) {
      const next = Math.max(0, Math.min(n - 1, Math.round(pos)));
      if (next !== this.#index) {
        this.#rowEls[this.#index].classList.remove('is-active');
        this.#rowEls[next].classList.add('is-active');
        this.#index = next;
      }
    }
    // The lens sits on its row but leans toward the finger, with a rubbery
    // give, so it reads as held rather than stepped.
    const lean = rubber((pos - this.#index) * ROW, LEAN_GIVE);
    this.#pos.to(this.#index * ROW + lean, MOVE);

    // Pulled past the first or last building, with nothing left to auto-scroll
    // into: stretch the panel toward the finger (Vitrium's liquid-glass falloff).
    let over = 0;
    if (!reduceMotion.matches) {
      if (this.#fingerY < rowsTop && this.#shift >= this.#shiftMax) over = this.#fingerY - rowsTop;
      else if (this.#fingerY > rowsTop + n * ROW && this.#shift <= this.#shiftMin) over = this.#fingerY - (rowsTop + n * ROW);
    }
    const give = Math.sign(over) * 16 * Math.log1p(Math.abs(over) / 16);
    this.#pull.to(give, over ? FOLLOW : PULL_BACK);
  }

  // With the finger held near the band's top or bottom edge and more
  // buildings beyond it, slide the rows under the finger.
  #autoScroll(now) {
    const dt = this.#lastT ? Math.min(0.05, (now - this.#lastT) / 1000) : 0;
    this.#lastT = now;
    const y = this.#fingerY;
    let v = 0;
    if (y < this.#zoneTop && this.#shift < this.#shiftMax) {
      v = EDGE_SPEED * Math.min(1, (this.#zoneTop - y) / EDGE) ** 2;
    } else if (y > this.#zoneBottom && this.#shift > this.#shiftMin) {
      v = -EDGE_SPEED * Math.min(1, (y - this.#zoneBottom) / EDGE) ** 2;
    }
    if (!v || !dt) return;
    this.#shift = Math.max(this.#shiftMin, Math.min(this.#shiftMax, this.#shift + v * dt));
    this.#layout();
    this.#pick();
  }

  // ── Motion ──────────────────────────────────────────────────────────

  // The panel grows out of the pill; the rows fade in as it does.
  #open() {
    this.#pill.classList.add('bscrub-source');
    if (reduceMotion.matches) {
      this.#openAnims = [this.#root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150 })];
      return;
    }
    const from = this.#pillRect(this.#pill);
    const to = this.#panelRect();
    this.#openAnims = [
      this.#panel.animate([
        { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, borderRadius: `${from.height / 2}px` },
        { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, borderRadius: `${PANEL_RADIUS}px` },
      ], { duration: OPEN_MS, easing: EASE_OUT }),
      this.#clip.animate(
        [{ opacity: 0 }, { opacity: 0, offset: 0.15 }, { opacity: 1 }],
        { duration: OPEN_MS * 0.8, easing: 'ease-out' }),
      this.#scrim.animate([{ opacity: 0 }, { opacity: 1 }], { duration: OPEN_MS, easing: 'ease-out' }),
    ];
  }

  // Shrinks into `pill` (null: just fade) and fades everything out.
  #close(pill) {
    this.#openAnims.forEach(a => a.cancel());
    this.#pill.classList.remove('bscrub-source');
    const opts = { duration: CLOSE_MS, easing: EASE_OUT, fill: 'forwards' };
    let anims;
    if (reduceMotion.matches || !pill) {
      anims = [this.#root.animate([{ opacity: 1 }, { opacity: 0 }], { ...opts, duration: 150 })];
    } else {
      const from = this.#panelRect();
      const to = this.#pillRect(pill);
      anims = [
        this.#panel.animate([
          { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, borderRadius: `${PANEL_RADIUS}px`, opacity: 1 },
          { opacity: 1, offset: 0.6 },
          { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, borderRadius: `${to.height / 2}px`, opacity: 0 },
        ], opts),
        this.#clip.animate([{ opacity: 1 }, { opacity: 0, offset: 0.35 }, { opacity: 0 }], opts),
        this.#scrim.animate([{ opacity: 1 }, { opacity: 0 }], opts),
      ];
    }
    let done = false;
    const finish = () => { if (!done) { done = true; this.#finish(); } };
    Promise.all(anims.map(a => a.finished)).then(finish, finish);
    // iOS Safari sometimes never resolves `.finished` (see building-overview.js).
    setTimeout(finish, CLOSE_MS + 150);
  }

  #finish() {
    this.#openAnims.forEach(a => a.cancel());
    this.#offFrame?.();
    this.#offFrame = null;
    for (const s of [this.#pos, this.#lift, this.#pull]) s.dispose();
    this.#pill.classList.remove('bscrub-source');
    this.#root?.remove();
    if (active === this) active = null;
    const cb = this.onEnd;
    this.onEnd = null;
    cb?.();
  }
}
