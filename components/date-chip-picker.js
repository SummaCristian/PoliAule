import { haptics, defaultPatterns } from './haptics.js';
import { t, getLocale, onLanguageSwitch } from '../i18n.js';

// <date-chip-picker> is a thin wrapper around the sliding date picker
// (components/date-picker.js), which stays completely untouched — its markup,
// its global stylesheet and its global selectors (#date-picker, #today-indicator,
// .date-picker-container) all keep working because this component uses NO shadow
// DOM; it just relocates the existing `.date-picker` subtree into a popup.
//
// Collapsed, the component is a glass pill built one-to-one like
// <campus-chip-picker>: a HugeIcons calendar glyph, a stacked label/value box
// ("DATE" over "Tue 15 Sept"), and a chevron. Tapped, the pill morphs into a
// popup holding a title and the sliding picker — same shell technique as
// campus-picker.js / time-picker.js.

const MORPH_MS = 420;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

export class DateChipPicker extends HTMLElement {
  #datePicker = null;      // the original .date-picker subtree (light DOM)
  #hiddenSelect = null;    // #date-picker <select>
  #trigger = null;
  #overlay = null;
  #popup = null;
  #inner = null;
  #valueMainEl = null;
  #valueMonthEl = null;
  #isOpen = false;
  #isAnimating = false;
  #preventScroll = null;
  #scrollLocked = false;
  // Bumped on every open/close so deferred callbacks from a superseded
  // transition (rAF steps, morph-end handlers, the post-close cleanup timer)
  // can detect they're stale and bail — otherwise a fast close→open tears the
  // freshly-opened popup back down.
  #seq = 0;
  #cleanupTimer = 0;
  #morphCleanup = null;

