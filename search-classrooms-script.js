import { t, onLanguageSwitch } from './i18n.js';

const FEATURE_ICONS = {
  4:   { icon: 'videocam',            key: 'features.videoProjector' },
  5:   { icon: 'mic',                 key: 'features.radioMic' },
  6:   { icon: 'blinds',              key: 'features.dimmable' },
  7:   { icon: 'cable',               key: 'features.wiredDesk' },
  142: { icon: 'electrical_services', key: 'features.powerOutlets' },
  223: { icon: 'video_call',          key: 'features.videoconf' },
};

// ---------- CAMPUS NAME HELPERS ----------
// Mirror the exact naming logic from components/campus-picker.js so the
// names shown here always match what appears in the Available-tab picker.

const CITTA_STUDI_IDS   = new Set(['MIA01', 'MIA06']);
const BOVISA_IDS        = new Set(['MIB01', 'MIB02']);
const CITTA_STUDI_NAMES = { MIA01: 'Leonardo', MIA06: 'Colombo' };

function getCampusDisplayName(campus) {
  if (CITTA_STUDI_IDS.has(campus.id)) return CITTA_STUDI_NAMES[campus.id] ?? campus.name;
  if (BOVISA_IDS.has(campus.id))
    return (campus.name.split(' - ')[1] ?? campus.name).replace(/^Via\s+/i, '');
  return campus.name;
}

function getCampusGroupName(campus) {
  if (CITTA_STUDI_IDS.has(campus.id)) return 'Città Studi';
  if (BOVISA_IDS.has(campus.id))      return 'Bovisa';
  return null;
}

let classroomsData = null;
let searchIndex = null;

// Hierarchy navigation state
let hierarchyState = { level: 0, campus: null, building: null };
let isSearchActive = false;
let searchDebounce = null;
let activeDropdown = null;

// ---------- DATA ----------

async function loadData() {
  if (classroomsData) return;
  const res = await fetch('/data/classrooms.json');
  classroomsData = await res.json();
}

function buildSearchIndex() {
  const index = [];
  for (const campus of classroomsData) {
    const campusShortName = getCampusDisplayName(campus);
    for (const building of campus.buildings) {
      for (const room of building.classrooms) {
        index.push({ ...room, buildingName: building.name, campusShortName });
      }
    }
  }
  return index;
}

// ---------- TEXT HIGHLIGHT ----------

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Wraps every case-insensitive occurrence of `query` in `text` with <mark>.
// Returns plain escaped HTML when query is empty.
function highlight(text, query) {
  const safe = escapeHtml(text);
  if (!query) return safe;
  const safeQ = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return safe.replace(new RegExp(`(${safeQ})`, 'gi'), '<mark>$1</mark>');
}

// ---------- CARD BUILDERS ----------

function buildCampusCard(campus) {
  const displayName = getCampusDisplayName(campus);
  const groupName   = getCampusGroupName(campus);
  const n = campus.buildings.length;
  const btn = document.createElement('button');
  btn.className = 'search-card search-card--campus';
  btn.innerHTML = `
    <span class="search-card-name">${escapeHtml(displayName)}</span>
    ${groupName ? `<span class="search-card-subtitle secondary">${escapeHtml(groupName)}</span>` : ''}
    <span class="search-card-meta secondary">${t('search.buildings').replace('{n}', n)}</span>
  `;
  return btn;
}

function buildBuildingCard(building) {
  const n = building.classrooms.length;
  const btn = document.createElement('button');
  btn.className = 'search-card search-card--building';
  btn.innerHTML = `
    <span class="search-card-name">${building.name}</span>
    <span class="search-card-meta secondary">${t('search.classrooms').replace('{n}', n)}</span>
  `;
  return btn;
}

function buildClassroomCard(room, query = '') {
  const featuresHtml = (room.features ?? [])
    .filter(f => FEATURE_ICONS[f.id])
    .map(f => `<span class="material-symbols-outlined search-card-feature-icon" title="${t(FEATURE_ICONS[f.id].key)}">${FEATURE_ICONS[f.id].icon}</span>`)
    .join('');

  const el = document.createElement('div');
  el.className = 'search-card search-card--classroom';
  el.innerHTML = `
    <span class="search-card-name">${highlight(room.name, query)}</span>
    ${room.buildingName    ? `<span class="search-card-meta secondary">${highlight(room.buildingName, query)}</span>` : ''}
    ${room.campusShortName ? `<span class="search-card-meta secondary small">${highlight(room.campusShortName, query)}</span>` : ''}
    ${featuresHtml ? `<div class="search-card-features">${featuresHtml}</div>` : ''}
  `;
  return el;
}

