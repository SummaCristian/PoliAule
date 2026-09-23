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
//
// MOTION: every change to the results is animated. A new query's results are
// diffed against the ones on screen by components/search-motion.js (rows and
// sections grow in, collapse out and glide to their new places, all off one
// interruptible spring); the results box itself materialises under the bar
// and dissolves back when the field is cleared (setResultsBox); the professor
// view slides on a spring that can be turned around mid-flight (startSlide);
// and a classroom result hands itself to the detail page's zoom as the card
// it grows out of (handOffToDetail).

import { t, getLocale, onLanguageSwitch } from '../i18n.js';
import { escapeHtml, highlight } from '../utils/html.js';
import { createTimeFormatter } from '../utils/time-format.js';
import { fetchPhotoUrl, photoUrlCache } from '../utils/photo.js';
import { runSearch, getProfessorSchedule, hasOccupationData } from '../classroom-search-data.js';
import { classroomsData as occupancyDays } from '../available-rooms-script.js';
import { activateGroupTab } from './bottom-nav.js';
import { goToBuilding } from './campus-buildings.js';
import { morphInto, settleMorph, isSettled, fadeIn, ClockedSpring } from './search-motion.js';
import { createBackButton, createSegmentedControl } from 'vitrium';

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
  // `icon`: the section title's, matching the rest of the app where there's a
  // counterpart (the Campus tab's for classrooms) and the rows' own tiles
  // otherwise. `spaced`: rows as separate rounded blocks rather than one
  // fused inset list — classroom rows (whose photo gives them their own
  // rounded shape) and the exam/lesson accordions.
  { key: 'classrooms', type: 'classroom', labelKey: 'search.sectionClassrooms', icon: 'hgi-university', spaced: true, build: buildClassroomRow },
  { key: 'buildings', type: 'building', labelKey: 'search.sectionBuildings', icon: 'hgi-building-06', build: buildBuildingRow },
  { key: 'professors', type: 'professor', labelKey: 'search.sectionProfessors', icon: 'hgi-user', build: buildProfessorRow },
  { key: 'exams', type: 'exam', labelKey: 'search.sectionExams', icon: 'hgi-mortarboard-02', spaced: true, build: buildExamRow },
  { key: 'lessons', type: 'lesson', labelKey: 'search.sectionLessons', icon: 'hgi-book-02', spaced: true, build: buildLessonRow },
];

// Per-section "show all" state and the single currently-expanded exam/lesson
// item (accordion — opening one closes any other). Both reset when the query
// text changes, but survive a re-render triggered by the same query (toggling
// a section, occupancy data arriving late, or a professor-view round trip).
let expandedSections = new Set();
let expandedItemKey = null;
let lastQuery = null;

/* ── Small building blocks ──────────────────────────────────────────────── */

// A smaller take on the app's .section-header-title: icon + title.
function sectionLabel(text, icon) {
  const el = document.createElement('div');
  el.className = 'search-section-label';
  el.innerHTML = `<i class="hgi-stroke ${icon} search-section-label-icon" aria-hidden="true"></i><span>${escapeHtml(text)}</span>`;
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

  // The back button isn't part of the pane: it's Vitrium's glass back button,
  // pinned over the box's corner (see backBtn below); the header leaves it
  // room.
  const header = document.createElement('div');
  header.className = 'search-pv-header';

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
  const lessonCount = schedule.sessionCount - schedule.examCount;
  let filter = 'all';
  const body = document.createElement('div');
  body.className = 'search-pv-body';
  // Lessons and exams both on the schedule: a Vitrium segmented control
  // narrows it to one kind. The days re-render through search-motion.js, so
  // the sessions leaving collapse out and the rest close up, like the results.
  if (schedule.examCount > 0 && lessonCount > 0) {
    const seg = document.createElement('div');
    seg.className = 'search-pv-filter';
    createSegmentedControl(seg, {
      items: [
        { value: 'all', label: t('search.filterAll') },
        { value: 'lessons', label: t('search.sectionLessons') },
        { value: 'exams', label: t('search.sectionExams') },
      ],
      value: filter,
      onSelect(v, { silent } = {}) {
        if (silent || v === filter) return;
        filter = v;
        morphInto(body, buildProfessorDays(schedule, filter, ctx), { scroller: resultsEl });
        refreshActionable();
      },
    });
    meta.appendChild(seg);
  }
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
  // Beside the identity when the box is wide enough, under it otherwise (a
  // container query on the pane, search-overlay.css).
  header.appendChild(meta);

  body.appendChild(buildProfessorDays(schedule, filter, ctx));
  container.appendChild(body);
}

