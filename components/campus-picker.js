import { createListPicker } from 'vitrium';
import { t } from '../i18n.js';

// <campus-chip-picker> is a single-select listbox: a Vitrium list picker (the
// pill that morphs into a list of campuses), plus what is PoliAule's: the
// campuses grouped by city, the `campuschange` event, a hidden
// <input name="campus"> mirroring the value for the form, and the docked
// desktop mode (picker-dock.js).
//
// The submittable field stays a hidden <input> in the light DOM (declared in
// index.html) so it is part of the <form>.
export class CampusChipPicker extends HTMLElement {
  // Overridable by a subclass (see components/campus-buildings.js) so a
  // second instance can reuse this whole class without its `change` also
  // triggering the Available tab's own `campuschange` listener.
  changeEventName = 'campuschange';

  static observedAttributes = ['data-loading'];

  #picker = null;
  #hiddenInput = null;
  #staticData = null;
  #ids = new Set();
  #docked = false;
  #dockTimer = 0;
  #panelHome = null;      // the morph host the panel returns to when undocked

  connectedCallback() {
    if (this.#picker) return; // already initialized (re-parenting, etc.)

    this.#hiddenInput = this.querySelector('input[type="hidden"]');
    this.#picker = createListPicker({
      label: t('tabs.campus'),
      icon: '<i class="hgi-stroke hgi-university" aria-hidden="true"></i>',
      options: [],
      onChange: (id) => this.#changed(id),
    });
    this.#picker.setLoading(this.hasAttribute('data-loading'));
    this.appendChild(this.#picker.el);
  }

  attributeChangedCallback(name, _old, value) {
    if (name === 'data-loading') this.#picker?.setLoading(value !== null);
  }

  // The morph panel is a body-level element the picker doesn't hand out, but
  // its trigger points at it.
  #panel() {
    const trigger = this.#picker?.el.querySelector('.lg-chip');
    return trigger ? document.getElementById(trigger.getAttribute('aria-controls')) : null;
  }

  #changed(id) {
    if (this.#hiddenInput) this.#hiddenInput.value = id;
    document.dispatchEvent(new CustomEvent(this.changeEventName, { detail: { id } }));
  }

  // Programmatically selects a campus by ID. No-op if the ID isn't available.
  selectCampusById(id, _animate = true) {
    if (!this.#picker || !this.#ids.has(id) || this.#picker.value === id) return;
    this.#picker.setValue(id);
    this.#changed(id);
  }

  // Re-applies translations: the "CAMPUS" label, the panel's title and the
  // "Other cities" section header. Called on language switch from script.js.
  retranslate() {
    if (!this.#picker) return;
    this.#picker.setLabel(t('tabs.campus'));
    const title = this.#panel()?.querySelector('.lg-morph__title-text');
    if (title) title.textContent = t('tabs.campus');
    if (this.#staticData) this.#picker.setOptions({ sections: this.#sections() });
  }

  // Group by city, then split: cities that contain a grouped campus (Milano:
  // Città Studi / Bovisa) get their own section; standalone single-campus
  // cities are collected under "Other cities".
  #sections() {
    const byCity = new Map();
    for (const campus of this.#staticData.filter(c => c.buildings.length > 0)) {
      if (!byCity.has(campus.city)) byCity.set(campus.city, []);
      byCity.get(campus.city).push(campus);
    }

    const toOption = c => ({ value: c.id, label: c.name, description: c.group });
    const sections = [];
    const others = [];
    for (const [city, list] of byCity) {
      if (list.some(c => c.group)) sections.push({ label: city, options: list.map(toOption) });
      else others.push(...list);
    }
    if (others.length) sections.push({ label: t('campus.otherLabel'), options: others.map(toOption) });
    return sections;
  }

  // Builds the option list from the static campus data, keeping only campuses
  // that actually have buildings.
  setup(staticData) {
    if (!this.#picker) return;
    this.#staticData = staticData;

    // Set here rather than in connectedCallback: i18n isn't loaded that early.
    this.#picker.setLabel(t('tabs.campus'));
    const title = this.#panel()?.querySelector('.lg-morph__title-text');
    if (title) title.textContent = t('tabs.campus');

    const sections = this.#sections();
    this.#ids = new Set(sections.flatMap(s => s.options.map(o => o.value)));
    this.#picker.setOptions({ sections });

    // Silent auto-select of the first campus (setOptions falls back to it): no
    // `campuschange` event on initial population.
    if (this.#hiddenInput) this.#hiddenInput.value = this.#picker.value;
  }

  // ── Docked (inline-expanded) mode ───────────────────────────────────
  // Desktop: the listbox panel sits directly in the form column instead of
  // morphing out of the pill. picker-dock.js toggles this. The panel is the
  // morph popup's own element (so its keyboard and hover handling keep
  // working): docking moves it next to this element and shows it open.
  setDocked(on) {
    on = !!on;
    if (on === this.#docked || !this.#picker) return;
    this.#docked = on;
    clearTimeout(this.#dockTimer);

    const panel = this.#panel();
    if (!panel) return;

    if (on) {
      // A panel still open (or closing) owns its own cleanup, which would hide
      // the docked one: let it finish first.
      const busy = this.#picker.el.querySelector('.lg-chip')?.getAttribute('aria-expanded') === 'true';
      if (busy) this.#picker.close();
      this.#dockTimer = setTimeout(() => this.#dock(panel), busy ? 800 : 0);
    } else {
      this.#undock(panel);
    }
  }

  #dock(panel) {
    if (!this.#docked) return;
    this.#panelHome = panel.parentElement;
    panel.classList.add('lg-morph--open', 'campus-dock');
    panel.style.display = 'flex';
    this.parentElement?.insertBefore(panel, this.nextSibling);
    this.style.display = 'none';
  }

  #undock(panel) {
    if (panel.classList.contains('campus-dock')) {
      panel.classList.remove('lg-morph--open', 'campus-dock');
      panel.style.display = '';
      this.#panelHome?.appendChild(panel);
    }
    this.style.display = '';
  }
}

customElements.define('campus-chip-picker', CampusChipPicker);

// Called once from script.js after the static classroom data has loaded.
export function setupCampusPicker(staticData) {
  document.querySelector('campus-chip-picker')?.setup(staticData);
}

// Programmatically select a campus in the main picker.
export function selectCampusById(id, animate = true) {
  document.querySelector('campus-chip-picker')?.selectCampusById(id, animate);
}