  connectedCallback() {
    if (this.#trigger) return; // already initialized (re-parenting, etc.)

    this.#datePicker = this.querySelector('.date-picker');
    this.#hiddenSelect = this.querySelector('#date-picker');
    if (!this.#datePicker) return;

    // ── Collapsed pill ────────────────────────────────────────────────
    this.#trigger = document.createElement('button');
    this.#trigger.type = 'button';
    this.#trigger.className = 'dcp-trigger liquid-glass';
    this.#trigger.setAttribute('aria-haspopup', 'dialog');
    this.#trigger.setAttribute('aria-expanded', 'false');
    this.#trigger.innerHTML = `
      <i class="hgi-stroke hgi-calendar-03 dcp-trigger__icon" aria-hidden="true"></i>
      <span class="dcp-trigger__box">
        <span class="dcp-trigger__label" data-i18n="datepicker.label">${t('datepicker.label')}</span>
        <span class="dcp-trigger__skeleton" aria-hidden="true"></span>
        <span class="dcp-trigger__value">
          <span class="dcp-trigger__value-main"></span>
          <span class="dcp-trigger__value-month"></span>
        </span>
      </span>
      <i class="hgi-stroke hgi-arrow-down-01 dcp-trigger__chevron" aria-hidden="true"></i>
    `;
    this.#valueMainEl = this.#trigger.querySelector('.dcp-trigger__value-main');
    this.#valueMonthEl = this.#trigger.querySelector('.dcp-trigger__value-month');

    // ── Overlay + morphing popup shell ───────────────────────────────
    this.#overlay = document.createElement('div');
    this.#overlay.className = 'dcp-overlay';
    this.#overlay.hidden = true;

    this.#popup = document.createElement('div');
    this.#popup.className = 'dcp-popup';
    this.#popup.setAttribute('role', 'dialog');
    this.#popup.setAttribute('aria-modal', 'true');
    this.#popup.tabIndex = -1;
    this.#popup.setAttribute('aria-label', t('datepicker.label'));
    this.#popup.innerHTML = `
      <div class="dcp-popup__inner">
        <div class="dcp-popup__title" aria-hidden="true">
          <i class="hgi-stroke hgi-calendar-03 dcp-popup__title-icon"></i>
          <span class="dcp-popup__title-text" data-i18n="datepicker.label">${t('datepicker.label')}</span>
        </div>
      </div>
    `;
    this.#inner = this.#popup.querySelector('.dcp-popup__inner');

    // Assemble. Everything stays inside this element (which lives inside the
    // <form>) so the hidden #date-picker <select> the sliding picker owns
    // remains a submittable form field. The popup/overlay are position:fixed,
    // so they still render against the viewport — same as <campus-chip-picker>,
    // whose fixed panel likewise lives in the form subtree.
    this.insertBefore(this.#trigger, this.#datePicker);
    this.#inner.appendChild(this.#datePicker);
    this.appendChild(this.#overlay);
    this.appendChild(this.#popup);

    // ── Wiring ──────────────────────────────────────────────────────
    this.#trigger.addEventListener('click', () => this.#toggle());
    this.#overlay.addEventListener('click', () => this.#close());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.#close();
    });
    this.#hiddenSelect?.addEventListener('change', () => this.#renderValue());
    onLanguageSwitch(() => {
      this.#popup.setAttribute('aria-label', t('datepicker.label'));
      this.#renderValue();
    });
    window.addEventListener('resize', () => {
      if (this.#isOpen && !this.#isAnimating) this.#applyGeometry(this.#panelTarget());
    });

    this.#renderValue();
  }

  // ── Collapsed value: "Tue 15" (bold) + "Sep" (regular), locale-aware ──
  #renderValue() {
    const raw = this.#hiddenSelect?.value;               // "YYYY-MM-DD"
    let date;
    if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      const [y, m, d] = raw.split('-').map(Number);
      date = new Date(y, m - 1, d);
    } else {
      date = new Date();
    }
    const locale = getLocale();
    const main = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric' }).format(date);
    const month = new Intl.DateTimeFormat(locale, { month: 'short' }).format(date);
    // Some locales (e.g. Italian) lowercase the weekday — force an initial cap.
    this.#valueMainEl.textContent = main.charAt(0).toLocaleUpperCase(locale) + main.slice(1);
    this.#valueMonthEl.textContent = month.replace(/\.$/, '');
  }

  // ── Geometry ────────────────────────────────────────────────────────
  #applyGeometry({ left, top, width, height, borderRadius }) {
    const s = this.#popup.style;
    s.left = `${left}px`;
    s.top = `${top}px`;
    s.width = `${width}px`;
    s.height = `${height}px`;
    s.borderRadius = borderRadius;
  }

  #triggerBox() {
    const r = this.#trigger.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height, borderRadius: '999px' };
  }

  // Final resting box — anchored locally to the trigger, same as
  // <campus-chip-picker>: top edge aligned with the trigger's top (so the pill
  // reads as growing downward into the panel) and left edge aligned with the
  // trigger's left, each only nudged inward to stay on-screen (floating-ui's
  // `shift`). Never re-centred on the viewport.
  #panelTarget() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const PAD = 8;
    const r = this.#trigger.getBoundingClientRect();
    const width = Math.min(24 * 16, vw - PAD * 2);

    const s = this.#popup.style;
    const prev = s.transition;
    s.transition = 'none';
    s.width = `${width}px`;
    s.height = 'auto';
    const height = Math.min(this.#inner.scrollHeight, vh - PAD * 2);
    s.transition = prev;

    const left = Math.max(PAD, Math.min(r.left, vw - width - PAD));
    const top = Math.max(PAD, Math.min(r.top, vh - height - PAD));
    return { left, top, width, height, borderRadius: '22px' };
  }

  #canMorph() {
    return !reduceMotion.matches;
  }

  // ── Open / close ────────────────────────────────────────────────────
  #toggle() {
    this.#isOpen ? this.#close() : this.#open();
  }

  // Invalidate every in-flight deferred step from the previous transition and
  // return this op's sequence id, which those steps re-check before running.
  #beginOp() {
    clearTimeout(this.#cleanupTimer);
    this.#cleanupTimer = 0;
    this.#clearMorphEnd();
    return ++this.#seq;
  }

  #open() {
    if (this.#isOpen) return;
    const seq = this.#beginOp();
    this.#isOpen = true;
    this.#isAnimating = true;
    this.#trigger.setAttribute('aria-expanded', 'true');
    haptics.trigger(defaultPatterns.light);
    this.#lockScroll();

    // A close may have got as far as tagging the shell/pill for its handoff.
    this.#popup.classList.remove('dcp-popup--closing');
    this.classList.remove('dcp-content-hidden');

    this.#overlay.hidden = false;
    this.#popup.style.display = 'flex';
    this.classList.add('dcp-anim');

    const target = this.#panelTarget();

    if (!this.#canMorph()) {
      this.#popup.style.transition = 'none';
      this.#applyGeometry(target);
      this.#overlay.classList.add('is-active');
      this.#popup.classList.add('dcp-popup--open');
      this.#isAnimating = false;
      this.#afterOpen();
      return;
    }

    // Snap onto the (now hidden) trigger, then transition to the panel box.
    this.#popup.style.transition = 'none';
    this.#applyGeometry(this.#triggerBox());
    this.#popup.getBoundingClientRect();              // force reflow
    this.#popup.style.transition = '';

    requestAnimationFrame(() => {
      if (seq !== this.#seq) return;
      this.#overlay.classList.add('is-active');
      this.#popup.classList.add('dcp-popup--open');
      this.#applyGeometry(target);
      this.#onMorphEnd(() => {
        if (seq !== this.#seq) return;
        this.#isAnimating = false;
        this.#afterOpen();
      });
    });
  }

  #afterOpen() {
    if (!this.#isOpen) return;
    // The sliding picker was display:none until now; its own ResizeObserver
    // (date-picker.js) fires on the reveal and repositions the indicator.
    this.#popup.focus?.({ preventScroll: true });
  }

  #close() {
    if (!this.#isOpen) return;
    const seq = this.#beginOp();
    this.#isOpen = false;
    this.#isAnimating = true;
    this.#trigger.setAttribute('aria-expanded', 'false');

    this.#popup.classList.remove('dcp-popup--open');
    this.#overlay.classList.remove('is-active');

    const clear = () => {
      if (seq !== this.#seq) return;
      this.#popup.classList.remove('dcp-popup--closing');
      this.#popup.style.display = 'none';
      this.#popup.style.transition = '';
      ['left', 'top', 'width', 'height', 'borderRadius'].forEach(p => { this.#popup.style[p] = ''; });
      this.#overlay.hidden = true;
      this.classList.remove('dcp-anim', 'dcp-content-hidden');
      this.#unlockScroll();
    };

    if (!this.#canMorph()) {
      this.#isAnimating = false;
      clear();
      return;
    }

    // A superseded open may have left transitions disabled — re-enable so the
    // return-morph always animates.
    this.#popup.style.transition = '';
    requestAnimationFrame(() => {
      if (seq !== this.#seq) return;
      this.#applyGeometry(this.#triggerBox());
      this.#onMorphEnd(() => {
        if (seq !== this.#seq) return;
        this.#isAnimating = false;
        // Hand the frame back to the pill: swap the identical glass box
        // instantly, fade the pill's contents in as the shell fades out.
        this.classList.remove('dcp-anim');
        this.classList.add('dcp-content-hidden');
        this.#popup.classList.add('dcp-popup--closing');
        this.#overlay.hidden = true;
        this.#unlockScroll();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (seq !== this.#seq) return;
          this.classList.remove('dcp-content-hidden');
        }));
        this.#cleanupTimer = setTimeout(clear, 240);
      });
    });
  }

  #onMorphEnd(cb) {
    this.#clearMorphEnd();
    const fallback = setTimeout(() => { this.#clearMorphEnd(); cb(); }, MORPH_MS + 60);
    const handler = (e) => {
      if (e.target !== this.#popup || e.propertyName !== 'height') return;
      this.#clearMorphEnd();
      cb();
    };
    this.#popup.addEventListener('transitionend', handler);
    this.#morphCleanup = () => {
      clearTimeout(fallback);
      this.#popup.removeEventListener('transitionend', handler);
      this.#morphCleanup = null;
    };
  }

  #clearMorphEnd() {
    this.#morphCleanup?.();
  }

  // ── Scroll lock ─────────────────────────────────────────────────────
  #lockScroll() {
    if (this.#scrollLocked) return;
    this.#scrollLocked = true;
    this.#preventScroll = (e) => {
      if (this.#inner.contains(e.target) && this.#inner.scrollHeight > this.#inner.clientHeight) return;
      e.preventDefault();
    };
    window.addEventListener('wheel', this.#preventScroll, { passive: false });
    window.addEventListener('touchmove', this.#preventScroll, { passive: false });
  }

  #unlockScroll() {
    if (!this.#scrollLocked) return;
    this.#scrollLocked = false;
    window.removeEventListener('wheel', this.#preventScroll);
    window.removeEventListener('touchmove', this.#preventScroll);
    this.#preventScroll = null;
  }
}

customElements.define('date-chip-picker', DateChipPicker);