// The schedule, grouped by day, keyed for search-motion.js (the filter
// animates whole days in and out), each titled like a results section.
function buildProfessorDays(schedule, filter, ctx) {
  const days = keyed(document.createElement('div'), 'days');
  days.className = 'search-pv-days';
  for (const day of schedule.days) {
    const sessions = day.sessions.filter(s => filter === 'all' || (filter === 'exams') === !!s.isExam);
    if (!sessions.length) continue;
    const dayEl = keyed(document.createElement('div'), `day:${day.date}`);
    dayEl.className = 'search-pv-day';
    // Same title as the results' sections (icon + bold sentence case).
    dayEl.appendChild(sectionLabel(fmtDay(day.date, ctx.dateFmt), 'hgi-calendar-03'));
    const list = keyed(document.createElement('div'), 'list');
    list.className = 'search-section-list search-section-list--spaced';
    sessions.forEach(s => list.appendChild(keyed(buildProfessorSessionRow(s, ctx), `s:${s.roomId}:${s.inizio}:${s.title ?? ''}`)));
    dayEl.appendChild(list);
    days.appendChild(dayEl);
  }
  return days;
}

function newProfessorPane(key) {
  const pane = document.createElement('div');
  pane.className = 'search-pane search-pane--professor';
  buildProfessorPane(pane, key);
  return pane;
}

/* ── Results ⇄ professor view slide ──────────────────────────────────────
   Both panes sit side by side on a 200%-wide track. One spring, x (0 = the
   results on the left, 1 = the professor on the right), drives the track, a
   cross-fade between the two and the box's height, which morphs from one
   pane's height to the other's. Each pane keeps its own scroll offset while
   it's on the track (drawn as a translate), so the one leaving doesn't jump
   to its top first. The spring is only ever retargeted, never restarted:
   backing out while the professor is still sliding in turns the same motion
   around, velocity and all. ── */

// Response 0.32s, damping ratio 1: k = (2π / 0.32)², c = 2·√k.
const SLIDE_SPRING = { stiffness: 386, damping: 39.3, mass: 1 };
let slide = null;

// A pane's resting height in the box, and how far it can scroll there.
function measurePane(pane) {
  resultsEl.replaceChildren(pane);
  return { h: resultsEl.offsetHeight, maxScroll: resultsEl.scrollHeight - resultsEl.clientHeight };
}

// Vitrium's glass back button, pinned over the top-left corner of the box
// (outside the scrolling content, so it stays put as the schedule scrolls
// under it). It rides the slide: fading and growing in as the professor view
// comes in, and back out as it leaves.
let backBtn = null;

function setBackProgress(x) {
  if (!backBtn) return;
  backBtn.style.opacity = x >= 1 ? '' : `${x}`;
  backBtn.style.transform = x >= 1 ? '' : `scale(${0.6 + 0.4 * x})`;
  const shown = x > 0.5;
  backBtn.classList.toggle('search-pv-back--shown', shown);
  backBtn.inert = !shown;
}

function renderSlide() {
  const { spring, track, left, right, hL, hR } = slide;
  const x = Math.min(1, Math.max(0, spring.value));
  setBackProgress(x);
  // The box isn't really scrolled while the panes are on the track (their
  // offsets are translates), so the edge fade follows them instead.
  setEdgeFade(slide.leftScroll + (slide.rightScroll - slide.leftScroll) * x,
    slide.leftRest + (slide.rightRest - slide.leftRest) * x);
  track.style.translate = `${-50 * x}% 0`;
  left.style.opacity = `${1 - 0.7 * x}`;
  right.style.opacity = `${0.3 + 0.7 * x}`;
  resultsEl.style.height = `${hL + (hR - hL) * x}px`;
}

