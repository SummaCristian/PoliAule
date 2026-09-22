import { getClassroomStatusNow, classroomsData as occupancyDays } from './available-rooms-script.js';
import { getApiBase } from './config.js';

// Static classroom directory (campus → buildings → classrooms) plus the
// unified Spotlight search that runs against it. The search UI itself lives
// in the search overlay (components/search-overlay.js); this module owns the
// data, the indexes, and the scoring/grouping that feeds runSearch().

export let classroomsData = null;

// ---------- DATA ----------

async function loadData() {
  if (classroomsData) return;
  const res = await fetch(`${getApiBase()}/v1/classrooms`);
  classroomsData = await res.json();
}

// Loads the static classroom directory. Blocks the splash — it's what the page
// shell (campus picker, classroom detail, favourites, and search) is built from.
export async function ensureClassroomDirectory() {
  await loadData();
}

// ---------- OCCUPATION INDEX ----------
//
// Flattens the loaded occupancy data (available-rooms-script.js, up to 7 days)
// into one row per slot, searchable by course name, code, section, professors,
// or raw string. runSearch() groups matching rows into exam/lesson items
// (recurring across days and rooms) and buildProfessorIndex() folds them by
// professor.

export const OCC_MAX_GROUPS = 24;

let occIndex = null;
let occIndexSig = null;
let professorIndex = new Map();

export function hasOccupationData() {
  return occupancyDays.length > 0;
}

// occupancyDays is spliced in place (available-rooms-script.js's
// fetchClassroomsData does `classroomsData.splice(0, len, ...results)`), so the
// array reference and even its length can stay identical across a reload.
// Fingerprint the day dates plus room/slot counts (cheap: array .length reads,
// no per-slot object creation) so a same-day-count reload is still detected.
function occSignature() {
  let rooms = 0;
  let slots = 0;
  for (const day of occupancyDays) {
    for (const campus of day.campuses ?? []) {
      for (const building of campus.buildings ?? []) {
        for (const room of building.classrooms ?? []) {
          rooms++;
          slots += (room.occupancy ?? []).length;
        }
      }
    }
  }
  return `${occupancyDays.length}|${occupancyDays.map(d => d.date).join(',')}|${rooms}|${slots}`;
}

// Occupancy JSON stores the day as "YYYYMMDD"; normalise to ISO so Date() and
// Intl can parse it.
function isoDate(d) {
  const s = String(d ?? '');
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s;
}

function buildOccupationIndex() {
  const rows = [];
  for (const day of occupancyDays) {
    const date = isoDate(day.date);
    for (const campus of day.campuses ?? []) {
      for (const building of campus.buildings ?? []) {
        for (const room of building.classrooms ?? []) {
          for (const slot of room.occupancy ?? []) {
            if (!slot.inizio || !slot.fine) continue;
            const professors = Array.isArray(slot.professors) ? slot.professors : [];
            const title = slot.course ?? slot.raw ?? slot.name ?? '';
            rows.push({
              date,
              inizio: slot.inizio,
              fine: slot.fine,
              category: slot.category ?? null,
              isExam: slot.category === 'EXAM',
              title,
              code: slot.code ?? null,
              section: slot.section ?? null,
              professors,
              roomId: room.id,
              roomName: room.name,
              buildingName: building.name,
              buildingAltName: building.altName,
              campusName: campus.name,
              haystack: [
                title,
                slot.code != null ? String(slot.code) : '',
                slot.section ?? '',
                professors.join(' '),
                slot.raw ?? '',
                slot.name ?? '',
              ].join('  ').toLowerCase(),
            });
          }
        }
      }
    }
  }
  return rows;
}

function ensureOccIndex() {
  const sig = occSignature();
  if (!occIndex || occIndexSig !== sig) {
    occIndex = buildOccupationIndex();
    professorIndex = buildProfessorIndex(occIndex);
    occIndexSig = sig;
  }
}

