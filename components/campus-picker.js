import { haptics, defaultPatterns } from './haptics.js';
import { t } from '../i18n.js';

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
  <link rel="stylesheet" href="https://cdn.hugeicons.com/font/hgi-stroke-rounded.css">
  <link rel="stylesheet" href="./components/campus-picker.css">
  <select class="campus-select" aria-label="Campus"></select>
  <div class="campus-select-skeleton" aria-hidden="true"></div>
`;

// Custom trigger markup — only injected when base-select is supported, so
// non-supporting engines get a clean bare <select> with no stray button text.
// The .campus-select__label text is filled in from i18n after insertion.
const BUTTON_HTML = `
  <button type="button">
    <i class="hgi-stroke hgi-university campus-select__icon" aria-hidden="true"></i>
    <span class="campus-select__box">
      <span class="campus-select__label"></span>
      <selectedcontent class="campus-select__value"></selectedcontent>
    </span>
    <i class="hgi-stroke hgi-arrow-down-01 campus-select__chevron" aria-hidden="true"></i>
  </button>
`;

const SUPPORTS_BASE_SELECT =
  typeof CSS !== 'undefined' && CSS.supports?.('appearance', 'base-select');

// <campus-chip-picker> wraps a customizable native <select> (appearance:
// base-select) in a shadow root so its markup/CSS stays isolated. In browsers
// that support base-select (Chromium, Safari/iOS 27+) the ::picker(select)
// popover is fully styled; older engines fall back to the platform's native
// select control, which still renders the <optgroup> section headers and the
// per-option text (see the plain-text `label` set on every <option>).
//
// Form-association can't reach into the shadow root, so the real form field
// stays a hidden <input> in the light DOM (declared in index.html); the
// <select> is mirrored onto it on every change, exactly like the old picker.
export class CampusChipPicker extends HTMLElement {
  #select = null;
  #hiddenInput = null;

  connectedCallback() {
    if (this.shadowRoot) return; // already initialized (re-parenting, etc.)
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.appendChild(TEMPLATE.content.cloneNode(true));
    this.#select = shadow.querySelector('.campus-select');
    if (SUPPORTS_BASE_SELECT) this.#select.insertAdjacentHTML('afterbegin', BUTTON_HTML);
    this.#hiddenInput = this.querySelector('input[type="hidden"]');
  }

  // Programmatically selects a campus by ID. No-op if the ID isn't available.
  selectCampusById(id, _animate = true) {
    const select = this.#select;
    if (!select || !select.querySelector(`option[value="${CSS.escape(id)}"]`)) return;
    if (select.value === id) return;
    select.value = id;
    select.dispatchEvent(new Event('change'));
  }

  // Re-applies translations that live inside the shadow root (the "Other
  // cities" section header). Called on language switch from script.js.
  retranslate() {
    const legend = this.#select?.querySelector('optgroup[data-i18n] legend');
    if (legend) legend.textContent = t(legend.parentElement.dataset.i18n);
    const og = legend?.parentElement;
    if (og) og.label = legend.textContent; // keep native-fallback label in sync
    const label = this.shadowRoot?.querySelector('.campus-select__label');
    if (label) label.textContent = t('tabs.campus');
  }

  // Builds the option list from the static campus data, keeping only campuses
  // that actually have buildings.
  setup(staticData) {
    const select = this.#select;
    const hiddenInput = this.#hiddenInput;
    if (!select) return;

    // Set here rather than in connectedCallback: i18n isn't loaded that early.
    const label = this.shadowRoot?.querySelector('.campus-select__label');
    if (label) label.textContent = t('tabs.campus');

    select.querySelectorAll('optgroup').forEach(el => el.remove());

    const available = staticData.filter(c => c.buildings.length > 0);

    // Group by city, then split: cities that contain a grouped campus (Milano:
    // Città Studi / Bovisa) get their own section; standalone single-campus
    // cities are collected under "Other cities".
    const byCity = new Map();
    for (const campus of available) {
      if (!byCity.has(campus.city)) byCity.set(campus.city, []);
      byCity.get(campus.city).push(campus);
    }

    const mainCities = [];
    const otherCampuses = [];
    for (const [city, list] of byCity) {
      if (list.some(c => c.group)) mainCities.push([city, list]);
      else otherCampuses.push(...list);
    }

    const makeOption = (campus) => {
      const opt = document.createElement('option');
      opt.value = campus.id;
      // Plain-text label for the native fallback only (just the campus name —
      // the native control is single-line). When base-select is active a
      // `label` attribute would make the picker render that text instead of
      // the two-line child markup below, so it's left unset there.
      if (!SUPPORTS_BASE_SELECT) opt.label = campus.name;

      const check = document.createElement('i');
      check.className = 'hgi-stroke hgi-tick-02 campus-option__check';
      check.setAttribute('aria-hidden', 'true');
      opt.appendChild(check);

      const text = document.createElement('span');
      text.className = 'campus-option__text';

      const name = document.createElement('span');
      name.className = 'campus-option__name';
      name.textContent = campus.name;
      text.appendChild(name);

      if (campus.group) {
        const area = document.createElement('span');
        area.className = 'campus-option__area';
        area.textContent = campus.group;
        text.appendChild(area);
      }

      opt.appendChild(text);
      return opt;
    };

    const makeGroup = (labelText) => {
      const og = document.createElement('optgroup');
      og.label = labelText; // native fallback
      const legend = document.createElement('legend'); // base-select label
      legend.textContent = labelText;
      og.appendChild(legend);
      return og;
    };

    for (const [city, list] of mainCities) {
      const og = makeGroup(city);
      list.forEach(c => og.appendChild(makeOption(c)));
      select.appendChild(og);
    }

    if (otherCampuses.length > 0) {
      const og = makeGroup(t('campus.otherLabel'));
      og.dataset.i18n = 'campus.otherLabel';
      otherCampuses.forEach(c => og.appendChild(makeOption(c)));
      select.appendChild(og);
    }

    // Silent auto-select of the first campus, matching the old picker (no
    // `campuschange` event on initial population).
    if (select.options.length > 0) {
      select.selectedIndex = 0;
      hiddenInput.value = select.value;
    }

    select.addEventListener('change', () => {
      hiddenInput.value = select.value;
      document.dispatchEvent(new CustomEvent('campuschange', { detail: { id: select.value } }));
      haptics.trigger(defaultPatterns.light);
    });
  }
}

customElements.define('campus-chip-picker', CampusChipPicker);

// Backward-compatible module-level API — existing call sites (script.js,
// settings.js) import these directly rather than holding an element
// reference, so keep the same exported shape and just delegate.
export function setupCampusPicker(staticData) {
  document.querySelector('campus-chip-picker')?.setup(staticData);
}

export function selectCampusById(id, animate = true) {
  document.querySelector('campus-chip-picker')?.selectCampusById(id, animate);
}