function landSlide() {
  if (!slide) return;
  const { spring, to, left, right, leftScroll, rightScroll } = slide;
  slide = null;
  spring.dispose();
  const pane = to === 1 ? right : left;
  pane.style.translate = '';
  pane.style.opacity = '';
  resultsEl.classList.remove('search-overlay-results--sliding');
  resultsEl.style.height = '';
  resultsEl.replaceChildren(pane);
  resultsEl.scrollTop = to === 1 ? rightScroll : leftScroll;
  setBackProgress(to);
  updateEdgeFade();
  refreshActionable();
}

function retargetSlide(to) {
  slide.to = to;
  slide.spring.to(to, SLIDE_SPRING);
}

// `from` is the side currently on screen (0 = left, 1 = right); the other one
// is the pane being navigated to.
function startSlide({ left, right, leftScroll, rightScroll, from, profKey, query }) {
  const target = from === 0 ? right : left;
  if (reduceMotionMQ.matches) {
    resultsEl.replaceChildren(target);
    resultsEl.scrollTop = from === 0 ? rightScroll : leftScroll;
    setBackProgress(1 - from);
    fadeIn(target);
    refreshActionable();
    return;
  }

  const hOn = resultsEl.offsetHeight;
  const restOn = resultsEl.scrollHeight - resultsEl.clientHeight - resultsEl.scrollTop;
  const other = measurePane(target);
  const clampScroll = (v) => Math.max(0, Math.min(v, other.maxScroll));
  if (from === 0) rightScroll = clampScroll(rightScroll);
  else leftScroll = clampScroll(leftScroll);
  // How much is left below each pane's scroll position, for the edge fade.
  const restOther = other.maxScroll - (from === 0 ? rightScroll : leftScroll);

  const track = document.createElement('div');
  track.className = 'search-slide-track';
  track.append(left, right);
  resultsEl.classList.add('search-overlay-results--sliding');
  resultsEl.replaceChildren(track);
  resultsEl.scrollTop = 0;
  left.style.translate = `0 ${-leftScroll}px`;
  right.style.translate = `0 ${-rightScroll}px`;

  const spring = new ClockedSpring(from, () => {
    if (!slide || slide.spring !== spring) return;
    renderSlide();
    if (spring.resting || isSettled(spring, slide.to)) landSlide();
  });
  slide = {
    track, left, right, leftScroll, rightScroll, spring, profKey, query, to: from,
    hL: from === 0 ? hOn : other.h,
    hR: from === 0 ? other.h : hOn,
    leftRest: from === 0 ? restOn : restOther,
    rightRest: from === 0 ? restOther : restOn,
  };
  // Nothing is selectable until a pane has landed.
  actionable = [];
  updateSelectionVisual();
  renderSlide();
  retargetSlide(1 - from);
}

function openProfessorView(key) {
  if (!isOpen) return;
  if (slide) {
    // Still sliding back to the results: the same professor turns it around.
    if (slide.to === 0 && slide.profKey === key) {
      currentView = 'professor';
      currentProfessorKey = key;
      retargetSlide(1);
      return;
    }
    landSlide();
  }
  if (currentView === 'professor') return;
  settleMorph();
  const resultsPane = resultsEl.firstElementChild;
  if (!resultsPane) return;
  resultsScrollPos = resultsEl.scrollTop;
  currentView = 'professor';
  currentProfessorKey = key;
  startSlide({
    left: resultsPane, right: newProfessorPane(key),
    leftScroll: resultsScrollPos, rightScroll: 0,
    from: 0, profKey: key, query: input.value,
  });
}

function exitProfessorView() {
  if (currentView !== 'professor') return;
  const profKey = currentProfessorKey;
  currentView = 'results';
  currentProfessorKey = null;
  if (slide) {
    // Still sliding in: the results it left are intact on the track, so just
    // turn around — unless the query has changed since.
    if (slide.to === 1 && slide.query === input.value) { retargetSlide(0); return; }
    landSlide();
  }
  const profPane = resultsEl.firstElementChild;
  const resultsPane = newResultsPane();
  buildResultsPane(resultsPane, input.value);
  startSlide({
    left: resultsPane, right: profPane,
    leftScroll: resultsScrollPos, rightScroll: resultsEl.scrollTop,
    from: 1, profKey, query: input.value,
  });
}

