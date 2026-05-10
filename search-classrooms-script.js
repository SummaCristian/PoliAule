import { t, onLanguageSwitch } from './i18n.js';
import { haptics, defaultPatterns } from './components/haptics.js';
import { getClassroomStatusNow } from './available-rooms-script.js';
import { fetchPhotoUrl } from './utils/photo.js';

const supportsAnchor = CSS.supports('anchor-name: --a');

const FEATURE_ICONS = {
  4:   { icon: 'videocam',            key: 'features.videoProjector' },
  5:   { icon: 'mic',                 key: 'features.radioMic' },
  6:   { icon: 'blinds',              key: 'features.dimmable' },
  7:   { icon: 'cable',               key: 'features.wiredDesk' },
  142: { icon: 'electrical_services', key: 'features.powerOutlets' },
  223: { icon: 'video_call',          key: 'features.videoconf' },
};


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
  const res = await fetch('/data/classrooms.json');
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

// Wraps every case-insensitive occurrence of `query` in `text` with <mark>.
// Returns plain escaped HTML when query is empty.
function highlight(text, query) {
  const safe = escapeHtml(text);
  if (!query) return safe;
  // Escape special regex chars, then allow spaces to also match dots (for x.y.z names queried as "x y z")
  const safeQ = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[\\s.]');
  return safe.replace(new RegExp(`(${safeQ})`, 'gi'), '<mark>$1</mark>');
}

// ---------- PHOTO THUMBNAILS ----------

// Limit simultaneous image downloads+decodes to avoid OOM crashes on iOS Safari
// when large result sets (100+ cards) trigger many loads at once.
const _photoSem = { slots: 4, queue: [] };
function _acquirePhotoSlot() {
  return new Promise(resolve => {
    if (_photoSem.slots > 0) { _photoSem.slots--; resolve(); }
    else _photoSem.queue.push(resolve);
  });
}
function _releasePhotoSlot() {
  const next = _photoSem.queue.shift();
  if (next) next(); else _photoSem.slots++;
}

async function _loadCardPhoto(idfoto, img) {
  const card = img.closest('.search-card--with-photo');
  // Resolve the redirect URL first (cheap text fetch, no slot needed)
  const url = await fetchPhotoUrl(idfoto);
  if (url === 'error') {
    card?.classList.add('photo-failed');
    return;
  }

  // Gate the heavy image download + decode through the semaphore
  await _acquirePhotoSlot();
  try {
    img.onerror = () => card?.classList.add('photo-failed');
    img.src = url;
    // Set --photo-url only after decode so the ::before pseudo-element reuses the
    // already-decoded bitmap instead of triggering a second parallel decode.
    await img.decode();
    card?.style.setProperty('--photo-url', `url("${url}")`);
    img.classList.add('loaded');
  } catch {
    card?.classList.add('photo-failed');
  } finally {
    _releasePhotoSlot();
  }
}

const _photoObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    _photoObserver.unobserve(entry.target);
    const idfoto = parseInt(entry.target.dataset.idfoto, 10);
    const img = entry.target.querySelector('.search-card-photo');
    if (img && idfoto) _loadCardPhoto(idfoto, img);
  }
}, { rootMargin: '150px' });

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

function buildClassroomCard(room, query = '') {
  const featuresHtml = (room.features ?? [])
    .filter(f => FEATURE_ICONS[f.id])
    .map(f => `<span class="material-symbols-outlined search-card-feature-icon" data-feature-id="${f.id}" data-tooltip="${t(FEATURE_ICONS[f.id].key)}">${FEATURE_ICONS[f.id].icon}</span>`)
    .join('');

  const status = getClassroomStatusNow(room.id);
  let statusText = '';
  if (status) {
    const statusKeys = {
      'free': 'status.free',
      'occupied': 'status.occupied',
      'free-soon': 'status.freeSoon',
      'occupied-soon': 'status.occupiedSoon'
    };
    statusText = `<h4 class="classroom-status-txt ${status}">${t(statusKeys[status])}</h4>`;
  }

  const el = document.createElement('button');
  el.dataset.openClassroom = room.id;

  if (room.idfoto) {
    el.className = 'search-card search-card--classroom search-card--with-photo';
    el.dataset.idfoto = room.idfoto;
    el.innerHTML = `
      <img class="search-card-photo" alt="">
      <div class="search-card-overlay"></div>
      <div class="search-card-content">
        <div class="search-card-photo-header">
          <span class="search-card-name" title="${escapeHtml(room.name)}">${highlight(room.name, query)}</span>
          <span class="search-card-arrow-button" aria-hidden="true">
            <span class="material-symbols-outlined search-card-arrow">chevron_right</span>
          </span>
        </div>
        <div class="search-card-photo-meta">
          ${room.buildingName ? `<span class="search-card-meta secondary search-card-meta--with-icon"><span class="material-symbols-outlined search-card-meta-icon">domain</span>${highlight(room.buildingName + (room.buildingAltName ? ' · ' + room.buildingAltName : ''), query)}</span>` : ''}
          ${room.campusName ? `<span class="search-card-meta secondary small search-card-meta--with-icon"><span class="material-symbols-outlined search-card-meta-icon">location_on</span>${highlight(room.campusName, query)}</span>` : ''}
        </div>
        <div class="search-card-photo-bottom">
          ${statusText ? `<div class="search-card-status search-card-status--photo">${statusText}</div>` : ''}
          ${featuresHtml ? `<div class="search-card-features">${featuresHtml}</div>` : ''}
        </div>
      </div>
    `;
    _photoObserver.observe(el);
  } else {
    el.className = 'search-card search-card--classroom';
    el.innerHTML = `
      <div class="search-card-header">
        <div class="search-card-icon-wrapper">
          <span class="material-symbols-outlined">meeting_room</span>
        </div>
        <div class="search-card-info">
          <span class="search-card-name" title="${escapeHtml(room.name)}">${highlight(room.name, query)}</span>
          <div class="search-card-status">
            ${statusText}
          </div>
          ${room.buildingName ? `<span class="search-card-meta secondary search-card-meta--with-icon"><span class="material-symbols-outlined search-card-meta-icon">domain</span>${highlight(room.buildingName + (room.buildingAltName ? ' · ' + room.buildingAltName : ''), query)}</span>` : ''}
          ${room.campusName ? `<span class="search-card-meta secondary small search-card-meta--with-icon"><span class="material-symbols-outlined search-card-meta-icon">location_on</span>${highlight(room.campusName, query)}</span>` : ''}
        </div>
      </div>
      ${featuresHtml ? `<div class="search-card-features">${featuresHtml}</div>` : ''}
    `;
  }

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
    grid.appendChild(buildClassroomCard(room));
  });

  container.innerHTML = '';
  container.appendChild(grid);

  requestAnimationFrame(() => {
    setTimeout(() => {
      grid.classList.add('appeared');
    }, 400);
  });
}

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

  const grid = document.createElement('div');
  grid.className = 'search-grid search-grid--classroom';
  results.forEach(room => grid.appendChild(buildClassroomCard(room, query.trim())));
  container.appendChild(grid);

  requestAnimationFrame(() => {
    setTimeout(() => {
      grid.classList.add('appeared');
    }, 400);
  });
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
