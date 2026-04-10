import { t, onLanguageSwitch } from './i18n.js';

const FEATURE_ICONS = {
  4:   { icon: 'videocam',            key: 'features.videoProjector' },
  5:   { icon: 'mic',                 key: 'features.radioMic' },
  6:   { icon: 'blinds',              key: 'features.dimmable' },
  7:   { icon: 'cable',               key: 'features.wiredDesk' },
  142: { icon: 'electrical_services', key: 'features.powerOutlets' },
  223: { icon: 'video_call',          key: 'features.videoconf' },
};

let classroomsData = null;
let searchIndex = null;

// Hierarchy navigation state
let hierarchyState = { level: 0, campus: null, building: null };
let isSearchActive = false;
let searchDebounce = null;

// ---------- DATA ----------

async function loadData() {
  if (classroomsData) return;
  const res = await fetch('/data/classrooms.json');
  classroomsData = await res.json();
}

function buildSearchIndex() {
  const index = [];
  for (const campus of classroomsData) {
    const shortName = campus.name.includes(' - ') ? campus.name.split(' - ')[0] : campus.name;
    for (const building of campus.buildings) {
      for (const room of building.classrooms) {
        index.push({ ...room, buildingName: building.name, campusShortName: shortName });
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
  const [shortName, subtitle] = campus.name.includes(' - ')
    ? campus.name.split(' - ')
    : [campus.name, ''];
  const n = campus.buildings.length;
  const btn = document.createElement('button');
  btn.className = 'search-card search-card--campus';
  btn.innerHTML = `
    <span class="search-card-name">${shortName}</span>
    ${subtitle ? `<span class="search-card-subtitle secondary">${subtitle}</span>` : ''}
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

// ---------- BREADCRUMB ----------

function updateBreadcrumb() {
  const { level, campus, building } = hierarchyState;
  const breadcrumb = document.getElementById('search-breadcrumb');

  if (level === 0) {
    breadcrumb.classList.add('hidden');
    breadcrumb.innerHTML = '';
    return;
  }

  breadcrumb.classList.remove('hidden');
  breadcrumb.innerHTML = '';

  const allBtn = document.createElement('button');
  allBtn.className = 'breadcrumb-btn';
  allBtn.textContent = t('search.allCampuses');
  allBtn.addEventListener('click', () => renderCampuses());
  breadcrumb.appendChild(allBtn);

  if (campus) {
    const sep1 = document.createElement('span');
    sep1.className = 'breadcrumb-sep';
    sep1.textContent = '›';
    breadcrumb.appendChild(sep1);

    const shortName = campus.name.includes(' - ') ? campus.name.split(' - ')[0] : campus.name;

    if (level === 1) {
      const cur = document.createElement('span');
      cur.className = 'breadcrumb-current';
      cur.textContent = shortName;
      breadcrumb.appendChild(cur);
    } else {
      const campusBtn = document.createElement('button');
      campusBtn.className = 'breadcrumb-btn';
      campusBtn.textContent = shortName;
      campusBtn.addEventListener('click', () => renderBuildings(campus));
      breadcrumb.appendChild(campusBtn);
    }
  }

  if (building && level >= 2) {
    const sep2 = document.createElement('span');
    sep2.className = 'breadcrumb-sep';
    sep2.textContent = '›';
    breadcrumb.appendChild(sep2);

    const cur = document.createElement('span');
    cur.className = 'breadcrumb-current';
    cur.textContent = building.name;
    breadcrumb.appendChild(cur);
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