// Rebuilds whichever panel is currently showing — used when occupancy data
// finishes loading late (scheduleOccRecheck) or the language switches. The
// results animate into their new shape like any other render; the professor
// view is swapped in place.
function refreshActiveView() {
  landSlide();
  if (currentView === 'professor' && currentProfessorKey) {
    const scrollTop = resultsEl.scrollTop;
    resultsEl.replaceChildren(newProfessorPane(currentProfessorKey));
    resultsEl.scrollTop = scrollTop;
    refreshActionable();
  } else {
    renderResults(input.value);
  }
}

/* ── Results rendering ───────────────────────────────────────────────────── */

// Every animated piece of the results carries a data-anim-key, stable across
// renders for the same thing, which is what search-motion.js matches on.
function animKeyFor(type, item) {
  switch (type) {
    case 'classroom': return `c:${item.room.id}`;
    case 'building': return `b:${item.campusId}:${item.name}`;
    case 'professor': return `p:${item.key}`;
    default: return `${type}:${itemKey(item)}`;
  }
}

function keyed(el, key) {
  el.dataset.animKey = key;
  return el;
}

function block(key) {
  const el = document.createElement('div');
  el.className = 'search-block';
  return keyed(el, key);
}

function newResultsPane() {
  const pane = document.createElement('div');
  pane.className = 'search-pane search-pane--results';
  return keyed(pane, 'results');
}

// Builds the results list (Top Hit + sections) into `container`, as one
// keyed block per section. Doesn't touch currentView/currentProfessorKey —
// callers decide whether this is a plain re-render or the landing pane of a
// professor-view exit.
function buildResultsPane(container, query) {
  const q = query.trim();
  clearTimeout(occRecheckTimer);

  if (!q) { lastQuery = null; return; } // idle: empty results area, placeholder styling handles the hint

  if (q !== lastQuery) { expandedSections.clear(); expandedItemKey = null; lastQuery = q; }

  const result = runSearch(q);
  const { topHit, classrooms, buildings, professors, exams, lessons } = result;

  if (!topHit) {
    const empty = block('empty');
    const state = document.createElement('div');
    state.className = 'search-empty-state';
    state.innerHTML = `
      <i class="hgi-stroke hgi-search-remove empty-container-icon" aria-hidden="true"></i>
      <p class="empty-container-title">${t('search.emptyTitle')}</p>
      <p class="empty-container-subtitle">${t('search.emptySubtitle')}</p>
    `;
    empty.appendChild(state);
    container.appendChild(empty);
    if (!hasOccupationData()) scheduleOccRecheck(query);
    return;
  }

  const ctx = { q, dateFmt: new Intl.DateTimeFormat(getLocale(), { weekday: 'short', day: 'numeric', month: 'short' }), timeFmt: createTimeFormatter(), large: false };

  const top = block('tophit');
  top.appendChild(keyed(sectionLabel(t('search.topHit'), 'hgi-sparkles'), 'label'));
  // A swap slot: a different Top Hit cross-fades in place of the old one
  // while the slot's height morphs between them (see search-motion.js).
  const slot = keyed(document.createElement('div'), 'slot');
  slot.className = 'search-tophit-slot';
  slot.setAttribute('data-anim-swap', '');
  const topRow = TOP_HIT_BUILD[topHit.type](topHit, { ...ctx, large: true });
  const topCard = keyed(document.createElement('div'), `hit:${animKeyFor(topHit.type, topHit)}`);
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
  slot.appendChild(topCard);
  top.appendChild(slot);
  container.appendChild(top);

  const sectionData = { classrooms, buildings, professors, exams, lessons };
  for (const sec of SECTIONS) {
    const data = sectionData[sec.key];
    // The Top Hit isn't repeated in its own section.
    const items = data.items.filter(it => it !== topHit);
    if (!items.length) continue;

    const blk = block(`sec:${sec.key}`);
    blk.appendChild(keyed(sectionLabel(t(sec.labelKey), sec.icon), 'label'));
    const list = keyed(document.createElement('div'), 'list');
    list.className = 'search-section-list';
    if (sec.spaced) list.classList.add('search-section-list--spaced');
    const expanded = expandedSections.has(sec.key);
    const shown = expanded ? items : items.slice(0, SECTION_CAP);
    shown.forEach(item => list.appendChild(keyed(sec.build(item, ctx), animKeyFor(sec.type, item))));
    blk.appendChild(list);

    if (!expanded && items.length > SECTION_CAP) {
      const remaining = items.length - SECTION_CAP;
      const more = keyed(document.createElement('button'), 'more');
      more.type = 'button';
      more.className = 'search-show-all';
      more.dataset.row = '';
      more.tabIndex = -1;
      more.textContent = t('search.showAll').replace('{n}', remaining);
      // stopPropagation — see the identical note on buildProfessorRow's click.
      more.addEventListener('click', (e) => { e.stopPropagation(); expandedSections.add(sec.key); renderResults(input.value); });
      blk.appendChild(more);
    } else if (data.total - 1 > items.length) {
      // Even fully expanded, the capped index held fewer than the true total.
      blk.appendChild(keyed(tooManyNotice(items.length), 'notice'));
    }
    container.appendChild(blk);
  }

  if (!hasOccupationData()) scheduleOccRecheck(query);
}

