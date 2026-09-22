// Search overlay — the bottom-nav search FAB opens this as a sheet over
// whatever tab is currently showing, rather than switching to its own tab
// page. It owns only the presentation/UX; the actual classroom text search
// (data, index, scoring) lives in classroom-search-data.js's runSearch().
//
// Mobile layout is classic Spotlight: the bar sits at a fixed top offset (the
// header's old slot, which fades out) and results grow downward beneath it.
// The keyboard only ever clips the results' available height — see the
// visualViewport tracking below and the panel rule in search-overlay.css.
//
// RESULTS: a single Top Hit (the best-scoring item across every type), then
// Classrooms / Buildings / Professors / Exams / Lessons sections, each an
// iOS-style inset-grouped list capped to 4 rows with a "Show all" expander.
// Exam/lesson rows expand in place (single-open accordion, animated) to list
// every session; classroom rows open the classroom detail page; building rows
// jump to the Campus tab; professor rows swap the results panel for an
// in-place professor view (openProfessorView/exitProfessorView below) that
// slides in from the right and back.

import { t, getLocale, onLanguageSwitch } from '../i18n.js';
import { escapeHtml, highlight } from '../utils/html.js';
import { createTimeFormatter } from '../utils/time-format.js';
import { fetchPhotoUrl, photoUrlCache } from '../utils/photo.js';
import { runSearch, getProfessorSchedule, hasOccupationData } from '../classroom-search-data.js';
import { classroomsData as occupancyDays } from '../available-rooms-script.js';
import { activateGroupTab } from './bottom-nav.js';
import { goToBuilding } from './campus-buildings.js';

const DEBOUNCE_MS = 200;
const SECTION_CAP = 4;

// Shared view-transition name: the bottom-nav search FAB morphs into the
// overlay's search bar on open, and back on close. Only ever assigned to one
// of the two elements at a time (cleared before it's handed over).
const MORPH_NAME = 'search-fab-morph';
// Vitrium rebuilds this circle when the layout changes, so it is looked up by
// class each time rather than held or given an id.
const fabEl = () => document.querySelector('.lg-tabbar__prominent');
const barEl = () => overlay.querySelector('.search-bar-wrapper');

// The translucent chrome (header blur layers, pill nav) can't keep a live
// backdrop-filter through a view transition — Safari doesn't rasterise it into
// the snapshot, so it flashes unblurred / resamples the wrong backdrop. While
// `html.search-vt` is set (only for the duration of the open/close VT) those
// surfaces drop their blur — see search-overlay.css.
function beginChromeVT() { document.documentElement.classList.add('search-vt'); }
// Restore the blur a couple of frames AFTER the VT resolves — snapping it back
// while the ::view-transition pseudo-elements are still tearing down double-
// exposes the FAB (unblurred snapshot + freshly-blurred live element).
function endChromeVT() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.documentElement.classList.remove('search-vt');
  }));
}

let overlay, panel, input, clearBtn, closeBtn, resultsEl;
let isOpen = false;
let debounce = null;
let savedScrollPos = 0;

let occRecheckTimer = null;

// Which panel resultsEl currently shows, and the professor it shows when in
// 'professor' mode. Scroll positions are saved on the way out of each so
// "back" and re-entering results restore where the user left off.
let currentView = 'results';
let currentProfessorKey = null;
let resultsScrollPos = 0;

const reduceMotionMQ = matchMedia('(prefers-reduced-motion: reduce)');

// Duplicated from components/classroom-list.js — that map isn't exported, and
// importing the whole module here for one const would pull in its photo/
// favourite wiring for no reason.
const STATUS_KEYS = {
  'free': 'status.free',
  'partially-free': 'status.partiallyFree',
  'occupied': 'status.occupied',
  'free-soon': 'status.freeSoon',
  'occupied-soon': 'status.occupiedSoon',
};

// Duplicated from components/classroom-detail.js (not exported) — only the
// icon/key, used for the Top Hit classroom's feature row.
const FEATURE_ICONS = {
  4: { icon: 'hgi-projector-01', key: 'features.videoProjector' },
  5: { icon: 'hgi-mic-01', key: 'features.radioMic' },
  6: { icon: 'hgi-blinds', key: 'features.dimmable' },
  7: { icon: 'hgi-cable', key: 'features.wiredDesk' },
  142: { icon: 'hgi-plug-socket', key: 'features.powerOutlets' },
  223: { icon: 'hgi-computer-video-call', key: 'features.videoconf' },
};

/* ── Section registry: fixed order, skipped when empty ─────────────────── */

const SECTIONS = [
  { key: 'classrooms', labelKey: 'search.sectionClassrooms', build: buildClassroomRow },
  { key: 'buildings', labelKey: 'search.sectionBuildings', build: buildBuildingRow },
  { key: 'professors', labelKey: 'search.sectionProfessors', build: buildProfessorRow },
  { key: 'exams', labelKey: 'search.sectionExams', build: buildExamRow },
  { key: 'lessons', labelKey: 'search.sectionLessons', build: buildLessonRow },
];

// Per-section "show all" state and the single currently-expanded exam/lesson
// item (accordion — opening one closes any other). Both reset when the query
// text changes, but survive a re-render triggered by the same query (toggling
// a section, occupancy data arriving late, or a professor-view round trip).
let expandedSections = new Set();
let expandedItemKey = null;
let lastQuery = null;

/* ── Small building blocks ──────────────────────────────────────────────── */

function sectionLabel(text) {
  const el = document.createElement('div');
  el.className = 'search-section-label';
  el.textContent = text;
  return el;
}

function tooManyNotice(n) {
  const p = document.createElement('p');
  p.className = 'search-too-many-notice';
  p.textContent = t('search.tooManyResults').replace('{n}', n);
  return p;
}

