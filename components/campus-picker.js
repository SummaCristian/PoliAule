import { classroomsData } from '../available-rooms-script.js';
import { haptics, defaultPatterns } from './haptics.js';

// Initializes the Campus picker, allowing to select only the options actually available
export function setupCampusPicker() {
  const campuses = classroomsData[0].campuses;
  const hiddenInput = document.getElementById('campus-picker');
  const container = document.getElementById('campus-chips');

  const BOVISA_IDS = new Set(['MIB01', 'MIB02']);
  const available = campuses.filter(c => c.buildings.length > 0);
  const bovisaCampuses = available.filter(c => BOVISA_IDS.has(c.id));

  function deactivateAll() {
    container.querySelectorAll('.campus-chip').forEach(c => c.classList.remove('active'));
  }

  function activateBovisaChip(groupEl) {
    deactivateAll();
    groupEl.classList.add('active');
    // Restore or auto-select first sub-chip
    const activeSub = groupEl.querySelector('.campus-subchip.active')
      ?? groupEl.querySelector('.campus-subchip');
    if (activeSub) {
      activeSub.classList.add('active');
      hiddenInput.value = activeSub.dataset.value;
    }
  }

  let bovisaInserted = false;
  let firstChipInfo = null;

  available.forEach(campus => {
    if (BOVISA_IDS.has(campus.id)) {
      if (bovisaInserted) return;
      bovisaInserted = true;

      // Outer div acts as the chip container (buttons-inside-button is invalid HTML)
      const groupEl = document.createElement('div');
      groupEl.className = 'campus-chip campus-chip-group';

      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'campus-chip-group-trigger';
      trigger.textContent = 'Bovisa';
      trigger.addEventListener('click', () => {
        activateBovisaChip(groupEl);
        haptics.trigger(defaultPatterns.success);
      });

      const subOptions = document.createElement('div');
      subOptions.className = 'campus-chip-suboptions';

      bovisaCampuses.forEach(bc => {
        const shortName = bc.name.split(' - ')[1] ?? bc.name;
        const subChip = document.createElement('button');
        subChip.type = 'button';
        subChip.className = 'campus-subchip';
        subChip.dataset.value = bc.id;
        subChip.textContent = shortName;

        subChip.addEventListener('click', () => {
          groupEl.querySelectorAll('.campus-subchip').forEach(s => s.classList.remove('active'));
          subChip.classList.add('active');
          hiddenInput.value = bc.id;
          haptics.trigger(defaultPatterns.success);
        });

        subOptions.appendChild(subChip);
      });

      groupEl.appendChild(trigger);
      groupEl.appendChild(subOptions);
      container.appendChild(groupEl);

      if (!firstChipInfo) firstChipInfo = { el: groupEl, isBovisa: true };
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

    container.appendChild(chip);
    if (!firstChipInfo) firstChipInfo = { el: chip, isBovisa: false };
  });

  // Auto-select first chip
  if (firstChipInfo) {
    if (firstChipInfo.isBovisa) {
      activateBovisaChip(firstChipInfo.el);
    } else {
      firstChipInfo.el.classList.add('active');
      hiddenInput.value = firstChipInfo.el.dataset.value;
    }
  }
}