// Order-independent: "rossi analisi" and "analisi rossi" tokenize the same.
export function tokenize(query) {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

// Codes are stored as ints, so a leading zero the user typed ("061182") is
// gone from the haystack ("61182") — match on both.
function rowMatchesToken(row, token) {
  if (row.haystack.includes(token)) return true;
  const alt = token.replace(/^0+/, '');
  return alt !== '' && alt !== token && row.haystack.includes(alt);
}

// ---------- UNIFIED SPOTLIGHT SEARCH ----------
//
// One index-agnostic scorer, five typed indexes (classrooms, buildings,
// professors, exams, lessons) built from the same two data sources above
// (classroomsData for the static directory, occupancyDays for occupancy),
// and a professor-schedule lookup for the in-place professor view.

const CLASSROOM_CAP = 40;
const BUILDING_CAP = 20;
const PROFESSOR_CAP = 20;

// -- directory (classroom / building) indexes, built once from classroomsData --

let dirIndexes = null;

function buildDirectoryIndexes() {
  const rooms = [];
  const buildings = [];
  for (const campus of classroomsData) {
    for (const building of campus.buildings) {
      buildings.push({
        campusId: campus.id,
        campusName: campus.name,
        name: building.name,
        altName: building.altName,
        rooms: building.classrooms,
      });
      for (const room of building.classrooms) {
        rooms.push({
          room,
          buildingName: building.name,
          buildingAltName: building.altName,
          campusId: campus.id,
          campusName: campus.name,
        });
      }
    }
  }
  return { rooms, buildings };
}

function ensureDirIndexes() {
  if (!dirIndexes && classroomsData) dirIndexes = buildDirectoryIndexes();
  return dirIndexes;
}

// -- professor name normalisation --
// Raw source names look like "LAVAGNA MICHÈLE ROBERTA (ATTIVITÀ CON STUDENTI)".

function normalizeProfessorName(raw) {
  return String(raw ?? '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
}

function titleCaseWord(word) {
  return word
    .split('-')
    .map(part => part.split("'").map(seg => (seg ? seg[0].toUpperCase() + seg.slice(1).toLowerCase() : seg)).join("'"))
    .join('-');
}

function toDisplayName(stripped) {
  return stripped.split(' ').filter(Boolean).map(titleCaseWord).join(' ');
}

function getInitials(stripped) {
  return stripped.split(' ').filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
}

// -- professor index, built from the occupancy rows (rebuilt with occIndex) --

function buildProfessorIndex(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!r.professors.length) continue;
    for (const raw of r.professors) {
      const stripped = normalizeProfessorName(raw);
      if (!stripped) continue;
      const key = stripped.toUpperCase();
      let p = map.get(key);
      if (!p) {
        p = {
          key, name: toDisplayName(stripped), initials: getInitials(stripped),
          courses: new Set(), sessionKeys: new Set(), sessions: [], examCount: 0,
        };
        map.set(key, p);
      }
      if (r.title) p.courses.add(r.title);
      const sessionKey = `${r.date}|${r.inizio}|${r.fine}|${r.roomId}`;
      if (!p.sessionKeys.has(sessionKey)) {
        p.sessionKeys.add(sessionKey);
        const session = {
          date: r.date, inizio: r.inizio, fine: r.fine,
          title: r.title, code: r.code, section: r.section, isExam: r.isExam,
          roomId: r.roomId, roomName: r.roomName,
          buildingName: r.buildingName, buildingAltName: r.buildingAltName, campusName: r.campusName,
        };
        p.sessions.push(session);
        if (r.isExam) p.examCount++;
      }
    }
  }
  for (const p of map.values()) {
    p.sessions.sort((a, b) => (a.date + a.inizio).localeCompare(b.date + b.inizio));
    p.sessionCount = p.sessions.length;
    p.courses = [...p.courses];
    delete p.sessionKeys;
  }
  return map;
}

// First session that hasn't finished yet relative to now; sessions must
// already be sorted ascending by date/time. Null if everything's past.
function firstUpcomingSession(sessions) {
  const now = Date.now();
  for (const s of sessions) {
    if (new Date(`${s.date}T${s.fine}:00`).getTime() > now) return s;
  }
  return null;
}

// -- scoring --
// Single relevance function every result type goes through, so rankings are
// comparable across types for the Top Hit. This is the one place to swap in
// fuzzy matching later.

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Codes are stored as ints, so a leading zero the user typed is missing from
// the field text ("061182" -> "61182") — match on both, like rowMatchesToken.
function fieldHasToken(field, tok) {
  if (field.includes(tok)) return tok;
  const alt = tok.replace(/^0+/, '');
  if (alt && alt !== tok && field.includes(alt)) return alt;
  return null;
}