function fmtTime(hhmm, timeFmt) {
  const [h, m] = String(hhmm).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return String(hhmm ?? '');
  return timeFmt.format(new Date(2000, 0, 1, h, m));
}

// "Today"/"Tomorrow" where natural, weekday+date otherwise.
function fmtDay(iso, dateFmt) {
  const d = new Date(`${iso}T00:00`);
  if (Number.isNaN(d.getTime())) return String(iso ?? '');
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday);
  startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  const startOfDayAfter = new Date(startOfTomorrow);
  startOfDayAfter.setDate(startOfDayAfter.getDate() + 1);
  if (d >= startOfToday && d < startOfTomorrow) return t('search.today');
  if (d >= startOfTomorrow && d < startOfDayAfter) return t('search.tomorrow');
  return dateFmt.format(d);
}

function fmtWhen(session, ctx) {
  return `${fmtDay(session.date, ctx.dateFmt)} · ${fmtTime(session.inizio, ctx.timeFmt)}–${fmtTime(session.fine, ctx.timeFmt)}`;
}

// Photos load lazily (rows scroll past quickly in a long results list), same
// IntersectionObserver + cache pattern as components/classroom-list.js.
const rowPhotoObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    rowPhotoObserver.unobserve(entry.target);
    const roomId = Number(entry.target.dataset.photoFor);
    const img = entry.target.querySelector('img');
    fetchPhotoUrl(roomId).then(url => {
      img.onerror = () => entry.target.classList.add('photo-failed');
      img.src = url;
      img.decode().then(() => img.classList.add('loaded')).catch(() => entry.target.classList.add('photo-failed'));
    });
  }
}, { rootMargin: '200px' });

function buildPhotoLead(room, large) {
  const lead = document.createElement('div');
  lead.className = 'search-row-lead' + (large ? ' search-row-lead--lg' : '');
  if (room.idfoto) {
    lead.classList.add('search-row-lead--photo');
    lead.dataset.photoFor = room.id;
    const cachedUrl = photoUrlCache.get(room.id);
    lead.innerHTML = `<img class="search-row-photo${cachedUrl ? ' loaded' : ''}" alt=""${cachedUrl ? ` src="${escapeHtml(cachedUrl)}"` : ''}>`;
    if (cachedUrl) lead.querySelector('img').onerror = () => lead.classList.add('photo-failed');
    else rowPhotoObserver.observe(lead);
  } else {
    lead.classList.add('search-row-lead--icon');
    lead.innerHTML = `<i class="hgi-stroke hgi-door-01" aria-hidden="true"></i>`;
  }
  return lead;
}

function buildIconTile(iconClass, large, accent) {
  const lead = document.createElement('div');
  lead.className = 'search-row-lead search-row-lead--tile' + (accent ? ' search-row-lead--accent' : '') + (large ? ' search-row-lead--lg' : '');
  lead.innerHTML = `<i class="hgi-stroke ${iconClass}" aria-hidden="true"></i>`;
  return lead;
}

// Deterministic hue from the professor key so the same person always gets the
// same avatar colour; mixed against the theme surface so it reads well light
// and dark (see .search-avatar in search-overlay.css). Also used to tint the
// professor Top Hit card itself (a different, muted/deep tone of the same
// hue — see .search-tophit-row--professor).
function hueFromKey(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % 360;
}

function buildAvatarLead(initials, key, large) {
  const lead = document.createElement('div');
  lead.className = 'search-row-lead search-row-lead--avatar search-avatar' + (large ? ' search-row-lead--lg' : '');
  lead.style.setProperty('--avatar-hue', hueFromKey(key));
  lead.textContent = initials;
  return lead;
}

/* ── Row builders — one per result type. Each takes (item, ctx) and returns
   a DOM node ready to drop into a section list or the Top Hit slot. ctx
   carries { q, dateFmt, timeFmt, large }. Every row that's independently
   selectable/activatable carries data-row (keyboard nav walks these in DOM
   order — see refreshActionable). Highlighted title text is always wrapped in
   its own <span class="search-row-title-text"> — highlight() can emit a bare
   <mark>, and .search-row-title is a flex row (for badges/alt names), so an
   unwrapped <mark> becomes its own flex item and visually splits the word;
   the wrapper also carries the title's own ellipsis truncation. ── */

function buildClassroomRow(item, ctx) {
  const { room, buildingName, buildingAltName, campusName, status } = item;
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'search-row search-row--classroom' + (ctx.large ? ' search-row--tophit' : '');
  row.dataset.row = '';
  row.dataset.openClassroom = room.id;
  row.tabIndex = -1;

  row.appendChild(buildPhotoLead(room, ctx.large));

  const body = document.createElement('div');
  body.className = 'search-row-body';
  const buildingLine = [buildingAltName ? `${buildingName} · ${buildingAltName}` : buildingName, campusName].filter(Boolean).join(' · ');
  let metaHtml = '';
  if (ctx.large) {
    const bits = [];
    if (room.capacity != null) bits.push(`<span class="search-row-feature"><i class="hgi-stroke hgi-user-circle" aria-hidden="true"></i>${escapeHtml(String(room.capacity))}</span>`);
    (room.features ?? []).filter(f => FEATURE_ICONS[f.id]).slice(0, 4).forEach(f => {
      const { icon, key } = FEATURE_ICONS[f.id];
      bits.push(`<span class="search-row-feature" title="${escapeHtml(t(key))}"><i class="hgi-stroke ${icon}" aria-hidden="true"></i></span>`);
    });
    if (bits.length) metaHtml = `<div class="search-row-extra search-row-features">${bits.join('')}</div>`;
  }
  body.innerHTML = `
    <div class="search-row-title"><span class="search-row-title-text">${highlight(room.name, ctx.q)}</span></div>
    <div class="search-row-subtitle">${highlight(buildingLine, ctx.q)}</div>
    ${metaHtml}
  `;
  row.appendChild(body);

  const statusKey = STATUS_KEYS[status];
  if (statusKey) {
    const pill = document.createElement('span');
    pill.className = `search-row-trailing classroom-status-txt ${status}`;
    pill.textContent = t(statusKey);
    row.appendChild(pill);
  }
  return row;
}

