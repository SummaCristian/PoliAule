import { t, getLocale, onLanguageSwitch } from '../i18n.js';
import { ChipShell } from './chip-shell.js';

// <date-chip-picker> is a thin wrapper around the sliding date picker
// (components/date-picker.js), which stays completely untouched: its markup, its
// global stylesheet and its global selectors (#date-picker, #today-indicator,
// .date-picker-container) keep working because this component uses NO shadow
// DOM; it just relocates the existing `.date-picker` subtree into a panel.
//
// The pill, the morph and the panel are Vitrium's chip picker (see
// chip-shell.js, which also handles the docked desktop mode). This element adds
// the collapsed date label ("Tue 15" over "Sep") and the "Today" badge.
export class DateChipPicker extends HTMLElement {
  #datePicker = null;      // the original .date-picker subtree (light DOM)
  #hiddenSelect = null;    // #date-picker <select>
  #shell = null;
  #valueMainEl = null;
  #valueMonthEl = null;
  #todayBadgeEl = null;
  #trigger = null;

  connectedCallback() {
    if (this.#shell) return; // already initialized (re-parenting, etc.)

    this.#datePicker = this.querySelector('.date-picker');
    this.#hiddenSelect = this.querySelector('#date-picker');
    if (!this.#datePicker) return;

    // The hidden #date-picker <select> stays a direct child of this element
    // (still inside the <form>) so it remains a submittable field once the rest
    // of .date-picker moves away.
    if (this.#hiddenSelect) this.insertBefore(this.#hiddenSelect, this.#datePicker);

    const body = document.createElement('div');
    body.className = 'dcp-content';
    body.appendChild(this.#datePicker);

    this.#shell = new ChipShell(this, {
      icon: 'hgi-calendar-03',
      labelKey: 'datepicker.label',
      width: 24 * 16,
      body,
      exclude: '.date-picker',
      onBuild: (chip) => this.#onBuild(chip),
    });

    this.#hiddenSelect?.addEventListener('change', () => this.#renderValue());
    onLanguageSwitch(() => this.retranslate());
    this.#renderValue();
  }

  // Desktop docking, toggled by picker-dock.js.
  setDocked(on) {
    this.#shell?.setDocked(on);
    // The sliding picker had no layout while it was hidden; date-picker.js's own
    // ResizeObserver on .date-picker fires on the reveal, nudge it too.
    if (on) window.dispatchEvent(new Event('resize'));
  }

  // The chip was (re)built: fill its value slot and add the Today badge.
  #onBuild(chip) {
    this.#trigger = chip.trigger;
    const value = chip.trigger.querySelector('.lg-chip__value');
    value.classList.add('dcp-value');
    value.innerHTML = `
      <span class="chip-skeleton dcp-skeleton" aria-hidden="true"></span>
      <span class="dcp-value__main"></span>
      <span class="dcp-value__month"></span>`;
    this.#valueMainEl = value.querySelector('.dcp-value__main');
    this.#valueMonthEl = value.querySelector('.dcp-value__month');

    const badge = document.createElement('span');
    badge.className = 'dcp-today-badge';
    badge.dataset.i18n = 'datepicker.today';
    badge.textContent = t('datepicker.today');
    badge.hidden = true;
    chip.trigger.appendChild(badge);
    this.#todayBadgeEl = badge;

    this.#renderValue();
  }

  // ── Collapsed value: "Tue 15" (bold) + "Sep" (regular), locale-aware ──
  #renderValue() {
    if (!this.#valueMainEl) return;
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
    // Some locales (e.g. Italian) lowercase the weekday/month, so force an initial cap.
    const cap = s => s.charAt(0).toLocaleUpperCase(locale) + s.slice(1);
    this.#valueMainEl.textContent = cap(main);
    this.#valueMonthEl.textContent = cap(month.replace(/\.$/, ''));

    // "Today" badge + subtle accent tint on the glass when the selected day is today.
    const now = new Date();
    const isToday = date.getFullYear() === now.getFullYear()
      && date.getMonth() === now.getMonth()
      && date.getDate() === now.getDate();
    this.#todayBadgeEl.hidden = !isToday;
    this.#trigger.classList.toggle('dcp-trigger--today', isToday);
  }

  // Re-apply locale-dependent, JS-built text: the panel's aria-label and the
  // collapsed date label (formatted via Intl in #renderValue). Called on
  // language switch and once from script.js after i18n finishes loading:
  // connectedCallback runs at module-eval time, before initI18n() resolves, so
  // the first #renderValue() would otherwise be stuck in the default locale.
  retranslate() {
    if (!this.#shell) return; // never initialized (no .date-picker subtree)
    this.#shell.retranslate();
    this.#renderValue();
  }
}

customElements.define('date-chip-picker', DateChipPicker);