/* ── Scroll-edge fade ─────────────────────────────────────────────────────
   The results scroller's mask (search-overlay.css) fades each edge by as much
   as there is left to scroll that way, capped at --search-fade — so the fade
   grows in as the list leaves its top, and is gone again at its end. Kept
   current on scroll (synchronously, so it never trails the content) and on
   any change in the content's size (a render, a morph frame, an accordion). */

function setEdgeFade(top, bottom) {
  resultsEl.style.setProperty('--search-fade-top', `${Math.max(0, top)}px`);
  resultsEl.style.setProperty('--search-fade-bottom', `${Math.max(0, bottom)}px`);
}

function updateEdgeFade() {
  if (slide) return; // renderSlide() drives it while the panes are on the track
  const top = resultsEl.scrollTop;
  setEdgeFade(top, resultsEl.scrollHeight - resultsEl.clientHeight - top);
}

let edgeFadeRaf = 0;
function scheduleEdgeFade() {
  if (edgeFadeRaf) return;
  edgeFadeRaf = requestAnimationFrame(() => { edgeFadeRaf = 0; updateEdgeFade(); });
}

function initEdgeFade() {
  resultsEl.addEventListener('scroll', updateEdgeFade, { passive: true });
  const ro = new ResizeObserver(scheduleEdgeFade);
  ro.observe(resultsEl);
  // The content is swapped wholesale on every render; follow whichever pane
  // is current.
  let watched = null;
  new MutationObserver(() => {
    const pane = resultsEl.firstElementChild;
    if (pane === watched) return;
    if (watched) ro.unobserve(watched);
    watched = pane;
    if (pane) ro.observe(pane);
    scheduleEdgeFade();
  }).observe(resultsEl, { childList: true });
}

/* ── Results box ──────────────────────────────────────────────────────────
   The glass box materialises under the search bar (scaling up from its top
   edge, as if dropping out of the bar) when the first results arrive, and
   dissolves back into it when the field is cleared — its content stays put
   until then, and is only emptied (which hides the box, see :empty in the
   CSS) once it's gone. A Web Animation rather than a CSS one so it can be
   reversed from wherever it is: typing again mid-dissolve brings the same
   box straight back. */

const BOX_KEYFRAMES = [
  { opacity: 0, scale: '0.96', translate: '0 -6px' },
  { opacity: 1, scale: '1', translate: '0 0' },
];
// Reduced motion: the same appearance, as a plain fade.
const BOX_KEYFRAMES_FADE = [{ opacity: 0 }, { opacity: 1 }];
let boxShown = false;
let boxAnim = null;

function boxEasing() {
  const spring = getComputedStyle(document.documentElement).getPropertyValue('--vt-spring').trim();
  return spring && CSS.supports('animation-timing-function', spring) ? spring : 'cubic-bezier(0.16, 1, 0.3, 1)';
}

