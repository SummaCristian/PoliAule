import { haptics, defaultPatterns } from './haptics.js';
import { t } from '../i18n.js';

const TEMPLATE = document.createElement('template');
TEMPLATE.innerHTML = `
  <link rel="stylesheet" href="./components/campus-picker.css">
  <div class="campus-chips"></div>
  <div class="campus-chips-skeleton" aria-hidden="true">
    <div class="campus-section-sk">
      <div class="campus-label-sk"></div>
      <div class="campus-row-sk">
        <div></div>
        <div></div>
      </div>
    </div>
    <div class="campus-section-sk">
      <div class="campus-label-sk"></div>
      <div class="campus-row-sk">
        <div></div>
        <div></div>
        <div></div>
      </div>
    </div>
  </div>
`;

// <campus-chip-picker> wraps the picker's markup/CSS in a shadow root so its
// internals stay isolated from the rest of the page. The one thing that
// can't move into the shadow root is the hidden form input: form-association
// only works while the input stays in the light DOM, so it's kept as a real
// child of the element (declared in index.html) and just read/written via
// this.querySelector() from inside.
export class CampusChipPicker extends HTMLElement {
  #container = null;
  #hiddenInput = null;

  connectedCallback() {
    if (this.shadowRoot) return; // already initialized (re-parenting, etc.)
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.appendChild(TEMPLATE.content.cloneNode(true));
    this.#container = shadow.querySelector('.campus-chips');
    this.#hiddenInput = this.querySelector('input[type="hidden"]');
  }

  // Programmatically selects a campus chip by campus ID.
  // Works for both plain chips and subchips inside group chips.
  selectCampusById(id, animate = true) {
    const container = this.#container;
    if (!container) return;

    // Try plain chip first
    const plainChip = container.querySelector(`.campus-chip[data-value="${id}"]`);
    if (plainChip) {
      plainChip.click();
      return;
    }

    // Try subchip inside a group
    const subChip = container.querySelector(`.campus-subchip[data-value="${id}"]`);
    if (subChip) {
      const groupEl = subChip.closest('.campus-chip-group');
      // Activate the group first if not already active
      if (groupEl && !groupEl.classList.contains('active')) {
        groupEl.querySelector('.campus-chip-group-trigger')?.click();
      }
      subChip.click();
    }
  }

