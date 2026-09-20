import { t, onLanguageSwitch } from '../i18n.js';
import { createTimeFormatter } from '../utils/time-format.js';
import { ChipShell } from './chip-shell.js';

// <time-range-chip-picker> is a thin wrapper around the drag-based time range
// slider (components/time-range-slider.js), which stays completely untouched.
//
// The pill, the morph and the panel are Vitrium's chip picker (see
// chip-shell.js, which also handles the docked desktop mode). This element adds
// the collapsed range label ("9:15 – 11:15").
//
// The two native <input type="time"> fields (#from-time-picker / #to-time-picker)
// stay direct children of this element so they remain submittable fields inside
// the <form>; only the visual .trs-wrapper is relocated into the panel.
export class TimeRangeChipPicker extends HTMLElement {
  #container = null;       // .time-pickers-container (holds the native inputs)
  #fromInput = null;
  #toInput = null;
  #shell = null;
  #body = null;            // where the slider is mounted (see getMountPoint)
  #valueFromEl = null;
  #valueToEl = null;
  #slider = null;          // the .trs-wrapper element, set via setSlider()

  connectedCallback() {
    if (this.#shell) return; // already initialized (re-parenting, etc.)

    this.#container = this.querySelector('.time-pickers-container');
    this.#fromInput = this.querySelector('#from-time-picker');
    this.#toInput = this.querySelector('#to-time-picker');
    if (!this.#container) return;

    this.#body = document.createElement('div');
    this.#body.className = 'trc-content';

    this.#shell = new ChipShell(this, {
      icon: 'hgi-clock-01',
      labelKey: 'timepicker.timeLabel',
      width: 26 * 16,
      body: this.#body,
      title: false,                    // the slider brings its own title row
      exclude: '.trs-bar-wrapper',     // the bar, handles and Now badge track the pointer
      deformFrom: '.trs-title',
      onBuild: (chip) => this.#onBuild(chip),
      // The slider had no layout while its panel was hidden.
      onShow: () => this.#slider?._render?.(),
    });

    this.#fromInput?.addEventListener('input', () => this.#renderValue());
    this.#toInput?.addEventListener('input', () => this.#renderValue());
    window.addEventListener('timeformatchange', () => this.#renderValue());
    window.addEventListener('resize', () => this.#slider?._render?.());
    onLanguageSwitch(() => this.retranslate());
  }

  // Desktop docking, toggled by picker-dock.js.
  setDocked(on) {
    this.#shell?.setDocked(on);
  }

  #onBuild(chip) {
    const value = chip.trigger.querySelector('.lg-chip__value');
    value.classList.add('trc-value');
    value.innerHTML = `
      <span class="chip-skeleton trc-skeleton" aria-hidden="true"></span>
      <span class="trc-value__from"></span>
      <span class="trc-value__sep" aria-hidden="true">–</span>
      <span class="trc-value__to"></span>`;
    this.#valueFromEl = value.querySelector('.trc-value__from');
    this.#valueToEl = value.querySelector('.trc-value__to');
    this.#renderValue();
  }

  // Called by initTimeRangeSlider() once the .trs-wrapper is built, to keep a
  // handle for on-show re-rendering. (The slider is already mounted in the body,
  // see getMountPoint.)
  setSlider(wrapper) {
    this.#slider = wrapper;
    this.removeAttribute('data-loading');
    this.#renderValue();
    requestAnimationFrame(() => wrapper?._render?.());
  }

  // The mount point initTimeRangeSlider() should append the slider into when
  // this component is present (falls back to .time-pickers-container otherwise).
  getMountPoint() {
    return this.#body;
  }

  #formatTime(val) {
    if (!val || !/^\d{2}:\d{2}$/.test(val)) return '--:--';
    const [h, m] = val.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return createTimeFormatter({ hour: 'numeric', minute: '2-digit' }).format(d);
  }

  #renderValue() {
    if (!this.#valueFromEl) return;
    this.#valueFromEl.textContent = this.#formatTime(this.#fromInput?.value);
    this.#valueToEl.textContent = this.#formatTime(this.#toInput?.value);
  }

  // Re-apply locale-dependent text: the panel aria-label, the pill label, the
  // slider's own title, and the formatted time values.
  retranslate() {
    if (!this.#shell) return;
    this.#shell.retranslate();
    const titleText = this.#body.querySelector('.trs-title-text');
    if (titleText) titleText.textContent = t('timepicker.timeLabel');
    this.#renderValue();
  }
}

customElements.define('time-range-chip-picker', TimeRangeChipPicker);