function buildBuildingRow(item, ctx) {
  const { campusId, campusName, name, altName, roomCount, freeNow } = item;
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'search-row search-row--building' + (ctx.large ? ' search-row--tophit' : '');
  row.dataset.row = '';
  row.tabIndex = -1;

  row.appendChild(buildIconTile('hgi-university', ctx.large, false));

  const body = document.createElement('div');
  body.className = 'search-row-body';
  const subtitleParts = [campusName, t('search.roomsCount').replace('{n}', roomCount)];
  if (freeNow != null) subtitleParts.push(t('search.freeNowCount').replace('{n}', freeNow));
  body.innerHTML = `
    <div class="search-row-title"><span class="search-row-title-text">${highlight(name, ctx.q)}</span>${altName ? `<span class="search-row-title-alt">${highlight(altName, ctx.q)}</span>` : ''}</div>
    <div class="search-row-subtitle">${escapeHtml(subtitleParts.join(' · '))}</div>
  `;
  row.appendChild(body);

  row.innerHTML += `<span class="search-row-trailing search-row-chevron"><i class="hgi-stroke hgi-arrow-right-01" aria-hidden="true"></i></span>`;

  row.addEventListener('click', () => {
    // No own close transition — the Campus tab teleport is the navigation.
    dismissInstant();
    activateGroupTab('search-classrooms-container');
    goToBuilding(campusId, name);
  });
  return row;
}

function buildProfessorRow(item, ctx) {
  const { key, name, initials, sessionCount, examCount, next } = item;
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'search-row search-row--professor' + (ctx.large ? ' search-row--tophit' : '');
  row.dataset.row = '';
  row.dataset.professorKey = key;
  row.tabIndex = -1;

  row.appendChild(buildAvatarLead(initials, key, ctx.large));

  const body = document.createElement('div');
  body.className = 'search-row-body';
  const parts = [t('search.lessonsCount').replace('{n}', sessionCount)];
  if (examCount > 0) parts.push(t('search.examsCount').replace('{n}', examCount));
  let subtitle = parts.join(' · ');
  subtitle += ' · ' + (next
    ? `${t('search.next')}: ${fmtDay(next.date, ctx.dateFmt)} ${fmtTime(next.inizio, ctx.timeFmt)}, ${next.roomName}`
    : t('search.noUpcoming'));
  body.innerHTML = `
    <div class="search-row-title"><span class="search-row-title-text">${highlight(name, ctx.q)}</span></div>
    <div class="search-row-subtitle">${escapeHtml(subtitle)}</div>
  `;
  row.appendChild(body);
  row.innerHTML += `<span class="search-row-trailing search-row-chevron"><i class="hgi-stroke hgi-arrow-right-01" aria-hidden="true"></i></span>`;

  // stopPropagation: openProfessorView swaps resultsEl's content in place
  // (via a slide transition); without this the overlay's own backdrop-dismiss
  // listener (which checks panel.contains(e.target) once the click bubbles
  // up) can see a target mid-move and close the whole overlay — see the note
  // on the expand/show-all handlers below.
  row.addEventListener('click', (e) => { e.stopPropagation(); openProfessorView(key); });
  return row;
}

function itemKey(item) {
  return [item.type, item.code, item.title, item.section, item.professors.join(',')].join('|');
}

function buildSessionRow(s, ctx) {
  const past = new Date(`${s.date}T${s.fine}:00`).getTime() < Date.now();
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'search-session-row' + (past ? ' search-session-row--past' : '');
  b.dataset.openClassroom = s.roomId;
  b.dataset.highlightDate = s.date;
  b.dataset.highlightFrom = s.inizio;
  b.dataset.highlightTo = s.fine;
  b.tabIndex = -1;
  b.innerHTML =
    `<span class="search-session-body">` +
      `<span class="search-session-when">${escapeHtml(fmtWhen(s, ctx))}</span>` +
      `<span class="search-session-where">${escapeHtml(s.roomName)} · ${escapeHtml(s.buildingAltName || s.buildingName)}</span>` +
    `</span>` +
    `<span class="search-session-arrow"><i class="hgi-stroke hgi-arrow-right-01" aria-hidden="true"></i></span>`;
  return b;
}

// A session row for the professor view: several different courses share one
// day list, so (unlike the accordion's buildSessionRow) each row also carries
// its own course title, an exam badge/tint, and a "Now" marker.
function buildProfessorSessionRow(s, ctx) {
  const now = Date.now();
  const startTs = new Date(`${s.date}T${s.inizio}:00`).getTime();
  const endTs = new Date(`${s.date}T${s.fine}:00`).getTime();
  const past = endTs < now;
  const isNow = startTs <= now && now < endTs;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'search-session-row search-session-row--pv'
    + (past ? ' search-session-row--past' : '')
    + (s.isExam ? ' search-session-row--exam' : '');
  b.dataset.row = '';
  b.dataset.openClassroom = s.roomId;
  b.dataset.highlightDate = s.date;
  b.dataset.highlightFrom = s.inizio;
  b.dataset.highlightTo = s.fine;
  b.tabIndex = -1;
  const titleText = s.title || t('detail.occupied');
  b.innerHTML =
    `<span class="search-session-body">` +
      `<span class="search-session-when">${escapeHtml(fmtTime(s.inizio, ctx.timeFmt))}–${escapeHtml(fmtTime(s.fine, ctx.timeFmt))}` +
        (isNow ? `<span class="search-session-now">${escapeHtml(t('search.now'))}</span>` : '') +
      `</span>` +
      `<span class="search-session-title-line">` +
        `<span class="search-session-course">${escapeHtml(titleText)}</span>` +
        (s.isExam ? `<span class="timeline-popover-badge search-row-badge">${escapeHtml(t('detail.examLabel'))}</span>` : '') +
      `</span>` +
      `<span class="search-session-where">${escapeHtml(s.roomName)} · ${escapeHtml(s.buildingAltName || s.buildingName)}</span>` +
    `</span>` +
    `<span class="search-session-arrow"><i class="hgi-stroke hgi-arrow-right-01" aria-hidden="true"></i></span>`;
  return b;
}

