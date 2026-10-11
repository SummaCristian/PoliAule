// Graduation days (sessioni di laurea), from /v1/graduation-sessions
// (scripts/fetch_graduation_sessions.py scrapes them from polimi.it's PDF).
//
// Two things read them:
//   - the graduation theme (utils/season.js, components/graduation.js), on
//     while today is a graduation day at the campus picked in the app. The
//     inline script in index.html decides it before first paint from the copy
//     kept in localStorage here, so the accent never flashes in;
//   - the notes saying a campus's rooms may be taken by the ceremonies (the
//     Available results, the classroom page) and the laurel on those days in
//     the date row. Those are information, so they don't follow the seasonal
//     setting.
//
// The data changes once or twice a year: it's fetched once per launch (with
// the API's ETag, like the occupancy) and kept as a small index by day and
// campus:
//   { "2026-10-21": { "MIA01": { levels: ["magistrale"], main: true, design: null } } }
// `main`: the campus's own session ("Milano", "Poli Territoriali"); `design`:
// the Design School's day held there ("discussione", "proclamazione", or
// "design" when the PDF doesn't say), Bovisa only.

import { getApiBase } from '../config.js';
import { openDataCache, fetchJson } from '../available-rooms-script.js';

export const GRADUATIONS_KEY = 'poliAule_graduations';

let days = read();
// The campus picked in the app: set by the inline script from the saved
// campus settings (window.__graduationCampus), then by every 'campuschange'.
let campus = window.__graduationCampus ?? null;

function read() {
  try {
    return JSON.parse(localStorage.getItem(GRADUATIONS_KEY))?.days ?? {};
  } catch {
    return {};
  }
}

// Today in Milan, YYYY-MM-DD
export function milanDay() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
}

// The graduation at a campus on a day ("YYYY-MM-DD"), or null.
export function graduationOn(date, campusId) {
  return (campusId && days[date]?.[campusId]) || null;
}

export function graduationCampus() {
  return campus;
}

// The index above, from the API's sessions. Days already past are left out.
function indexSessions(sessions) {
  const today = milanDay();
  const out = {};
  for (const s of sessions ?? []) {
    if (!s?.date || s.date < today) continue;
    for (const part of s.campus_parts ?? []) {
      for (const id of part.campuses ?? []) {
        const entry = ((out[s.date] ??= {})[id] ??= { levels: [], main: false, design: null });
        for (const level of s.levels ?? []) if (!entry.levels.includes(level)) entry.levels.push(level);
        if (part.group === 'design') entry.design = part.event ?? entry.design ?? 'design';
        else entry.main = true;
      }
    }
  }
  return out;
}

async function load() {
  try {
    const cache = await openDataCache();
    const { data } = await fetchJson(cache, `${getApiBase()}/v1/graduation-sessions`);
    const next = indexSessions(data?.sessions);
    if (JSON.stringify(next) === JSON.stringify(days)) return;
    days = next;
    try { localStorage.setItem(GRADUATIONS_KEY, JSON.stringify({ days })); } catch { /* lasts until reload */ }
    document.dispatchEvent(new CustomEvent('graduationschange'));
  } catch (e) {
    // No data yet (the endpoint is new) or offline: the cached days stand
    console.warn('graduation sessions:', e);
  }
}

export function initGraduations() {
  document.addEventListener('campuschange', (e) => {
    if (!e.detail?.id || e.detail.id === campus) return;
    campus = e.detail.id;
    document.dispatchEvent(new CustomEvent('graduationschange'));
  });
  load();
}
