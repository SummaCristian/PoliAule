import {
  computePosition,
  flip,
  shift,
  offset,
  size,
  autoUpdate,
} from "https://cdn.jsdelivr.net/npm/@floating-ui/dom@1/+esm";
import { haptics, defaultPatterns } from './haptics.js';
import { attachLiquidGlass } from './liquid-glass.js';
import { t } from '../i18n.js';

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
  <link rel="stylesheet" href="https://cdn.hugeicons.com/font/hgi-stroke-rounded.css">
  <link rel="stylesheet" href="./components/campus-picker.css">

  <select class="cp-native" tabindex="-1" aria-hidden="true"></select>

  <button type="button" class="campus-select" aria-haspopup="listbox"
          aria-expanded="false" aria-controls="cp-listbox">
    <i class="hgi-stroke hgi-university campus-select__icon" aria-hidden="true"></i>
    <span class="campus-select__box">
      <span class="campus-select__label"></span>
      <span class="campus-select__value"></span>
    </span>
    <i class="hgi-stroke hgi-arrow-down-01 campus-select__chevron" aria-hidden="true"></i>
  </button>

  <div id="cp-listbox" class="cp-popup" role="listbox" tabindex="-1" popover="auto"
       aria-label="Campus"></div>

  <div class="campus-select-skeleton" aria-hidden="true"></div>