  // Initializes the picker, allowing to select only the options actually available
  setup(staticData) {
    const campuses = staticData;
    const hiddenInput = this.#hiddenInput;
    const container = this.#container;

    function setSelectedCampus(id) {
      hiddenInput.value = id;
      document.dispatchEvent(new CustomEvent('campuschange', { detail: { id } }));
    }

    const available = campuses.filter(c => c.buildings.length > 0);

    // Group by city, then by group within each city
    const cityMap = new Map(); // city → Map<group|null, campus[]>
    for (const campus of available) {
      if (!cityMap.has(campus.city)) cityMap.set(campus.city, new Map());
      const groupKey = campus.group ?? null;
      const cityGroups = cityMap.get(campus.city);
      if (!cityGroups.has(groupKey)) cityGroups.set(groupKey, []);
      cityGroups.get(groupKey).push(campus);
    }

    // Cities with at least one group chip get their own section; the rest go into "Other cities"
    const mainCities = [];
    const otherCampuses = [];
    for (const [city, groups] of cityMap) {
      const hasGroups = [...groups.keys()].some(k => k !== null);
      if (hasGroups) {
        mainCities.push({ city, groups });
      } else {
        for (const campusList of groups.values()) otherCampuses.push(...campusList);
      }
    }

    function deactivateAll() {
      container.querySelectorAll('.campus-chip').forEach(c => c.classList.remove('active'));
    }

    function positionIndicator(subOptions, activeSubChip, animate) {
      const indicator = subOptions.querySelector('.campus-subchip-indicator');
      if (!indicator) return;
      if (!animate) {
        indicator.style.transition = 'none';
      }
      indicator.style.transform = `translateX(${activeSubChip.offsetLeft}px)`;
      indicator.style.width     = activeSubChip.offsetWidth + 'px';
      if (!animate) {
        indicator.getBoundingClientRect(); // force reflow to apply snap
        indicator.style.transition = '';
      }
    }

    function activateGroupChip(groupEl) {
      deactivateAll();
      groupEl.classList.add('active');
      const activeSub = groupEl.querySelector('.campus-subchip.active')
        ?? groupEl.querySelector('.campus-subchip');
      if (activeSub) {
        activeSub.classList.add('active');
        hiddenInput.value = activeSub.dataset.value;
        const subOptions = groupEl.querySelector('.campus-chip-suboptions');
        positionIndicator(subOptions, activeSub, false);
      }
    }

    function buildGroupChip(label, subCampuses) {
      const groupEl = document.createElement('div');
      groupEl.className = 'campus-chip campus-chip-group';

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'campus-chip-group-trigger';
      trigger.textContent = label;
      trigger.addEventListener('click', () => {
        activateGroupChip(groupEl);
        setSelectedCampus(hiddenInput.value);
        haptics.trigger(defaultPatterns.light);
      });

      const subOptionsWrapper = document.createElement('div');
      subOptionsWrapper.className = 'campus-chip-suboptions-wrapper';

      const subOptions = document.createElement('div');
      subOptions.className = 'campus-chip-suboptions';

      const indicator = document.createElement('div');
      indicator.className = 'campus-subchip-indicator';
      subOptions.appendChild(indicator);

      subCampuses.forEach(campus => {
        const subChip = document.createElement('button');
        subChip.type = 'button';
        subChip.className = 'campus-subchip';
        subChip.dataset.value = campus.id;
        subChip.textContent = campus.name;

        subChip.addEventListener('click', () => {
          groupEl.querySelectorAll('.campus-subchip').forEach(s => s.classList.remove('active'));
          subChip.classList.add('active');
          setSelectedCampus(campus.id);
          positionIndicator(subOptions, subChip, true);
          haptics.trigger(defaultPatterns.light);
        });

        subOptions.appendChild(subChip);
      });

      subOptionsWrapper.appendChild(subOptions);
      groupEl.appendChild(trigger);
      groupEl.appendChild(subOptionsWrapper);
      return groupEl;
    }

    function buildPlainChip(campus) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'campus-chip';
      chip.dataset.value = campus.id;
      chip.textContent = campus.name;
      chip.addEventListener('click', () => {
        deactivateAll();
        chip.classList.add('active');
        setSelectedCampus(campus.id);
        haptics.trigger(defaultPatterns.light);
      });
      return chip;
    }

    let firstChipInfo = null;

    for (const { city, groups } of mainCities) {
      const row = document.createElement('div');
      row.className = 'campus-chips-row';

      const section = document.createElement('div');
      section.className = 'campus-chips-section';
      const label = document.createElement('label');
      label.textContent = city;
      section.appendChild(label);
      section.appendChild(row);
      container.appendChild(section);

      for (const [groupName, groupCampuses] of groups) {
        if (groupName !== null) {
          const groupEl = buildGroupChip(groupName, groupCampuses);
          row.appendChild(groupEl);
          if (!firstChipInfo) firstChipInfo = { el: groupEl, isGroup: true };
        } else {
          for (const campus of groupCampuses) {
            const chip = buildPlainChip(campus);
            row.appendChild(chip);
            if (!firstChipInfo) firstChipInfo = { el: chip, isGroup: false };
          }
        }
      }
    }

    if (otherCampuses.length > 0) {
      const otherRow = document.createElement('div');
      otherRow.className = 'campus-chips-row';

      const otherSection = document.createElement('div');
      otherSection.className = 'campus-chips-section';
      const otherLabel = document.createElement('label');
      otherLabel.textContent = t('campus.otherLabel');
      otherLabel.dataset.i18n = 'campus.otherLabel';
      otherSection.appendChild(otherLabel);
      otherSection.appendChild(otherRow);

      for (const campus of otherCampuses) {
        const chip = buildPlainChip(campus);
        otherRow.appendChild(chip);
        if (!firstChipInfo) firstChipInfo = { el: chip, isGroup: false };
      }

      container.appendChild(otherSection);
    }

    // Auto-select first chip
    if (firstChipInfo) {
      if (firstChipInfo.isGroup) {
        activateGroupChip(firstChipInfo.el);
      } else {
        firstChipInfo.el.classList.add('active');
        hiddenInput.value = firstChipInfo.el.dataset.value;
      }
    }
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