function setResultsBox(show, animate = true) {
  if (show === boxShown) return;
  boxShown = show;
  resultsEl.classList.toggle('search-overlay-results--leaving', !show);

  const empty = !resultsEl.firstElementChild;
  if (!animate || empty) {
    boxAnim?.cancel();
    boxAnim = null;
    if (!show) { settleMorph(); resultsEl.replaceChildren(); }
    return;
  }

  if (boxAnim) {
    boxAnim.reverse();
    return;
  }
  const reduce = reduceMotionMQ.matches;
  const frames = reduce ? BOX_KEYFRAMES_FADE : BOX_KEYFRAMES;
  // The frame, not resultsEl: it's the one carrying the glass.
  const anim = resultsEl.parentElement.animate(show ? frames : [...frames].reverse(), {
    duration: reduce ? 180 : 280, easing: reduce ? 'ease-out' : boxEasing(), fill: 'both',
  });
  boxAnim = anim;
  anim.onfinish = () => {
    if (boxAnim !== anim) return;
    boxAnim = null;
    if (!boxShown) { settleMorph(); resultsEl.replaceChildren(); }
    anim.cancel();
  };
}

// Top-level entry point for every results render: a typed query, opening the
// overlay, "Show all", or a data/language refresh. Animated against whatever
// is on screen unless `animate` is false (the overlay's own open transition
// is already moving everything). Typing while the professor view is open
// slides back to the results for the new query.
function renderResults(query, { animate = true } = {}) {
  clearTimeout(occRecheckTimer);
  if (!query.trim()) {
    lastQuery = null;
    landSlide();
    currentView = 'results';
    currentProfessorKey = null;
    setBackProgress(0);
    setResultsBox(false, animate);
    actionable = [];
    updateSelectionVisual();
    return;
  }
  if (currentView === 'professor') {
    if (animate) { exitProfessorView(); return; }
    landSlide();
  }
  currentView = 'results';
  currentProfessorKey = null;
  setBackProgress(0);
  const pane = newResultsPane();
  buildResultsPane(pane, query);
  morphInto(resultsEl, pane, { animate });
  setResultsBox(true, animate);
  refreshActionable();
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

/* ── Viewport / open / close plumbing ───────────────────────────────────── */

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
  // Nothing is left mid-flight for the next open: the slide and any results
  // morph land where they were heading, and a dissolving box is finished off.
  landSlide();
  settleMorph();
  if (boxAnim) {
    boxAnim.cancel();
    boxAnim = null;
    if (!boxShown) resultsEl.replaceChildren();
  }
}

// Opening a classroom result: the detail page zooms out of the tapped row
// (utils/vt-motion.js), the same way it does from a classroom card, so the
// overlay has to still be on screen when that view transition snapshots the
// "old" state — closing it with its own transition first would both hide the
// row and be cut short by the detail page's. It's concealed from inside the
// detail page's update callback instead (the classroomdetail:enter event), so
// the overlay and the row fade into the growing page as part of that one
// transition. The timeout covers an open that never happens (a stale id).
function handOffToDetail() {
  if (!isOpen) return;
  isOpen = false;
  clearTimeout(debounce);
  input.blur();
  let timer = 0;
  const done = () => {
    clearTimeout(timer);
    document.removeEventListener('classroomdetail:enter', done);
    if (!isOpen) conceal();
  };
  document.addEventListener('classroomdetail:enter', done);
  timer = setTimeout(done, 1500);
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

  // The open transition is already moving the whole panel in.
  if (isOpen) renderResults(input.value, { animate: false });
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

  backBtn = createBackButton({
    label: t('search.backToResults'),
    onClick: (e) => { e.stopPropagation(); exitProfessorView(); },
  });
  backBtn.classList.add('search-pv-back');
  resultsEl.parentElement.appendChild(backBtn);
  setBackProgress(0);
  initEdgeFade();

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

  // Opening a result navigates to the classroom detail page, which grows out
  // of the tapped row — see handOffToDetail.
  resultsEl.addEventListener('click', (e) => {
    if (e.target.closest('[data-open-classroom]')) handOffToDetail();
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

  onLanguageSwitch(() => {
    backBtn.setAttribute('aria-label', t('search.backToResults'));
    if (isOpen) refreshActiveView();
  });
}