// Shared shape for exam/lesson: a header row (title/subtitle/tile) that
// expands in place into every session on tap. Returns a wrapper <div>. The
// session list always exists in the DOM (collapsed via a grid-template-rows
// 0fr→1fr animation) rather than being built/torn down on toggle, so the
// whole app only ever has one expanded item at a time and toggling it never
// re-renders the rest of the list — see toggleExpandedItem/setItemExpanded.
function buildExpandableRow(headerRow, item, ctx) {
  const key = itemKey(item);
  const wrap = document.createElement('div');
  wrap.className = 'search-item';
  const expanded = expandedItemKey === key;
  headerRow.dataset.itemKey = key;
  headerRow.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  headerRow.classList.toggle('search-row--expanded', expanded);
  wrap.appendChild(headerRow);

  const collapse = document.createElement('div');
  collapse.className = 'search-collapse' + (expanded ? ' search-collapse--open' : '');
  const inner = document.createElement('div');
  inner.className = 'search-collapse-inner';
  const list = document.createElement('div');
  list.className = 'search-session-list';
  item.sessions.forEach(s => {
    const row = buildSessionRow(s, ctx);
    // Collapsed session rows must not be reachable by the desktop ↑/↓ nav —
    // data-row is only present while this item is the expanded one.
    if (expanded) row.dataset.row = '';
    list.appendChild(row);
  });
  inner.appendChild(list);
  collapse.appendChild(inner);
  wrap.appendChild(collapse);

  // stopPropagation: toggling mutates classes on the already-attached row in
  // place (no re-render), so this is mostly precautionary — kept for parity
  // with the show-all handler below, which does detach/rebuild.
  headerRow.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleExpandedItem(key);
  });
  return wrap;
}

function toggleExpandedItem(key) {
  const opening = expandedItemKey !== key;
  const prevKey = expandedItemKey;
  expandedItemKey = opening ? key : null;
  if (prevKey && prevKey !== key) setItemExpanded(prevKey, false);
  setItemExpanded(key, opening);
  refreshActionable();
}

// Mutates one already-rendered exam/lesson item's DOM in place (no rebuild of
// the rest of the list) so the grid-template-rows transition on .search-collapse
// actually has something to animate from/to.
function setItemExpanded(key, expanded) {
  const headerRow = resultsEl.querySelector(`[data-item-key="${CSS.escape(key)}"]`);
  if (!headerRow) return;
  const wrap = headerRow.closest('.search-item');
  const collapse = wrap?.querySelector('.search-collapse');
  if (!collapse) return;
  headerRow.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  headerRow.classList.toggle('search-row--expanded', expanded);
  collapse.classList.toggle('search-collapse--open', expanded);
  collapse.querySelectorAll('.search-session-row[data-row]').forEach(el => el.removeAttribute('data-row'));
  if (expanded) collapse.querySelectorAll('.search-session-row').forEach(el => { el.dataset.row = ''; });
}

function buildExamRow(item, ctx) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'search-row search-row--exam' + (ctx.large ? ' search-row--tophit' : '');
  row.dataset.row = '';
  row.tabIndex = -1;

  row.appendChild(buildIconTile('hgi-mortarboard-02', ctx.large, true));

  const body = document.createElement('div');
  body.className = 'search-row-body';
  const next = item.sessions.find(s => new Date(`${s.date}T${s.fine}:00`).getTime() > Date.now()) ?? item.sessions[0];
  const more = item.sessionCount - 1;
  body.innerHTML = `
    <div class="search-row-title"><span class="search-row-title-text">${highlight(item.title || t('detail.occupied'), ctx.q)}</span><span class="timeline-popover-badge search-row-badge">${t('detail.examLabel')}</span></div>
    <div class="search-row-subtitle">${escapeHtml(fmtWhen(next, ctx))}${more > 0 ? ' · ' + escapeHtml(t('search.moreSessions').replace('{n}', more)) : ''}</div>
  `;
  row.appendChild(body);
  row.innerHTML += `<span class="search-row-trailing search-row-chevron"><i class="hgi-stroke hgi-chevron-down" aria-hidden="true"></i></span>`;

  return buildExpandableRow(row, item, ctx);
}

function buildLessonRow(item, ctx) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'search-row search-row--lesson' + (ctx.large ? ' search-row--tophit' : '');
  row.dataset.row = '';
  row.tabIndex = -1;

  row.appendChild(buildIconTile('hgi-book-02', ctx.large, false));

  const body = document.createElement('div');
  body.className = 'search-row-body';
  const meta = [item.code != null ? String(item.code).padStart(6, '0') : null, item.professors.join(', ')].filter(Boolean).join(' · ');
  const next = item.sessions.find(s => new Date(`${s.date}T${s.fine}:00`).getTime() > Date.now()) ?? item.sessions[0];
  const more = item.sessionCount - 1;
  body.innerHTML = `
    <div class="search-row-title"><span class="search-row-title-text">${highlight(item.title || t('detail.occupied'), ctx.q)}</span></div>
    <div class="search-row-subtitle">${highlight(meta, ctx.q)}</div>
    <div class="search-row-extra">${escapeHtml(fmtWhen(next, ctx))}${more > 0 ? ' · ' + escapeHtml(t('search.moreSessions').replace('{n}', more)) : ''}</div>
  `;
  row.appendChild(body);
  row.innerHTML += `<span class="search-row-trailing search-row-chevron"><i class="hgi-stroke hgi-chevron-down" aria-hidden="true"></i></span>`;

  return buildExpandableRow(row, item, ctx);
}

