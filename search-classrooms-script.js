import { t, onLanguageSwitch } from './i18n.js';
import { haptics, defaultPatterns } from './components/haptics.js';
import { getClassroomStatusNow } from './available-rooms-script.js';
import { buildCardForClassroom } from './components/classroom-list.js';
import { getApiBase } from './config.js';

const supportsAnchor = CSS.supports('anchor-name: --a');


export let classroomsData = null;
let searchIndex = null;

// Hierarchy navigation state
let hierarchyState = { level: 0, campus: null, building: null };
let isSearchActive = false;
let searchDebounce = null;
let activeDropdown = null;

// ---------- DATA ----------

async function loadData() {
  if (classroomsData) return;
  const res = await fetch(`${getApiBase()}/v1/classrooms`);
  classroomsData = await res.json();
}

function buildSearchIndex() {
  const index = [];
  for (const campus of classroomsData) {
    for (const building of campus.buildings) {
      for (const room of building.classrooms) {
        index.push({ ...room, buildingName: building.name, buildingAltName: building.altName, campusName: campus.name });
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

// ---------- CARD BUILDERS ----------

function buildCampusCard(campus) {
  const n = campus.buildings.length;
  const btn = document.createElement('button');
  btn.className = 'search-card search-card--campus';
  btn.innerHTML = `
    <div class="search-card-header">
      <div class="search-card-icon-wrapper">
        <span class="material-symbols-outlined">location_on</span>
      </div>
      <div class="search-card-info">
        <span class="search-card-name">${escapeHtml(campus.name)}</span>
        ${campus.group ? `<span class="search-card-subtitle secondary">${escapeHtml(campus.group)}</span>` : ''}
      </div>
    </div>
    <div class="search-card-footer">
      <span class="search-card-meta secondary">${t('search.buildings').replace('{n}', n)}</span>
      <span class="material-symbols-outlined search-card-arrow">chevron_right</span>
    </div>
  `;
  return btn;
}

function buildBuildingCard(building) {
  const n = building.classrooms.length;
  const btn = document.createElement('button');
  btn.className = 'search-card search-card--building';
  btn.innerHTML = `
    <div class="search-card-header">
      <div class="search-card-icon-wrapper">
        <span class="material-symbols-outlined">domain</span>
      </div>
      <div class="search-card-info">
        <span class="search-card-name">${escapeHtml(building.name)}${building.altName ? ` <small class="search-card-alt-name secondary">${escapeHtml(building.altName)}</small>` : ''}</span>
      </div>
    </div>
    <div class="search-card-footer">
      <span class="search-card-meta secondary">${t('search.classrooms').replace('{n}', n)}</span>
      <span class="material-symbols-outlined search-card-arrow">chevron_right</span>
    </div>
  `;
  return btn;
}

// Classroom cards reuse the exact card built for the Available tab
// (components/classroom-list.js), rather than the bespoke search-card markup
// used for campus/building cards above.
function buildClassroomCard(room, building, query = '') {
  const status = getClassroomStatusNow(room.id);
  return buildCardForClassroom({ ...room, status }, building, null, null, false, null, query);
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
      haptics.trigger(defaultPatterns.light);
      closeActiveDropdown();
      onSelect();
    });
    dropdown.appendChild(btn);
  });

  document.body.appendChild(dropdown);
  activeDropdown = dropdown;
  anchor.setAttribute('aria-expanded', 'true');

  if (supportsAnchor) {
    anchor.style.anchorName = '--breadcrumb-dropdown';
    dropdown.style.positionAnchor = '--breadcrumb-dropdown';
  } else {
    // Fallback: position manually using getBoundingClientRect
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
  }

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
  if (supportsAnchor && activeDropdown._anchor) {
    activeDropdown._anchor.style.anchorName = '';
  }
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
  const inner = breadcrumb.querySelector('.search-breadcrumb-inner');

  closeActiveDropdown();

  if (level === 0) {
    breadcrumb.classList.add('hidden');
    inner.innerHTML = '';
    return;
  }

  breadcrumb.classList.remove('hidden');
  inner.innerHTML = '';

  // "All campuses" — plain navigation button, no siblings dropdown
  const allBtn = document.createElement('button');
  allBtn.className = 'breadcrumb-btn';
  allBtn.textContent = t('search.allCampuses');
  allBtn.addEventListener('click', () => { haptics.trigger(defaultPatterns.light); renderCampuses(); });
  inner.appendChild(allBtn);

  if (campus) {
    inner.appendChild(makeSep());

    const campusSegment = makeDropdownSegment(campus.name, level === 1, (e) => {
      e.stopPropagation();
      openBreadcrumbDropdown(campusSegment, classroomsData
        .filter(c => c.buildings.length > 0)
        .map(c => ({
          label:    c.name,
          sublabel: c.group ?? null,
          active:   c.id === campus.id,
          onSelect: () => renderBuildings(c),
        }))
      );
    });
    inner.appendChild(campusSegment);
  }

  if (building && level >= 2) {
    inner.appendChild(makeSep());

    const buildingSegment = makeDropdownSegment(building.name, true, (e) => {
      e.stopPropagation();
      openBreadcrumbDropdown(buildingSegment, campus.buildings.map(b => ({
        label: b.name,
        sublabel: t('search.classrooms').replace('{n}', b.classrooms.length),
        active: b.name === building.name,
        onSelect: () => renderClassrooms(campus, b),
      })));
    });
    inner.appendChild(buildingSegment);
  }
}

// ---------- LEVEL HEADER ----------