// ---------- BREADCRUMB DROPDOWN ----------

function openBreadcrumbDropdown(anchor, items) {
  // Toggle: clicking the same anchor again closes the dropdown
  if (activeDropdown?._anchor === anchor) {
    closeActiveDropdown();
    return;
  }
  closeActiveDropdown();

  const dropdown = document.createElement('div');
  dropdown.className = 'breadcrumb-dropdown';
  dropdown._anchor = anchor;

  items.forEach(({ label, sublabel, active, onSelect }) => {
    const btn = document.createElement('button');
    btn.className = `breadcrumb-dropdown-item${active ? ' active' : ''}`;

    const textCol = document.createElement('div');
    textCol.className = 'breadcrumb-dropdown-text';

    const labelEl = document.createElement('span');
    labelEl.className = 'breadcrumb-dropdown-label';
    labelEl.textContent = label;
    textCol.appendChild(labelEl);

    if (sublabel) {
      const subEl = document.createElement('span');
      subEl.className = 'breadcrumb-dropdown-sublabel';
      subEl.textContent = sublabel;
      textCol.appendChild(subEl);
    }

    btn.appendChild(textCol);

    if (active) {
      const check = document.createElement('span');
      check.className = 'material-symbols-outlined breadcrumb-dropdown-check';
      check.textContent = 'check';
      btn.appendChild(check);
    }

    btn.addEventListener('click', () => {
      closeActiveDropdown();
      onSelect();
    });
    dropdown.appendChild(btn);
  });

  document.body.appendChild(dropdown);
  activeDropdown = dropdown;
  anchor.setAttribute('aria-expanded', 'true');

  // Position below the anchor button, flush-left, clamped to viewport
  const rect = anchor.getBoundingClientRect();
  dropdown.style.left = `${rect.left}px`;
  dropdown.style.top = `${rect.bottom + 6}px`;

  requestAnimationFrame(() => {
    if (!activeDropdown) return;
    const ddRect = dropdown.getBoundingClientRect();
    if (ddRect.right > window.innerWidth - 8) {
      dropdown.style.left = `${Math.max(8, window.innerWidth - ddRect.width - 8)}px`;
    }
  });

  // Dismiss on outside click (deferred so this very click doesn't close it)
  const onOutsideClick = (e) => {
    if (!dropdown.contains(e.target) && e.target !== anchor) {
      closeActiveDropdown();
    }
  };
  dropdown._onOutsideClick = onOutsideClick;
  setTimeout(() => document.addEventListener('click', onOutsideClick), 0);
}

function closeActiveDropdown() {
  if (!activeDropdown) return;
  if (activeDropdown._onOutsideClick) {
    document.removeEventListener('click', activeDropdown._onOutsideClick);
  }
  activeDropdown._anchor?.removeAttribute('aria-expanded');
  activeDropdown.remove();
  activeDropdown = null;
}

// ---------- BREADCRUMB ----------

function makeSep() {
  const sep = document.createElement('span');
  sep.className = 'breadcrumb-sep';
  sep.textContent = '›';
  return sep;
}

// Returns a button that opens a siblings dropdown when clicked.
// `isCurrent` adds the --current modifier (slightly muted, still interactive).
function makeDropdownSegment(label, isCurrent, onOpen) {
  const btn = document.createElement('button');
  btn.className = `breadcrumb-btn breadcrumb-btn--has-dropdown${isCurrent ? ' breadcrumb-btn--current' : ''}`;
  btn.innerHTML = `${escapeHtml(label)}<span class="material-symbols-outlined breadcrumb-chevron" aria-hidden="true">expand_more</span>`;
  btn.addEventListener('click', onOpen);
  return btn;
}