function isWordStart(field, variant) {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(variant)}`, 'iu').test(field);
}

function scoreMatch(fields, tokens) {
  const values = fields.map(f => (f ?? '').toString().toLowerCase()).filter(Boolean);
  if (!tokens.length || !values.length) return 0;
  const primary = values[0];
  const secondary = values.slice(1);

  // Every token must match somewhere, or this isn't a match at all.
  for (const tok of tokens) {
    const hit = fieldHasToken(primary, tok) || secondary.some(f => fieldHasToken(f, tok));
    if (!hit) return 0;
  }

  // Tokens match in any order, but typing them in the name's own order should
  // win: "t 2 1" ranks T.2.1 above T.1.2. Separators (dots, dashes…) count as
  // spaces on both sides.
  const phrase = s => s.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const query = phrase(tokens.join(' '));
  const primaryPhrase = phrase(primary);
  let score = 0;
  if (primaryPhrase === query) score += 100;
  else if (primaryPhrase.startsWith(query)) score += 60;
  else if (` ${primaryPhrase} `.includes(` ${query} `)) score += 40;

  for (const tok of tokens) {
    const primaryHit = fieldHasToken(primary, tok);
    if (primaryHit) {
      score += isWordStart(primary, primaryHit) ? 20 : 8;
      continue;
    }
    const secondaryHit = secondary.find(f => fieldHasToken(f, tok));
    if (secondaryHit) score += isWordStart(secondaryHit, fieldHasToken(secondaryHit, tok)) ? 6 : 2;
  }
  return score;
}

function scoreClassrooms(tokens) {
  const dir = ensureDirIndexes();
  if (!dir) return [];
  const items = [];
  for (const entry of dir.rooms) {
    // Not the campus name: every room on a campus would match it.
    const score = scoreMatch([entry.room.name, entry.buildingName, entry.buildingAltName], tokens);
    if (score <= 0) continue;
    items.push({
      type: 'classroom', score, room: entry.room,
      buildingName: entry.buildingName, buildingAltName: entry.buildingAltName,
      campusId: entry.campusId, campusName: entry.campusName,
      status: getClassroomStatusNow(entry.room.id),
    });
  }
  items.sort((a, b) => b.score - a.score || a.room.name.localeCompare(b.room.name, undefined, { numeric: true }));
  return items;
}

// A room counts as free right now when getClassroomStatusNow says it's not
// currently occupied: 'free' (nothing upcoming either) or 'occupied-soon'
// (free now, about to fill up) — not 'occupied' / 'free-soon' (both mean
// occupied right now).
function isFreeNowStatus(status) {
  return status === 'free' || status === 'occupied-soon';
}

function scoreBuildings(tokens) {
  const dir = ensureDirIndexes();
  if (!dir) return [];
  const items = [];
  for (const b of dir.buildings) {
    const score = scoreMatch([b.name, b.altName], tokens);
    if (score <= 0) continue;
    let freeNow = null;
    if (hasOccupationData()) {
      freeNow = 0;
      for (const room of b.rooms) {
        if (isFreeNowStatus(getClassroomStatusNow(room.id))) freeNow++;
      }
    }
    items.push({
      type: 'building', score, campusId: b.campusId, campusName: b.campusName,
      name: b.name, altName: b.altName, roomCount: b.rooms.length, freeNow,
    });
  }
  items.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, undefined, { numeric: true }));
  return items;
}

function scoreProfessors(tokens) {
  const items = [];
  for (const p of professorIndex.values()) {
    const score = scoreMatch([p.name, p.courses.join(' ')], tokens);
    if (score <= 0) continue;
    items.push({
      type: 'professor', score, key: p.key, name: p.name, initials: p.initials,
      sessionCount: p.sessionCount, examCount: p.examCount, courses: p.courses,
      next: firstUpcomingSession(p.sessions),
    });
  }
  items.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, undefined, { numeric: true }));
  return items;
}

// Groups matched occupancy rows into exam/lesson items, keyed by
// category/code/title/section/professors so recurring sessions of the same
// course fold into one item; professor names are normalised for display.
function buildExamLessonItems(tokens) {
  const matched = occIndex.filter(r => tokens.every(tok => rowMatchesToken(r, tok)));
  const groups = new Map();
  for (const r of matched) {
    const key = [r.category, r.code, r.title, r.section, r.professors.join(',')].join('|').toLowerCase();
    let g = groups.get(key);
    if (!g) {
      g = { title: r.title, code: r.code, section: r.section, professors: [], profKeys: new Set(), isExam: r.isExam, sessions: [] };
      groups.set(key, g);
    }
    for (const raw of r.professors) {
      const stripped = normalizeProfessorName(raw);
      if (!stripped) continue;
      const pk = stripped.toUpperCase();
      if (!g.profKeys.has(pk)) {
        g.profKeys.add(pk);
        g.professors.push(toDisplayName(stripped));
      }
    }
    g.sessions.push({
      date: r.date, inizio: r.inizio, fine: r.fine,
      title: r.title, code: r.code, section: r.section, isExam: r.isExam,
      roomId: r.roomId, roomName: r.roomName,
      buildingName: r.buildingName, buildingAltName: r.buildingAltName, campusName: r.campusName,
    });
  }

  const exams = [];
  const lessons = [];
  for (const g of groups.values()) {
    delete g.profKeys;
    g.sessions.sort((a, b) => (a.date + a.inizio).localeCompare(b.date + b.inizio));
    g.sessionCount = g.sessions.length;
    const score = scoreMatch([g.title, g.code != null ? String(g.code) : '', g.section ?? '', g.professors.join(' ')], tokens);
    const item = { ...g, type: g.isExam ? 'exam' : 'lesson', score };
    (g.isExam ? exams : lessons).push(item);
  }

  const tieKey = item => {
    const next = firstUpcomingSession(item.sessions);
    const s = next ?? item.sessions[0];
    return s.date + s.inizio;
  };
  const sorter = (a, b) => b.score - a.score || tieKey(a).localeCompare(tieKey(b));
  exams.sort(sorter);
  lessons.sort(sorter);
  return { exams, lessons };
}

function toCappedResult(list, cap) {
  return { items: list.slice(0, cap), total: list.length };
}

function emptyResult() {
  return { items: [], total: 0 };
}

// Top hit is the single highest-scoring item across all types; ties break by
// type priority (classroom > building > professor > exam > lesson), which
// falls out of evaluating the lists in that order and only replacing on '>'.
function pickTopHit(orderedFirstItems) {
  let best = null;
  for (const candidate of orderedFirstItems) {
    if (!candidate) continue;
    if (!best || candidate.score > best.score) best = candidate;
  }
  return best;
}

export function runSearch(query) {
  const tokens = tokenize(query);
  if (!tokens.length) {
    return { topHit: null, classrooms: emptyResult(), buildings: emptyResult(), professors: emptyResult(), exams: emptyResult(), lessons: emptyResult() };
  }

  ensureOccIndex();

  const classroomItems = scoreClassrooms(tokens);
  const buildingItems = scoreBuildings(tokens);
  const professorItems = scoreProfessors(tokens);
  const { exams: examItems, lessons: lessonItems } = buildExamLessonItems(tokens);

  const classrooms = toCappedResult(classroomItems, CLASSROOM_CAP);
  const buildings = toCappedResult(buildingItems, BUILDING_CAP);
  const professors = toCappedResult(professorItems, PROFESSOR_CAP);
  const exams = toCappedResult(examItems, OCC_MAX_GROUPS);
  const lessons = toCappedResult(lessonItems, OCC_MAX_GROUPS);

  const topHit = pickTopHit([classrooms.items[0], buildings.items[0], professors.items[0], exams.items[0], lessons.items[0]]);

  return { topHit, classrooms, buildings, professors, exams, lessons };
}

// Rebuilt fresh from the current occupancy index every call (professorIndex
// itself is cached and only rebuilt when the occupancy data changes — see
// ensureOccIndex/occSignature above).
export function getProfessorSchedule(key) {
  ensureOccIndex();
  const p = professorIndex.get(String(key ?? '').toUpperCase());
  if (!p || !p.sessions.length) return null;

  const dayMap = new Map();
  for (const s of p.sessions) {
    let day = dayMap.get(s.date);
    if (!day) {
      day = { date: s.date, sessions: [] };
      dayMap.set(s.date, day);
    }
    day.sessions.push(s);
  }
  const days = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
  for (const day of days) day.sessions.sort((a, b) => a.inizio.localeCompare(b.inizio));

  return {
    key: p.key, name: p.name, initials: p.initials, courses: p.courses,
    sessionCount: p.sessionCount, examCount: p.examCount, days,
  };
}