function setLevelHeader(icon, labelKey, onBack = null) {
  const header = document.getElementById('search-level-header');
  header.innerHTML = '';

  if (onBack) {
    const backBtn = document.createElement('button');
    backBtn.className = 'search-level-back-btn';
    backBtn.innerHTML = '<span class="material-symbols-outlined">arrow_back</span>';
    backBtn.title = t('search.back');
    backBtn.addEventListener('click', () => { haptics.trigger(defaultPatterns.light); onBack(); });
    header.appendChild(backBtn);
  }

  const iconEl = document.createElement('span');
  iconEl.className = 'material-symbols-outlined search-level-header-icon';
  iconEl.textContent = icon;
  header.appendChild(iconEl);

  const textEl = document.createElement('span');
  textEl.className = 'search-level-header-text';
  textEl.textContent = t(labelKey);
  header.appendChild(textEl);
}

// ---------- RENDER FUNCTIONS ----------

function scrollSearchToTop() {
  if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'instant' });
}

function renderCampuses() {
  hierarchyState = { level: 0, campus: null, building: null };
  updateBreadcrumb();
  setLevelHeader('location_city', 'search.headerCampuses');
  scrollSearchToTop();

  const container = document.getElementById('search-results-container');
  const grid = document.createElement('div');
  grid.className = 'search-grid search-grid--campus';

  classroomsData
    .filter(c => c.buildings.length > 0)
    .forEach(campus => {
      const card = buildCampusCard(campus);
      card.addEventListener('click', () => { haptics.trigger(defaultPatterns.light); renderBuildings(campus); });
      grid.appendChild(card);
    });

  container.innerHTML = '';
  container.appendChild(grid);

  requestAnimationFrame(() => {
    setTimeout(() => {
      grid.classList.add('appeared');
    }, 400);
  });
}

function renderBuildings(campus) {
  hierarchyState = { level: 1, campus, building: null };
  updateBreadcrumb();
  setLevelHeader('domain', 'search.headerBuildings', () => renderCampuses());
  scrollSearchToTop();

  const container = document.getElementById('search-results-container');
  const grid = document.createElement('div');
  grid.className = 'search-grid search-grid--building';

  campus.buildings.forEach(building => {
    const card = buildBuildingCard(building);
    card.addEventListener('click', () => { haptics.trigger(defaultPatterns.light); renderClassrooms(campus, building); });
    grid.appendChild(card);
  });

  container.innerHTML = '';
  container.appendChild(grid);

  requestAnimationFrame(() => {
    setTimeout(() => {
      grid.classList.add('appeared');
    }, 400);
  });
}

function renderClassrooms(campus, building) {
  hierarchyState = { level: 2, campus, building };
  updateBreadcrumb();
  setLevelHeader('meeting_room', 'search.headerClassrooms', () => renderBuildings(campus));
  scrollSearchToTop();

  const container = document.getElementById('search-results-container');
  const grid = document.createElement('div');
  grid.className = 'search-grid search-grid--classroom';

  // Don't add context meta (building/campus) since breadcrumb already shows it
  building.classrooms.forEach(room => {
    grid.appendChild(buildClassroomCard(room, building));
  });

  container.innerHTML = '';
  container.appendChild(grid);

  requestAnimationFrame(() => {
    setTimeout(() => {
      grid.classList.add('appeared');
    }, 400);
  });
}

const SEARCH_MAX_RESULTS = 40;

function renderSearchResults(query) {
  closeActiveDropdown();
  setLevelHeader('meeting_room', 'search.headerClassrooms');
  if (!searchIndex) searchIndex = buildSearchIndex();

  const q = query.trim().toLowerCase();
  const qDotted = q.replace(/\s+/g, '.');
  const results = searchIndex.filter(room =>
    room.name.toLowerCase().includes(q) ||
    room.name.toLowerCase().includes(qDotted) ||
    room.buildingName.toLowerCase().includes(q) ||
    (room.buildingAltName && room.buildingAltName.toLowerCase().includes(q)) ||
    room.campusName.toLowerCase().includes(q)
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

  const capped = results.length > SEARCH_MAX_RESULTS;
  const visible = capped ? results.slice(0, SEARCH_MAX_RESULTS) : results;

  const grid = document.createElement('div');
  grid.className = 'search-grid search-grid--classroom';
  // Results span multiple campuses, so fold the campus name into the building
  // line (the card only has room for one line of building/location context).
  visible.forEach(room => grid.appendChild(buildClassroomCard(room, {
    name: room.buildingName,
    altName: [room.buildingAltName, room.campusName].filter(Boolean).join(' · '),
  }, query.trim())));

  container.appendChild(grid);

  if (capped) {
    const notice = document.createElement('p');
    notice.className = 'search-too-many-notice';
    notice.textContent = t('search.tooManyResults').replace('{n}', SEARCH_MAX_RESULTS);
    container.appendChild(notice);
  }

  requestAnimationFrame(() => {
    setTimeout(() => {
      grid.classList.add('appeared');
    }, 400);
  });
}

// Jump straight to one building's classroom list — used by the "Available"
// tab's building-header button. Matches by id when present, else by name.
// Returns false if the campus/building can't be found in the static directory.
export function navigateToBuilding(campusId, buildingId, buildingName) {
  if (!classroomsData) return false;
  const campus = classroomsData.find(c => c.id === campusId);
  if (!campus) return false;
  const building = campus.buildings.find(b =>
    (buildingId != null && b.id === buildingId) || b.name === buildingName);
  if (!building) return false;

  const searchInput = document.getElementById('classroom-search-input');
  if (searchInput && searchInput.value) {
    searchInput.value = '';
    isSearchActive = false;
  }

  renderClassrooms(campus, building);
  return true;
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

  document.getElementById('classroom-search-clear').addEventListener('click', () => {
    haptics.trigger(defaultPatterns.light);
    searchInput.value = '';
    searchInput.dispatchEvent(new Event('input'));
    searchInput.focus();
  });

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