`;

const TYPEAHEAD_RESET_MS = 500;

// <campus-chip-picker> is a fully custom single-select listbox. A visually
// hidden native <select> in the shadow root stays the data model and the real
// form control — it's mirrored onto the light-DOM hidden <input name="campus">
// and is what fires the `change` event. The glass <button> trigger and the
// top-layer `popover` listbox are the UI, driven off that <select>.
//
// Form-association can't reach into the shadow root, so the submittable field
// stays a hidden <input> in the light DOM (declared in index.html); the
// <select> value is mirrored onto it on every change.
export class CampusChipPicker extends HTMLElement {
  #select = null;
  #hiddenInput = null;
  #trigger = null;
  #popup = null;
  #valueEl = null;
  #labelEl = null;
  #rows = [];            // [{ id, el }] in visual order
  #activeIndex = -1;
  #stopAutoUpdate = null;
  #typeaheadBuffer = '';
  #typeaheadTimer = 0;
  #changeWired = false;

  connectedCallback() {
    if (this.shadowRoot) return; // already initialized (re-parenting, etc.)
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.appendChild(TEMPLATE.content.cloneNode(true));

    this.#select = shadow.querySelector('.cp-native');
    this.#trigger = shadow.querySelector('.campus-select');
    this.#popup = shadow.querySelector('.cp-popup');
    this.#valueEl = shadow.querySelector('.campus-select__value');
    this.#labelEl = shadow.querySelector('.campus-select__label');
    this.#hiddenInput = this.querySelector('input[type="hidden"]');

    attachLiquidGlass(this.#trigger);
    this.#trigger.addEventListener('click', () => this.#toggle());
    this.#trigger.addEventListener('keydown', (e) => this.#onTriggerKeydown(e));
    this.#popup.addEventListener('keydown', (e) => this.#onKeydown(e));
    this.#popup.addEventListener('click', (e) => this.#onRowClick(e));
    this.#popup.addEventListener('pointermove', (e) => this.#onRowHover(e));
    this.#popup.addEventListener('toggle', (e) => this.#onPopupToggle(e));
  }

  disconnectedCallback() {
    this.#stopAutoUpdate?.();
    this.#stopAutoUpdate = null;
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
  // cities" section header + the "CAMPUS" trigger label). Called on language
  // switch from script.js.
  retranslate() {
    if (this.#labelEl) this.#labelEl.textContent = t('tabs.campus');

    const og = this.#select?.querySelector('optgroup[data-i18n]');
    if (og) og.label = t(og.dataset.i18n);

    const section = this.#popup?.querySelector('.cp-section[data-i18n]');
    if (section) {
      const lbl = section.querySelector('.cp-section-label');
      if (lbl) lbl.textContent = t(section.dataset.i18n);
    }
  }

  // Builds the option list from the static campus data, keeping only campuses
  // that actually have buildings.
  setup(staticData) {
    const select = this.#select;
    const hiddenInput = this.#hiddenInput;
    if (!select) return;

    // Set here rather than in connectedCallback: i18n isn't loaded that early.
    if (this.#labelEl) this.#labelEl.textContent = t('tabs.campus');

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

    // ── Rebuild the hidden <select> and the custom listbox in one pass ──
    select.innerHTML = '';
    this.#popup.innerHTML = '';
    this.#rows = [];

    const addSection = (labelText, i18nKey) => {
      const og = document.createElement('optgroup');
      og.label = labelText;
      if (i18nKey) og.dataset.i18n = i18nKey;
      select.appendChild(og);

      const section = document.createElement('div');
      section.className = 'cp-section';
      if (i18nKey) section.dataset.i18n = i18nKey;
      const lbl = document.createElement('div');
      lbl.className = 'cp-section-label';
      lbl.textContent = labelText;
      section.appendChild(lbl);
      this.#popup.appendChild(section);

      return { og, section };
    };

    const addCampus = (campus, og, section) => {
      const opt = document.createElement('option');
      opt.value = campus.id;
      opt.textContent = campus.name;
      og.appendChild(opt);

      const row = document.createElement('div');
      row.className = 'campus-option';
      row.setAttribute('role', 'option');
      row.id = `cp-opt-${campus.id}`;
      row.dataset.id = campus.id;
      row.setAttribute('aria-selected', 'false');

      const check = document.createElement('i');
      check.className = 'hgi-stroke hgi-tick-02 campus-option__check';
      check.setAttribute('aria-hidden', 'true');
      row.appendChild(check);

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

      row.appendChild(text);
      section.appendChild(row);
      this.#rows.push({ id: campus.id, name: campus.name.toLowerCase(), el: row });
    };

    for (const [city, list] of mainCities) {
      const { og, section } = addSection(city, null);
      list.forEach(c => addCampus(c, og, section));
    }

    if (otherCampuses.length > 0) {
      const { og, section } = addSection(t('campus.otherLabel'), 'campus.otherLabel');
      otherCampuses.forEach(c => addCampus(c, og, section));
    }

    // Silent auto-select of the first campus, matching the old picker (no
    // `campuschange` event on initial population).
    if (select.options.length > 0) {
      select.selectedIndex = 0;
      hiddenInput.value = select.value;
    }
    this.#syncFromSelect();

    if (!this.#changeWired) {
      this.#changeWired = true;
      select.addEventListener('change', () => {
        hiddenInput.value = select.value;
        this.#syncFromSelect();
        document.dispatchEvent(new CustomEvent('campuschange', { detail: { id: select.value } }));
        haptics.trigger(defaultPatterns.light);
      });
    }
  }

  // ── Selection state ───────────────────────────────────────────────────

  // Mirrors the <select>'s current value onto the trigger label and the
  // listbox rows' aria-selected / active state.
  #syncFromSelect() {
    const value = this.#select.value;
    const selected = this.#select.selectedOptions[0];
    if (this.#valueEl) this.#valueEl.textContent = selected ? selected.textContent : '';

    this.#rows.forEach(({ id, el }, i) => {
      const isSel = id === value;
      el.setAttribute('aria-selected', isSel ? 'true' : 'false');
      if (isSel) this.#activeIndex = i;
    });
  }

  #commit(id) {
    if (this.#select.value !== id) {
      this.#select.value = id;
      this.#select.dispatchEvent(new Event('change'));
    }
    this.#close();
  }

  // ── Open / close ──────────────────────────────────────────────────────

  #toggle() {
    this.#popup.matches(':popover-open') ? this.#close() : this.#open();
  }

  #open() {
    if (this.#popup.matches(':popover-open')) return;
    this.#popup.showPopover();
  }

  #close() {
    if (!this.#popup.matches(':popover-open')) return;
    this.#popup.hidePopover();
  }

  #onPopupToggle(e) {
    if (e.newState === 'open') {
      this.#trigger.setAttribute('aria-expanded', 'true');
      // autoUpdate runs the callback once immediately, then on scroll/resize.
      this.#stopAutoUpdate = autoUpdate(this.#trigger, this.#popup, () => this.#position());
      this.#setActive(this.#activeIndex >= 0 ? this.#activeIndex : 0, { scroll: 'auto' });
      this.#popup.focus({ preventScroll: true });
    } else {
      this.#trigger.setAttribute('aria-expanded', 'false');
      this.#stopAutoUpdate?.();
      this.#stopAutoUpdate = null;
      this.#clearTypeahead();
      // Return focus to the trigger only if focus is still inside the popup
      // (i.e. keyboard / row-click close, not a click elsewhere on the page).
      if (this.shadowRoot.activeElement === this.#popup) {
        this.#trigger.focus({ preventScroll: true });
      }
    }
  }

  async #position() {
    const { x, y, placement } = await computePosition(this.#trigger, this.#popup, {
      strategy: 'fixed',
      placement: 'bottom-start',
      middleware: [
        offset(8),
        flip({ padding: 8 }),
        shift({ padding: 8 }),
        size({
          padding: 8,
          apply: ({ availableHeight, elements }) => {
            elements.floating.style.maxHeight =
              `${Math.min(availableHeight, 24 * 16)}px`;
          },
        }),
      ],
    });

    Object.assign(this.#popup.style, { left: `${x}px`, top: `${y}px` });

    // Point the entry/exit scale back at the trigger.
    const side = placement.split('-')[0];
    const tRect = this.#trigger.getBoundingClientRect();
    const pRect = this.#popup.getBoundingClientRect();
    const originX = Math.max(0, Math.min(pRect.width, tRect.left + tRect.width / 2 - pRect.left));
    this.#popup.style.transformOrigin = `${originX}px ${side === 'top' ? 'bottom' : 'top'}`;
  }

  // ── Keyboard ──────────────────────────────────────────────────────────

  #onTriggerKeydown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
      // Let Enter/Space fall through to the native button click on keyup,
      // but ArrowDown/Up should open + move.
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        this.#open();
      }
    }
  }

  #onKeydown(e) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.#moveActive(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.#moveActive(-1);
        break;
      case 'Home':
        e.preventDefault();
        this.#setActive(0);
        break;
      case 'End':
        e.preventDefault();
        this.#setActive(this.#rows.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (this.#rows[this.#activeIndex]) this.#commit(this.#rows[this.#activeIndex].id);
        break;
      case 'Escape':
        // The Popover API also closes on Escape; #onPopupToggle handles focus.
        break;
      case 'Tab':
        this.#close();
        break;
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          this.#typeahead(e.key);
        }
    }
  }

  #moveActive(delta) {
    const n = this.#rows.length;
    if (!n) return;
    const next = this.#activeIndex < 0
      ? (delta > 0 ? 0 : n - 1)
      : (this.#activeIndex + delta + n) % n;
    this.#setActive(next);
  }

  #setActive(index, { scroll = 'nearest' } = {}) {
    if (index < 0 || index >= this.#rows.length) return;
    this.#rows.forEach(({ el }, i) => el.classList.toggle('is-active', i === index));
    this.#activeIndex = index;
    const el = this.#rows[index].el;
    this.#popup.setAttribute('aria-activedescendant', el.id);
    if (scroll !== 'auto') el.scrollIntoView({ block: scroll });
  }

  #typeahead(char) {
    this.#typeaheadBuffer += char.toLowerCase();
    clearTimeout(this.#typeaheadTimer);
    this.#typeaheadTimer = setTimeout(() => this.#clearTypeahead(), TYPEAHEAD_RESET_MS);

    const match = this.#rows.findIndex(r => r.name.startsWith(this.#typeaheadBuffer));
    if (match >= 0) this.#setActive(match);
  }

  #clearTypeahead() {
    this.#typeaheadBuffer = '';
    clearTimeout(this.#typeaheadTimer);
  }

  // ── Pointer ───────────────────────────────────────────────────────────

  #onRowClick(e) {
    const row = e.target.closest('[role="option"]');
    if (row) this.#commit(row.dataset.id);
  }

  #onRowHover(e) {
    const row = e.target.closest('[role="option"]');
    if (!row) return;
    const i = this.#rows.findIndex(r => r.el === row);
    if (i >= 0 && i !== this.#activeIndex) this.#setActive(i, { scroll: 'auto' });
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