const TOP_HIT_BUILD = {
  classroom: buildClassroomRow,
  building: buildBuildingRow,
  professor: buildProfessorRow,
  exam: buildExamRow,
  lesson: buildLessonRow,
};

/* ── Professor view ──────────────────────────────────────────────────────
   Swaps resultsEl's content for one professor's schedule, grouped by day.
   Data comes straight from getProfessorSchedule(key) — dynamic, so it's
   rebuilt on open, on occupancy arriving late (refreshActiveView, same hook
   renderResults already used), and on language switch. ── */

function professorViewCtx() {
  return {
    dateFmt: new Intl.DateTimeFormat(getLocale(), { weekday: 'short', day: 'numeric', month: 'short' }),
    timeFmt: createTimeFormatter(),
  };
}

function buildProfessorPane(container, key) {
  const ctx = professorViewCtx();
  const schedule = getProfessorSchedule(key);

  const header = document.createElement('div');
  header.className = 'search-pv-header';

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'search-pv-back';
  backBtn.dataset.row = '';
  backBtn.tabIndex = -1;
  backBtn.setAttribute('aria-label', t('search.backToResults'));
  backBtn.innerHTML = `<i class="hgi-stroke hgi-chevron-left" aria-hidden="true"></i>`;
  backBtn.addEventListener('click', (e) => { e.stopPropagation(); exitProfessorView(); });
  header.appendChild(backBtn);

  const identity = document.createElement('div');
  identity.className = 'search-pv-identity';
  identity.appendChild(buildAvatarLead(schedule ? schedule.initials : '?', key, true));
  const nameWrap = document.createElement('div');
  nameWrap.className = 'search-pv-name-wrap';
  const nameEl = document.createElement('div');
  nameEl.className = 'search-pv-name';
  nameEl.textContent = schedule ? schedule.name : '';
  nameWrap.appendChild(nameEl);
  if (schedule) {
    const countsEl = document.createElement('div');
    countsEl.className = 'search-pv-counts';
    const lessonCount = Math.max(0, schedule.sessionCount - schedule.examCount);
    const parts = [t('search.lessonsCount').replace('{n}', lessonCount)];
    if (schedule.examCount > 0) parts.push(t('search.examsCount').replace('{n}', schedule.examCount));
    countsEl.textContent = parts.join(' · ');
    nameWrap.appendChild(countsEl);
  }
  identity.appendChild(nameWrap);
  header.appendChild(identity);
  container.appendChild(header);

  if (!schedule) {
    const empty = document.createElement('div');
    empty.className = 'search-pv-empty';
    empty.innerHTML = `
      <i class="hgi-stroke hgi-calendar-remove-01" aria-hidden="true"></i>
      <p>${escapeHtml(t('search.professorEmpty'))}</p>
    `;
    container.appendChild(empty);
    return;
  }

  const meta = document.createElement('div');
  meta.className = 'search-pv-meta';
  if (schedule.courses.length) {
    const chips = document.createElement('div');
    chips.className = 'search-pv-courses';
    const CHIP_CAP = 6;
    schedule.courses.slice(0, CHIP_CAP).forEach(course => {
      const chip = document.createElement('span');
      chip.className = 'search-pv-course-chip';
      chip.textContent = course;
      chips.appendChild(chip);
    });
    if (schedule.courses.length > CHIP_CAP) {
      const more = document.createElement('span');
      more.className = 'search-pv-course-chip search-pv-course-chip--more';
      more.textContent = t('search.moreCourses').replace('{n}', schedule.courses.length - CHIP_CAP);
      chips.appendChild(more);
    }
    meta.appendChild(chips);
  }
  const note = document.createElement('div');
  note.className = 'search-pv-range-note';
  note.textContent = t('search.professorDaysNote').replace('{n}', occupancyDays.length);
  meta.appendChild(note);
  container.appendChild(meta);

  const body = document.createElement('div');
  body.className = 'search-pv-body';
  schedule.days.forEach(day => {
    const dayHeader = document.createElement('div');
    dayHeader.className = 'search-pv-day-header';
    dayHeader.textContent = fmtDay(day.date, ctx.dateFmt);
    body.appendChild(dayHeader);
    const list = document.createElement('div');
    list.className = 'search-section-list search-section-list--spaced';
    day.sessions.forEach(s => list.appendChild(buildProfessorSessionRow(s, ctx)));
    body.appendChild(list);
  });
  container.appendChild(body);
}

