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

// A token matches a row when any of its variants (the token itself, its
// leading-zero-less form, or a typo correction — see expandToken) does.
function rowMatchesToken(row, token) {
  return token.variants.some(v => row.haystack.includes(v.text));
}

// ---------- TYPO TOLERANCE ----------
//
// Every query token is expanded, once, into the vocabulary words it could be a
// typo of: all distinct words across the directory and the occupancy rows,
// compared accent-insensitively with an edit distance that counts a swap of
// two adjacent letters as one edit ("anlaisi" -> "analisi"). The corrections
// are then matched as plain substrings, exactly like the typed token, so the
// scorer and the row filter stay substring-based; fuzzy hits just score lower
// than exact ones (see scoreMatch).

// Edits allowed for a token of this (accent-folded) length. A 3-letter token
// gets one only when it matches nothing as typed ("usr" -> "user"): one edit
// on 3 letters reaches half the vocabulary, so it can't be the norm.
function maxTypos(len, hasExact) {
  if (len < 3) return 0;
  if (len === 3) return hasExact ? 0 : 1;
  if (len < 7) return 1;
  return 2;
}

function foldAccents(s) {
  return s.normalize('NFD').replace(/\p{M}/gu, '');
}

// Optimal-string-alignment distance between `a` and `b` (or, with
// `prefix`, between `a` and the closest prefix of `b` — the last token may
// still be half-typed). Returns Infinity once it's certain to exceed `max`.
function editDistance(a, b, max, prefix) {
  const m = a.length;
  const n = b.length;
  if (!prefix && Math.abs(m - n) > max) return Infinity;
  let prev2 = null;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      cur.push(d);
      if (d < rowMin) rowMin = d;
    }
    if (rowMin > max) return Infinity;
    prev2 = prev;
    prev = cur;
  }
  return prefix ? Math.min(...prev) : prev[n];
}

// Distinct lowercase words (letters only, 3+ chars) across everything the
// search can match, keyed by their accent-folded form. Rebuilt when either
// index is rebuilt.
let vocab = null;
let vocabSources = null;
let expansionCache = new Map();

function addWords(words, text) {
  for (const w of String(text ?? '').toLowerCase().split(/[^\p{L}]+/u)) {
    if (w.length >= 3) words.add(w);
  }
}

function ensureVocab() {
  const dir = ensureDirIndexes();
  if (vocab && vocabSources?.dir === dir && vocabSources?.occ === occIndex) return;
  const words = new Set();
  if (dir) {
    for (const b of dir.buildings) { addWords(words, b.name); addWords(words, b.altName); }
    for (const r of dir.rooms) addWords(words, r.room.name);
  }
  for (const r of occIndex ?? []) addWords(words, r.haystack);
  vocab = [...words].map(word => ({ word, folded: foldAccents(word) }));
  vocabSources = { dir, occ: occIndex };
  expansionCache = new Map();
}

// Caps how many corrections one token can pull in, closest first, so a vague
// token can't flood the results (or the row filter's substring checks).
const MAX_CORRECTIONS = 12;

// Turns a raw query token into { raw, variants: [{ text, typos }] }, variants
// ordered best first. Tokens with digits (codes, room numbers) are never
// corrected: 61182 -> 61183 is a different course, not a typo.
function expandToken(tok, isLast) {
  const cacheKey = `${isLast ? 1 : 0}|${tok}`;
  const cached = expansionCache.get(cacheKey);
  if (cached) return cached;

  const variants = [{ text: tok, typos: 0 }];
  const alt = tok.replace(/^0+/, '');
  if (alt && alt !== tok) variants.push({ text: alt, typos: 0 });

  if (!/\d/.test(tok) && vocab) {
    const folded = foldAccents(tok);
    const hasExact = vocab.some(({ word }) => word.includes(tok));
    const max = maxTypos(folded.length, hasExact);
    // Half-typed last word: also compare against word prefixes, but only when
    // it matches nothing as typed (otherwise "rossi" drags in "possibile"),
    // and only words sharing its first letter, which people rarely mistype.
    const prefix = isLast && !hasExact;
    const corrections = [];
    for (const { word, folded: fw } of vocab) {
      if (word.includes(tok)) continue; // already an exact substring hit
      // Accents only ("universita" -> "università") count as exact.
      if (fw.includes(folded)) { corrections.push({ text: word, typos: 0 }); continue; }
      if (!max) continue;
      const asPrefix = prefix && fw[0] === folded[0];
      const d = editDistance(folded, fw, max, asPrefix);
      if (d <= max) corrections.push({ text: word, typos: d });
    }
    corrections.sort((a, b) => a.typos - b.typos || a.text.length - b.text.length);
    variants.push(...corrections.slice(0, MAX_CORRECTIONS));
  }

  const token = { raw: tok, variants };
  expansionCache.set(cacheKey, token);
  return token;
}

