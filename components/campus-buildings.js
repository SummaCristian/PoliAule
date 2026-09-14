import { CampusChipPicker } from './campus-picker.js';
import { classroomsData as staticClassroomsData } from '../classroom-search-data.js';
import { t } from '../i18n.js';
import { escapeHtml } from '../utils/html.js';
import { haptics, defaultPatterns } from './haptics.js';

// The Campus tab's own "page" inside the campus sheet (components/campus-sheet.js):
// a campus picker on top, and a grid of that campus's buildings below.
//
// The picker is a second instance of the exact same morphing <campus-chip-
// picker> used on the Available tab (components/campus-picker.js) — a
// different element (its own tag), but wired to act as the SAME logical
// picker as the Available tab's: both share the plain `campuschange` event
// (this subclass doesn't override changeEventName), so picking a campus in
// either one dispatches it, and the listener below mirrors that pick onto
// whichever picker didn't just change (selectCampusById() no-ops once a
// picker's value already matches, so this can't loop). Riding the same event
// also means this picker inherits everything else already keyed off it: the
// Available tab's own live search re-running, and settings.js's "remember
// last campus" persistence — genuinely the same picker, just two faces of
// it, rather than a lookalike that happens to start on the same campus.
//
// The building cards reuse the Available tab's "zoom out" building-overview
// cards (.bo-card, building-overview.css) — same glass card, just without the
// occupancy counts row, since browsing here isn't tied to a date/time.
class CampusSheetPicker extends CampusChipPicker {}
customElements.define('campus-sheet-picker', CampusSheetPicker);

let picker = null;
let hiddenInput = null;
let grid = null;
let recenterBtn = null;
let titleEl = null;
let subtitleEl = null;

export function initCampusBuildingsPage(headerContainer, gridContainer) {
  headerContainer.innerHTML = '';
  gridContainer.innerHTML = '';

  // Title            [Center btn] Picker
  const topRow = document.createElement('div');
  topRow.className = 'campus-sheet-toprow';

  const titleBox = document.createElement('div');
  titleBox.className = 'campus-sheet-titlebox';

  titleEl = document.createElement('h3');
  titleEl.className = 'campus-sheet-title';
  titleEl.textContent = t('overview.title');
  titleBox.appendChild(titleEl);

  subtitleEl = document.createElement('span');
  subtitleEl.className = 'campus-sheet-subtitle secondary';
  titleBox.appendChild(subtitleEl);

  topRow.appendChild(titleBox);

  const actions = document.createElement('div');
  actions.className = 'campus-sheet-actions';

  // Recenters the map (components/campus-map.js) on the picker's current
  // campus — only shown once the map is actually panned/zoomed away from it
  // (see the 'campusmapshifted' listener below), so it doesn't clutter the
  // sheet the rest of the time.
  recenterBtn = document.createElement('button');
  recenterBtn.type = 'button';
  recenterBtn.className = 'campus-sheet-recenter liquid-glass';
  recenterBtn.hidden = true;
  recenterBtn.setAttribute('aria-label', t('campus.recenter'));
  recenterBtn.innerHTML = '<span class="material-symbols-outlined">my_location</span>';
  recenterBtn.addEventListener('click', () => {
    haptics.trigger(defaultPatterns.light);
    document.dispatchEvent(new CustomEvent('campusrecenter'));
  });
  actions.appendChild(recenterBtn);

  picker = document.createElement('campus-sheet-picker');
  hiddenInput = document.createElement('input');
  hiddenInput.type = 'hidden';
  picker.appendChild(hiddenInput);
  actions.appendChild(picker);

  topRow.appendChild(actions);
  headerContainer.appendChild(topRow);

  grid = document.createElement('div');
  grid.className = 'bo-grid campus-sheet-grid';
  gridContainer.appendChild(grid);

  picker.setup(staticClassroomsData);
  renderGrid(hiddenInput.value);

  document.addEventListener('campuschange', (e) => renderGrid(e.detail.id));
  document.addEventListener('campusmapshifted', (e) => { recenterBtn.hidden = !e.detail.shifted; });

  // Two-way sync with the Available tab's own picker (see the file header
  // comment) — whichever one changed, bring the other along. No-ops on
  // whichever picker is already showing this campus (itself included), so
  // this can't bounce back and forth forever.
  document.addEventListener('campuschange', (e) => {
    picker.selectCampusById(e.detail.id);
    document.querySelector('campus-chip-picker')?.selectCampusById(e.detail.id);
  });
}

// The campus currently picked here — read by campus-map.js so the map opens
// centered on it, and stays centered on whichever campus is picked next (see
// the 'campuschange' listener there).
export function getSelectedCampusId() {
  return hiddenInput?.value ?? null;
}

// Called from script.js alongside the Available tab's own picker retranslate,
// on every language switch.
export function retranslateCampusBuildingsPage() {
  if (!picker) return;
  picker.retranslate();
  recenterBtn?.setAttribute('aria-label', t('campus.recenter'));
  renderGrid(hiddenInput.value);
}

function renderGrid(campusId) {
  if (!grid) return;
  grid.innerHTML = '';
  const campus = staticClassroomsData.find(c => c.id === campusId);
  const buildings = campus?.buildings ?? [];
  if (subtitleEl) subtitleEl.textContent = t('campus.buildingsCount').replace('{n}', buildings.length);
  for (const building of buildings) {
    grid.appendChild(buildBuildingCard(building));
  }
}

function buildBuildingCard(building) {
  const card = document.createElement('div');
  card.className = 'bo-card campus-sheet-card';

  const total = building.classrooms.length;
  card.innerHTML = `
    <div class="bo-card-body">
      <div class="bo-card-head">
        <span class="bo-card-name">${escapeHtml(t('building.prefix'))} ${escapeHtml(building.name)}</span>
        ${building.altName ? `<span class="bo-card-alt">${escapeHtml(building.altName)}</span>` : ''}
        <span class="bo-card-total secondary">${escapeHtml(t('overview.subtitle').replace('{n}', total))}</span>
      </div>
      ${building.address ? `<span class="campus-sheet-card-address secondary">${escapeHtml(building.address)}</span>` : ''}
    </div>
  `;
  return card;
}