// Slides resultsEl's content from whatever it currently holds to a freshly
// built pane. `direction` is 'forward' (professor in from the right, results
// out to the left) or 'backward' (reversed). Reduced motion: swap instantly,
// no motion.
function transitionPane(builder, direction, onLanded) {
  const oldWrap = document.createElement('div');
  oldWrap.className = 'search-pane';
  while (resultsEl.firstChild) oldWrap.appendChild(resultsEl.firstChild);

  const newWrap = document.createElement('div');
  newWrap.className = 'search-pane';
  builder(newWrap);

  const land = () => {
    resultsEl.replaceChildren(newWrap);
    refreshActionable();
    onLanded?.();
  };

  if (reduceMotionMQ.matches) {
    land();
    return;
  }

  const track = document.createElement('div');
  track.className = 'search-slide-track';
  if (direction === 'forward') track.append(oldWrap, newWrap);
  else track.append(newWrap, oldWrap);
  resultsEl.replaceChildren(track);
  resultsEl.scrollTop = 0;
  track.style.transform = direction === 'forward' ? 'translateX(0%)' : 'translateX(-50%)';
  void track.offsetWidth; // force layout so the transition below animates from this starting point
  track.style.transition = 'transform 0.36s var(--lg-ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1))';
  requestAnimationFrame(() => {
    track.style.transform = direction === 'forward' ? 'translateX(-50%)' : 'translateX(0%)';
  });

  let done = false;
  const finish = (e) => {
    if (done) return;
    if (e && e.target !== track) return;
    done = true;
    track.removeEventListener('transitionend', finish);
    land();
  };
  track.addEventListener('transitionend', finish);
  setTimeout(finish, 500); // fallback if transitionend doesn't fire
}

function openProfessorView(key) {
  if (!isOpen || currentView === 'professor') return;
  resultsScrollPos = resultsEl.scrollTop;
  currentView = 'professor';
  currentProfessorKey = key;
  transitionPane((el) => buildProfessorPane(el, key), 'forward');
}

function exitProfessorView() {
  if (currentView !== 'professor') return;
  currentView = 'results';
  currentProfessorKey = null;
  const query = input.value;
  const restoreScroll = resultsScrollPos;
  transitionPane((el) => buildResultsPane(el, query), 'backward', () => {
    resultsEl.scrollTop = restoreScroll;
  });
}

// Rebuilds whichever panel is currently showing — used when occupancy data
// finishes loading late (scheduleOccRecheck) or the language switches. Never
// animated: it's a data refresh, not a navigation.
function refreshActiveView() {
  const scrollTop = resultsEl.scrollTop;
  resultsEl.replaceChildren();
  if (currentView === 'professor' && currentProfessorKey) {
    buildProfessorPane(resultsEl, currentProfessorKey);
  } else {
    buildResultsPane(resultsEl, input.value);
  }
  resultsEl.scrollTop = scrollTop;
  refreshActionable();
}

/* ── Results rendering ───────────────────────────────────────────────────── */

// Builds the results list (Top Hit + sections) into `container`. Doesn't
// touch currentView/currentProfessorKey — callers decide whether this is a
// plain re-render or the landing pane of a professor-view exit.
function buildResultsPane(container, query) {
  const q = query.trim();
  clearTimeout(occRecheckTimer);

  if (!q) { lastQuery = null; return; } // idle: empty results area, placeholder styling handles the hint

  if (q !== lastQuery) { expandedSections.clear(); expandedItemKey = null; lastQuery = q; }

  const result = runSearch(q);
  const { topHit, classrooms, buildings, professors, exams, lessons } = result;

  if (!topHit) {
    const state = document.createElement('div');
    state.className = 'search-empty-state';
    state.innerHTML = `
      <i class="hgi-stroke hgi-search-remove empty-container-icon" aria-hidden="true"></i>
      <p class="empty-container-title">${t('search.emptyTitle')}</p>
      <p class="empty-container-subtitle">${t('search.emptySubtitle')}</p>
    `;
    container.appendChild(state);
    if (!hasOccupationData()) scheduleOccRecheck(query);
    return;
  }

  const ctx = { q, dateFmt: new Intl.DateTimeFormat(getLocale(), { weekday: 'short', day: 'numeric', month: 'short' }), timeFmt: createTimeFormatter(), large: false };

  const topWrap = document.createElement('div');
  topWrap.className = 'search-tophit-wrap';
  topWrap.appendChild(sectionLabel(t('search.topHit')));
  const topRow = TOP_HIT_BUILD[topHit.type](topHit, { ...ctx, large: true });
  const topCard = document.createElement('div');
  topCard.className = 'search-tophit-row'; // same grouped-list background as the sections below
  if (topHit.type === 'professor') {
    // Spotlight-style contact-card tint: a muted/deep tone of the same hue as
    // the avatar (never the avatar's own vivid tone), so the avatar still
    // stands out on top of it. --text-color-primary is re-scoped locally so
    // every descendant (title/subtitle/chevron, all driven off that token via
    // color-mix) picks up a legible pairing in both themes automatically.
    topCard.classList.add('search-tophit-row--professor');
    topCard.style.setProperty('--prof-hue', String(hueFromKey(topHit.key)));
  }
  topCard.appendChild(topRow);
  container.appendChild(topWrap);
  container.appendChild(topCard);

  const sectionData = { classrooms, buildings, professors, exams, lessons };
  for (const sec of SECTIONS) {
    const data = sectionData[sec.key];
    // The Top Hit isn't repeated in its own section.
    const items = data.items.filter(it => it !== topHit);
    if (!items.length) continue;

    container.appendChild(sectionLabel(t(sec.labelKey)));
    const list = document.createElement('div');
    list.className = 'search-section-list';
    // Exam/lesson groups get their own separated, rounded blocks rather than
    // being fused into one inset list — they're accordions, not plain rows.
    if (sec.key === 'exams' || sec.key === 'lessons') list.classList.add('search-section-list--spaced');
    const expanded = expandedSections.has(sec.key);
    const shown = expanded ? items : items.slice(0, SECTION_CAP);
    shown.forEach(item => list.appendChild(sec.build(item, ctx)));
    container.appendChild(list);

    if (!expanded && items.length > SECTION_CAP) {
      const remaining = items.length - SECTION_CAP;
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'search-show-all';
      more.dataset.row = '';
      more.tabIndex = -1;
      more.textContent = t('search.showAll').replace('{n}', remaining);
      // stopPropagation — see the identical note on buildProfessorRow's click.
      more.addEventListener('click', (e) => { e.stopPropagation(); expandedSections.add(sec.key); rerenderPreservingScroll(); });
      container.appendChild(more);
    } else if (data.total - 1 > items.length) {
      // Even fully expanded, the capped index held fewer than the true total.
      container.appendChild(tooManyNotice(items.length));
    }
  }

  if (!hasOccupationData()) scheduleOccRecheck(query);
}