// Every word the current query matched through a correction, for the results'
// <mark> highlighting (highlight() only knows the literal query).
function correctedTerms(tokens) {
  return [...new Set(tokens.flatMap(t => t.variants.slice(1).map(v => v.text)))];
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
// comparable across types for the Top Hit. Tokens arrive expanded (see
// expandToken): typo corrections match, but score below exact hits.

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// The best variant of `tok` found in `field` (variants are ordered best
// first), or null.
function fieldHasToken(field, tok) {
  return tok.variants.find(v => field.includes(v.text)) ?? null;
}

function isWordStart(field, variant) {
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(variant)}`, 'iu').test(field);
}

// Separators ignored when matching room names, so "T11" finds "T.1.1".
// Mirrored in utils/html.js's highlight() (import cycle, see there).
const ROOM_NAME_SEPARATORS = /[\s._\-/]+/g;

// Lowercases `name` and drops its separators: "T.1.1" and "t 1-1" both
// become "t11".
function compactName(name) {
  return name.toLowerCase().replace(ROOM_NAME_SEPARATORS, '');
}

// `compactPrimary`: also accept the whole query matching the primary field
// with separators stripped from both (room names: "T11" -> "T.1.1").
function scoreMatch(fields, tokens, { compactPrimary = false } = {}) {
  const values = fields.map(f => (f ?? '').toString().toLowerCase()).filter(Boolean);
  if (!tokens.length || !values.length) return 0;
  const primary = values[0];
  const secondary = values.slice(1);

  // Every token must match somewhere, or this isn't a match at all — unless
  // the separator-less query is inside the separator-less primary field.
  const allTokensHit = tokens.every(tok => fieldHasToken(primary, tok) || secondary.some(f => fieldHasToken(f, tok)));
  if (!allTokensHit) {
    if (!compactPrimary) return 0;
    const q = compactName(tokens.map(t => t.raw).join(''));
    const name = compactName(primary);
    if (!q || !name.includes(q)) return 0;
    return name === q ? 100 : name.startsWith(q) ? 60 : 30;
  }

  // Tokens match in any order, but typing them in the name's own order should
  // win: "t 2 1" ranks T.2.1 above T.1.2. Separators (dots, dashes…) count as
  // spaces on both sides.
  const phrase = s => s.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const query = phrase(tokens.map(t => t.raw).join(' '));
  const primaryPhrase = phrase(primary);
  let score = 0;
  if (primaryPhrase === query) score += 100;
  else if (primaryPhrase.startsWith(query)) score += 60;
  else if (` ${primaryPhrase} `.includes(` ${query} `)) score += 40;

  // A corrected token scores as a weaker hit, one step lower per typo, so an
  // exact match always outranks the same match through a typo.
  for (const tok of tokens) {
    const primaryHit = fieldHasToken(primary, tok);
    if (primaryHit) {
      score += (isWordStart(primary, primaryHit.text) ? 20 : 8) - primaryHit.typos * 6;
      continue;
    }
    const field = secondary.find(f => fieldHasToken(f, tok));
    if (field) {
      const hit = fieldHasToken(field, tok);
      score += Math.max(1, (isWordStart(field, hit.text) ? 6 : 2) - hit.typos * 2);
    }
  }
  return Math.max(1, score);
}

function scoreClassrooms(tokens) {
  const dir = ensureDirIndexes();
  if (!dir) return [];
  const items = [];
  for (const entry of dir.rooms) {
    // Not the campus name: every room on a campus would match it.
    const score = scoreMatch([entry.room.name, entry.buildingName, entry.buildingAltName], tokens, { compactPrimary: true });
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
  const words = tokenize(query);
  if (!words.length) {
    return { topHit: null, classrooms: emptyResult(), buildings: emptyResult(), professors: emptyResult(), exams: emptyResult(), lessons: emptyResult(), corrections: [] };
  }

  ensureOccIndex();
  ensureVocab();
  const tokens = words.map((w, i) => expandToken(w, i === words.length - 1));

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

  return { topHit, classrooms, buildings, professors, exams, lessons, corrections: correctedTerms(tokens) };
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
