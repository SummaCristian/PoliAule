import { createChipPicker, attachLiquidGlass } from 'vitrium';
import { t } from '../i18n.js';

// Shared shell of <date-chip-picker> and <time-range-chip-picker>: a Vitrium
// chip that morphs into a panel holding `body`, or, on desktop, the same body
// docked open as an inline glass card (picker-dock.js decides which).
//
// Docking swaps the two forms instead of moving one panel between them: the
// chip and its body-level popup are destroyed and rebuilt on demand, and `body`
// (the picker's real DOM, which must survive) is moved across first.
//
//   host      the custom element the chip or dock is appended to
//   icon      HugeIcons class, e.g. 'hgi-calendar-03'
//   labelKey  i18n key for the label, the panel's title and its aria-label
//   width     the morphing panel's width in px
//   body      the Node holding the picker
//   exclude   selector inside the docked card that keeps its own drags
//   title     show the icon + label title atop the panel and the dock (default
//             true; the time slider brings its own)
//   deformFrom  selector of the press/drag handle inside a title-less panel
//   onBuild(chip)   the chip was (re)built: fill in its value, add extras
//   onShow()        the body just became visible (opened or docked): re-measure
export class ChipShell {
  constructor(host, { icon, labelKey, width, body, title = true, exclude, deformFrom, onBuild, onShow }) {
    Object.assign(this, { host, icon, labelKey, width, body, title, exclude, deformFrom, onBuild, onShow });
    this.chip = null;
    this.dock = null;
    this.docked = false;
    this.#build();
  }

  get trigger() { return this.chip?.trigger ?? null; }

  #iconHtml() {
    return `<i class="hgi-stroke ${this.icon}" aria-hidden="true"></i>`;
  }

  #build() {
    const label = t(this.labelKey);
    this.chip = createChipPicker({
      icon: this.#iconHtml(),
      label,
      title: this.title ? undefined : false,
      width: this.width,
      content: this.body,
      onOpen: () => this.onShow?.(),
      onAfterOpen: () => this.onShow?.(),
    });
    const { trigger, popup } = this.chip;
    trigger.querySelector('.lg-chip__label').dataset.i18n = this.labelKey;
    if (this.deformFrom) attachLiquidGlass(popup.panel, { from: this.deformFrom });
    this.host.appendChild(this.chip.el);
    this.onBuild?.(this.chip);
  }

  #buildDock() {
    const dock = document.createElement('div');
    // `data-lg-exclude` confines the press/drag deform to the card's chrome, so
    // the picker inside keeps its own drags.
    dock.className = 'chip-dock lg-glass liquid-glass';
    if (this.exclude) dock.dataset.lgExclude = this.exclude;
    if (this.title) {
      const heading = document.createElement('div');
      heading.className = 'chip-dock__title';
      heading.setAttribute('aria-hidden', 'true');
      heading.innerHTML = `${this.#iconHtml()}<span data-i18n="${this.labelKey}">${t(this.labelKey)}</span>`;
      dock.appendChild(heading);
    }
    this.dock = dock;
  }

  setDocked(on) {
    on = !!on;
    if (on === this.docked) return;
    this.docked = on;

    if (on) {
      if (!this.dock) this.#buildDock();
      this.dock.appendChild(this.body);          // rescue the body before its popup goes
      this.chip.destroy();
      this.chip = null;
      this.host.appendChild(this.dock);
    } else {
      this.dock.remove();
      this.#build();                             // moves the body back into a new popup
    }
    this.onShow?.();
    requestAnimationFrame(() => this.onShow?.());
  }

  retranslate() {
    const label = t(this.labelKey);
    if (this.chip) {
      this.chip.popup.panel.setAttribute('aria-label', label);
      const title = this.chip.popup.panel.querySelector('.lg-morph__title-text');
      if (title) title.textContent = label;
      this.chip.trigger.querySelector('.lg-chip__label').textContent = label;
    }
  }
}