// Top-level entry point for a plain (non-animated) results render: a typed
// query, opening the overlay, or clearing the field. Always leaves/keeps the
// results view — typing while the professor view is open returns to it.
function renderResults(query) {
  currentView = 'results';
  currentProfessorKey = null;
  resultsEl.replaceChildren();
  buildResultsPane(resultsEl, query);
  refreshActionable();
}

// Redraws the current query's results without resetting expand/collapse state
// (query is unchanged) or losing scroll position — used by "Show all", which
// (unlike the exam/lesson accordion) does need a full rebuild since more rows
// are appearing.
function rerenderPreservingScroll() {
  const scrollTop = resultsEl.scrollTop;
  renderResults(input.value);
  resultsEl.scrollTop = scrollTop;
}

function scheduleOccRecheck(query, tries = 0) {
  clearTimeout(occRecheckTimer);
  if (tries > 6) return;
  occRecheckTimer = setTimeout(() => {
    if (!isOpen || input.value !== query) return;
    if (hasOccupationData()) refreshActiveView();
    else scheduleOccRecheck(query, tries + 1);
  }, 1200);
}

/* ── Keyboard navigation (desktop only) ─────────────────────────────────────
   Focus stays in the input; ↑/↓ move a visual selection across every
   data-row element in DOM order (Top Hit, section rows, "Show all", expanded
   session rows, or — inside the professor view — the back button and every
   session row), Enter activates it. The Top Hit (or the back button) is
   selected by default after every render. */

const desktopMQ = matchMedia('(min-width: 600px)');
let actionable = [];
let selectedIndex = 0;

function refreshActionable() {
  actionable = [...resultsEl.querySelectorAll('[data-row]')];
  selectedIndex = 0;
  updateSelectionVisual();
}

// The visible "selected" highlight is a desktop-only, keyboard-nav concept —
// on mobile (no arrow keys) every render would otherwise permanently paint
// the Top Hit as if pressed, which reads as a stray highlighted box rather
// than a hint.
function updateSelectionVisual() {
  const active = desktopMQ.matches;
  actionable.forEach((el, i) => el.classList.toggle('search-row--selected', active && i === selectedIndex));
  const current = active ? actionable[selectedIndex] : null;
  if (current) {
    if (!current.id) current.id = `search-row-${Math.random().toString(36).slice(2, 9)}`;
    input.setAttribute('aria-activedescendant', current.id);
    current.scrollIntoView({ block: 'nearest' });
  } else {
    input.removeAttribute('aria-activedescendant');
  }
}

function onInputKeyDown(e) {
  if (!desktopMQ.matches || !actionable.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedIndex = Math.min(selectedIndex + 1, actionable.length - 1);
    updateSelectionVisual();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedIndex = Math.max(selectedIndex - 1, 0);
    updateSelectionVisual();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    actionable[selectedIndex]?.click();
  }
}

/* ── Viewport / open / close plumbing (unchanged) ───────────────────────── */

// Mobile anchors the search bar at a fixed top offset (the header's old
// slot), but iOS Safari can pan the *visual* viewport down when the keyboard
// opens rather than shrinking it, which would carry a `top`-anchored fixed
// element off screen with it. Track visualViewport and expose its offset and
// height as custom properties so the CSS can compensate: --search-vv-top
// shifts the panel down by however much the viewport has panned, and
// --search-vv-height caps the results' height at the visible area (which
// already excludes the keyboard). If these numbers are ever off, the failure
// is benign — the list scrolls a bit under the keyboard, the field is never
// hidden.
function onViewportResize() {
  const vv = window.visualViewport;
  if (!vv) return;
  overlay.style.setProperty('--search-vv-top', vv.offsetTop + 'px');
  overlay.style.setProperty('--search-vv-height', vv.height + 'px');
}

function startViewportTracking() {
  const vv = window.visualViewport;
  if (!vv) return;
  onViewportResize();
  vv.addEventListener('resize', onViewportResize);
  vv.addEventListener('scroll', onViewportResize);
}

function stopViewportTracking() {
  const vv = window.visualViewport;
  if (vv) {
    vv.removeEventListener('resize', onViewportResize);
    vv.removeEventListener('scroll', onViewportResize);
  }
  overlay.style.removeProperty('--search-vv-top');
  overlay.style.removeProperty('--search-vv-height');
}

function conceal() {
  overlay.classList.remove('visible');
  overlay.setAttribute('hidden', '');
  document.body.classList.remove('search-overlay-open');
  clearTimeout(occRecheckTimer);
  stopViewportTracking();
  unlockScroll();
  window.scrollTo(0, savedScrollPos);
}

// ── Scroll lock ──────────────────────────────────────────────────────────
// The panel usually doesn't fill the viewport, so a wheel/touch scroll over
// it (or the backdrop) would otherwise fall through to the tab behind — same
// fix as components/settings.js's popup. `.search-scrollable` marks the one
// element allowed to consume the gesture (results and the in-place professor
// view both reuse this same container), and only when it actually overflows.
function preventScroll(e) {
  // Let caret placement / text-selection drags in the search bar through untouched.
  if (e.target.closest('.search-overlay-header')) return;
  const scrollable = e.target.closest('.search-scrollable');
  if (scrollable && scrollable.scrollHeight > scrollable.clientHeight) return;
  e.preventDefault();
}

