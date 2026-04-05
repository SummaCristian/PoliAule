import { classroomsData } from '../available-rooms-script.js';
import { haptics, defaultPatterns } from './haptics.js';

// Initializes the Campus picker, allowing to select only the options actually available
export function setupCampusPicker() {
  const campuses = classroomsData[0].campuses;
  const hiddenInput = document.getElementById('campus-picker');
  const container = document.getElementById('campus-chips');

  const BOVISA_IDS = new Set(['MIB01', 'MIB02']);
  const CITTA_STUDI_IDS = new Set(['MIA01', 'MIA06']);
  const CITTA_STUDI_NAMES = { MIA01: 'Leonardo', MIA06: 'Colombo' };

  const available = campuses.filter(c => c.buildings.length > 0);
  const bovisaCampuses = available.filter(c => BOVISA_IDS.has(c.id));
  const cittaStudiCampuses = available.filter(c => CITTA_STUDI_IDS.has(c.id));

  // Build sectioned rows
  const milanoRow = document.createElement('div');
  milanoRow.className = 'campus-chips-row';

  const otherRow = document.createElement('div');
  otherRow.className = 'campus-chips-row';

  const milanoSection = document.createElement('div');
  milanoSection.className = 'campus-chips-section';
  const milanoLabel = document.createElement('label');
  milanoLabel.textContent = 'Milano';
  milanoSection.appendChild(milanoLabel);
  milanoSection.appendChild(milanoRow);
  container.appendChild(milanoSection);

  const otherSection = document.createElement('div');
  otherSection.className = 'campus-chips-section';
  const otherLabel = document.createElement('label');
  otherLabel.textContent = 'Other cities';
  otherSection.appendChild(otherLabel);
  otherSection.appendChild(otherRow);

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

  function buildGroupChip(label, subCampuses, nameMap) {
    const groupEl = document.createElement('div');
    groupEl.className = 'campus-chip campus-chip-group';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'campus-chip-group-trigger';
    trigger.textContent = label;
    trigger.addEventListener('click', () => {
      activateGroupChip(groupEl);
      haptics.trigger(defaultPatterns.success);
    });

    const subOptionsWrapper = document.createElement('div');
    subOptionsWrapper.className = 'campus-chip-suboptions-wrapper';

    const subOptions = document.createElement('div');
    subOptions.className = 'campus-chip-suboptions';

    const indicator = document.createElement('div');
    indicator.className = 'campus-subchip-indicator';
    subOptions.appendChild(indicator);

    subCampuses.forEach(bc => {
      const shortName = nameMap
        ? (nameMap[bc.id] ?? bc.name)
        : (bc.name.split(' - ')[1] ?? bc.name).replace(/^Via\s+/i, '');
      const subChip = document.createElement('button');
      subChip.type = 'button';
      subChip.className = 'campus-subchip';
      subChip.dataset.value = bc.id;
      subChip.textContent = shortName;

      subChip.addEventListener('click', () => {
        groupEl.querySelectorAll('.campus-subchip').forEach(s => s.classList.remove('active'));
        subChip.classList.add('active');
        hiddenInput.value = bc.id;
        positionIndicator(subOptions, subChip, true);
        haptics.trigger(defaultPatterns.success);
      });

      subOptions.appendChild(subChip);
    });

    subOptionsWrapper.appendChild(subOptions);
    groupEl.appendChild(trigger);
    groupEl.appendChild(subOptionsWrapper);
    return groupEl;
  }

  let cittaStudiInserted = false;
  let bovisaInserted = false;
  let firstChipInfo = null;

  available.forEach(campus => {
    const isMilano = campus.id.startsWith('MI');
    const row = isMilano ? milanoRow : otherRow;

    if (CITTA_STUDI_IDS.has(campus.id)) {
      if (cittaStudiInserted) return;
      cittaStudiInserted = true;

      const groupEl = buildGroupChip('Città Studi', cittaStudiCampuses, CITTA_STUDI_NAMES);
      row.appendChild(groupEl);
      if (!firstChipInfo) firstChipInfo = { el: groupEl, isGroup: true };
      return;
    }

    if (BOVISA_IDS.has(campus.id)) {
      if (bovisaInserted) return;
      bovisaInserted = true;

      const groupEl = buildGroupChip('Bovisa', bovisaCampuses, null);
      row.appendChild(groupEl);
      if (!firstChipInfo) firstChipInfo = { el: groupEl, isGroup: true };
      return;
    }

    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'campus-chip';
    chip.dataset.value = campus.id;
    chip.textContent = campus.name;

    chip.addEventListener('click', () => {
      deactivateAll();
      chip.classList.add('active');
      hiddenInput.value = campus.id;
      haptics.trigger(defaultPatterns.success);
    });

    row.appendChild(chip);
    if (!firstChipInfo) firstChipInfo = { el: chip, isGroup: false };
  });

  // Only show "Other cities" section if it has chips
  if (otherRow.children.length > 0) {
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