function updateBreadcrumb() {
  const { level, campus, building } = hierarchyState;
  const breadcrumb = document.getElementById('search-breadcrumb');

  closeActiveDropdown();

  if (level === 0) {
    breadcrumb.classList.add('hidden');
    breadcrumb.innerHTML = '';
    return;
  }

  breadcrumb.classList.remove('hidden');
  breadcrumb.innerHTML = '';

  // "All campuses" — plain navigation button, no siblings dropdown
  const allBtn = document.createElement('button');
  allBtn.className = 'breadcrumb-btn';
  allBtn.textContent = t('search.allCampuses');
  allBtn.addEventListener('click', () => renderCampuses());
  breadcrumb.appendChild(allBtn);

  if (campus) {
    breadcrumb.appendChild(makeSep());

    const campusSegment = makeDropdownSegment(getCampusDisplayName(campus), level === 1, (e) => {
      e.stopPropagation();
      openBreadcrumbDropdown(campusSegment, classroomsData
        .filter(c => c.buildings.length > 0)
        .map(c => ({
          label:    getCampusDisplayName(c),
          sublabel: getCampusGroupName(c),
          active:   c.id === campus.id,
          onSelect: () => renderBuildings(c),
        }))
      );
    });
    breadcrumb.appendChild(campusSegment);
  }

  if (building && level >= 2) {
    breadcrumb.appendChild(makeSep());

    const buildingSegment = makeDropdownSegment(building.name, true, (e) => {
      e.stopPropagation();
      openBreadcrumbDropdown(buildingSegment, campus.buildings.map(b => ({
        label: b.name,
        sublabel: t('search.classrooms').replace('{n}', b.classrooms.length),
        active: b.name === building.name,
        onSelect: () => renderClassrooms(campus, b),
      })));
    });
    breadcrumb.appendChild(buildingSegment);
  }
}

// ---------- RENDER FUNCTIONS ----------

function renderCampuses() {
  hierarchyState = { level: 0, campus: null, building: null };
  updateBreadcrumb();

  const container = document.getElementById('search-results-container');
  const grid = document.createElement('div');
  grid.className = 'search-grid search-grid--campus';

  classroomsData
    .filter(c => c.buildings.length > 0)
    .forEach(campus => {
      const card = buildCampusCard(campus);
      card.addEventListener('click', () => renderBuildings(campus));
      grid.appendChild(card);
    });

  container.innerHTML = '';
  container.appendChild(grid);
}

function renderBuildings(campus) {
  hierarchyState = { level: 1, campus, building: null };
  updateBreadcrumb();

  const container = document.getElementById('search-results-container');
  const grid = document.createElement('div');
  grid.className = 'search-grid search-grid--building';

  campus.buildings.forEach(building => {
    const card = buildBuildingCard(building);
    card.addEventListener('click', () => renderClassrooms(campus, building));
    grid.appendChild(card);
  });

  container.innerHTML = '';
  container.appendChild(grid);
}

function renderClassrooms(campus, building) {
  hierarchyState = { level: 2, campus, building };
  updateBreadcrumb();

  const container = document.getElementById('search-results-container');
  const grid = document.createElement('div');
  grid.className = 'search-grid search-grid--classroom';

  // Don't add context meta (building/campus) since breadcrumb already shows it
  building.classrooms.forEach(room => {
    grid.appendChild(buildClassroomCard(room));
  });

  container.innerHTML = '';
  container.appendChild(grid);
}

function renderSearchResults(query) {
  closeActiveDropdown();
  if (!searchIndex) searchIndex = buildSearchIndex();

  const q = query.trim().toLowerCase();
  const results = searchIndex.filter(room =>
    room.name.toLowerCase().includes(q) ||
    room.buildingName.toLowerCase().includes(q) ||
    room.campusShortName.toLowerCase().includes(q)
  );

  const container = document.getElementById('search-results-container');
  container.innerHTML = '';

  if (results.length === 0) {
    const state = document.createElement('div');
    state.className = 'search-empty-state';
    state.innerHTML = `
      <span class="material-symbols-outlined empty-container-icon">search_off</span>
      <p class="empty-container-title">${t('search.emptyTitle')}</p>
      <p class="empty-container-subtitle">${t('search.emptySubtitle')}</p>
    `;
    container.appendChild(state);
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'search-grid search-grid--classroom';
  results.forEach(room => grid.appendChild(buildClassroomCard(room, query.trim())));
  container.appendChild(grid);
}

function restoreHierarchy() {
  isSearchActive = false;
  const { level, campus, building } = hierarchyState;
  if (level === 0) renderCampuses();
  else if (level === 1) renderBuildings(campus);
  else if (level === 2) renderClassrooms(campus, building);
}

// ---------- INIT ----------

export async function initSearchTab() {
  await loadData();
  renderCampuses();

  const searchInput = document.getElementById('classroom-search-input');

  searchInput.addEventListener('input', () => {
    clearTimeout(searchDebounce);
    const query = searchInput.value;

    if (!query.trim()) {
      if (isSearchActive) restoreHierarchy();
      return;
    }

    isSearchActive = true;
    closeActiveDropdown();
    document.getElementById('search-breadcrumb').classList.add('hidden');
    searchDebounce = setTimeout(() => renderSearchResults(query), 200);
  });

  onLanguageSwitch(() => {
    const query = searchInput.value;
    if (isSearchActive && query.trim()) {
      renderSearchResults(query);
    } else {
      restoreHierarchy();
    }
  });
}