function lockScroll() {
  window.addEventListener('wheel', preventScroll, { passive: false });
  window.addEventListener('touchmove', preventScroll, { passive: false });
}

function unlockScroll() {
  window.removeEventListener('wheel', preventScroll);
  window.removeEventListener('touchmove', preventScroll);
}

// Land the caret in the field ready to type; select any leftover query so the
// first keystroke replaces it. Must run inside the FAB-tap callstack — iOS
// Safari only opens the keyboard for a focus() that's user-initiated.
function grabInput() {
  input.focus({ preventScroll: true });
  input.select();
}

export async function openSearchOverlay() {
  if (isOpen || !overlay) return;
  isOpen = true;
  savedScrollPos = window.scrollY;

  // Unhide + focus synchronously (still inside the FAB-tap callstack, so iOS
  // opens the keyboard). The overlay is only opacity:0 here, not display:none,
  // so focus() works. `search-overlay-open` (which hides the FAB/nav) is held
  // back until inside the VT callback so the FAB stays in the "old" snapshot
  // to morph from. The panel's top offset doesn't depend on the keyboard at
  // all (mobile Spotlight layout — see search-overlay.css), so it doesn't
  // matter that Safari resizes/pans the visual viewport late.
  overlay.removeAttribute('hidden');
  grabInput();
  lockScroll();

  const fab = fabEl();
  if (document.startViewTransition && fab) {
    fab.style.viewTransitionName = MORPH_NAME;
    beginChromeVT();
    const vt = document.startViewTransition(() => {
      fab.style.viewTransitionName = '';
      document.body.classList.add('search-overlay-open');
      overlay.classList.add('visible');
      startViewportTracking();
      const bar = barEl();
      if (bar) bar.style.viewTransitionName = MORPH_NAME;
    });
    vt.finished.finally(() => {
      const bar = barEl();
      if (bar) bar.style.viewTransitionName = '';
      endChromeVT();
      // Re-grab only if the transition stole focus (some engines blur on the
      // DOM churn); avoids yanking the selection back if the user's already typing.
      if (isOpen && document.activeElement !== input) grabInput();
    });
  } else {
    document.body.classList.add('search-overlay-open');
    requestAnimationFrame(() => overlay.classList.add('visible'));
    startViewportTracking();
    grabInput();
  }

  if (isOpen) renderResults(input.value);
}

export function closeSearchOverlay() {
  if (!isOpen || !overlay) return;
  isOpen = false;
  clearTimeout(debounce);
  input.blur();

  const fab = fabEl();
  if (document.startViewTransition && fab) {
    const bar = barEl();
    if (bar) bar.style.viewTransitionName = MORPH_NAME;
    beginChromeVT();
    const vt = document.startViewTransition(() => {
      if (bar) bar.style.viewTransitionName = '';
      conceal();
      fab.style.viewTransitionName = MORPH_NAME;
    });
    vt.finished.finally(() => {
      fab.style.viewTransitionName = '';
      endChromeVT();
    });
  } else {
    overlay.classList.remove('visible');
    const done = () => conceal();
    overlay.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 260); // fallback if transitionend doesn't fire
  }
}

// Drop the overlay with no transition of its own — for when the click that
// dismisses it also navigates somewhere that runs its own transition (info
// page, classroom detail, a building jump to the Campus tab), so the two
// don't fight.
function dismissInstant() {
  if (!isOpen) return;
  isOpen = false;
  clearTimeout(debounce);
  input.blur();
  const fab = fabEl();
  if (fab) fab.style.viewTransitionName = '';
  document.documentElement.classList.remove('search-vt');
  conceal();
}

export function initSearchOverlay() {
  overlay = document.getElementById('search-overlay');
  if (!overlay) return;
  panel = overlay.querySelector('.search-overlay-panel');
  input = document.getElementById('classroom-search-input');
  clearBtn = document.getElementById('classroom-search-clear');
  closeBtn = document.getElementById('search-overlay-close');
  resultsEl = document.getElementById('search-overlay-results');

  closeBtn.addEventListener('click', () => {
    closeSearchOverlay();
  });

  // Tap the blurred backdrop (outside the panel) to dismiss.
  overlay.addEventListener('click', (e) => {
    if (!panel.contains(e.target)) closeSearchOverlay();
  });

  document.addEventListener('keydown', (e) => {
    if (!isOpen || e.key !== 'Escape') return;
    // Esc backs out of the professor view first; only closes the overlay
    // from the results list.
    if (currentView === 'professor') exitProfessorView();
    else closeSearchOverlay();
  });

  // Opening a result navigates to the classroom detail page — get the
  // overlay out of the way so the card → page morph isn't behind the blur.
  resultsEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-open-classroom]')) closeSearchOverlay();
  });

  // The header sits above the overlay (z-index), so its controls stay
  // clickable while search is open. Any such click (info page, settings, …)
  // should take the overlay down first — the destination runs its own
  // transition. Capture phase so this beats the buttons' own handlers.
  document.querySelector('.header')?.addEventListener('click', () => {
    if (isOpen) dismissInstant();
  }, true);

  // Safety net: any other hash route opened while we're open takes it down too
  // (isOpen is already false by here for the result-card path above).
  window.addEventListener('hashchange', () => {
    if (isOpen && location.hash) dismissInstant();
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    input.dispatchEvent(new Event('input'));
    input.focus();
  });

  input.addEventListener('input', () => {
    clearTimeout(debounce);
    const query = input.value;
    if (!query.trim()) { renderResults(''); return; }
    debounce = setTimeout(() => renderResults(query), DEBOUNCE_MS);
  });

  input.addEventListener('keydown', onInputKeyDown);

  onLanguageSwitch(() => { if (isOpen) refreshActiveView(); });
}
