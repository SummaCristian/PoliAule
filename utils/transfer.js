// Device-to-device transfer of favourites + preferences, with no backend.
//
// The sending device packs a fixed list of localStorage keys into a short JSON
// payload and puts it in a link: `${origin}/#import=<base64url>`, shown as a
// QR code (components/transfer-dialog.js). Scanning it with the other device's
// camera opens PoliAule, which validates the payload and asks before writing.
// The data stays in the URL fragment, so it never reaches a server.
//
// Only the fields in fields() travel. Device-specific or throwaway state stays
// put: lg:blur-mode (a per-device capability verdict), caches, last tab /
// last campus, the info hint, and the beta-backend dev flag. Anything else in
// a payload is ignored, so a crafted link can't write arbitrary keys.
import { getFavouriteIds, setFavouriteIds } from './favourites.js';
import { STORAGE_KEY as TIME_FORMAT_KEY } from './time-format.js';
import { STORAGE_KEY as LOCALE_KEY } from '../i18n.js';
import {
  HIDE_SUNDAYS_KEY, INTERVAL_HOURS_KEY, SHOW_PARTIAL_KEY, AUTO_SEARCH_KEY, LIVE_SEARCH_KEY,
  DEFAULT_TAB_KEY, PREFERRED_CAMPUS_ENABLED_KEY, PREFERRED_CAMPUS_ID_KEY, REMEMBER_LAST_CAMPUS_KEY,
} from '../components/settings.js';

const VERSION = 1;
const HASH_PREFIX = '#import=';

const bool = { enc: v => (v === 'true' ? 1 : v === 'false' ? 0 : undefined), dec: x => (x === 0 || x === 1 ? String(x === 1) : undefined) };
const oneOf = (...values) => ({ enc: v => (values.includes(v) ? v : undefined), dec: x => (values.includes(x) ? x : undefined) });
const intIn = (min, max) => ({
  enc: v => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : undefined; },
  dec: x => (Number.isInteger(x) && x >= min && x <= max ? String(x) : undefined),
});

// Built on demand, not at module load: settings.js imports this module's
// dialog (components/transfer-dialog.js), so its key constants aren't
// initialised yet while this file first evaluates.
function fields(campusIds) {
  return {
    l:  [LOCALE_KEY, oneOf('en', 'it')],
    tf: [TIME_FORMAT_KEY, oneOf('system', '12', '24')],
    hs: [HIDE_SUNDAYS_KEY, bool],
    ih: [INTERVAL_HOURS_KEY, intIn(1, 12)],
    sp: [SHOW_PARTIAL_KEY, bool],
    as: [AUTO_SEARCH_KEY, bool],
    ls: [LIVE_SEARCH_KEY, bool],
    dt: [DEFAULT_TAB_KEY, oneOf('available', 'search', 'last')],
    pe: [PREFERRED_CAMPUS_ENABLED_KEY, bool],
    pc: [PREFERRED_CAMPUS_ID_KEY, campusIds ? oneOf(...campusIds) : { enc: v => v || undefined }],
    rl: [REMEMBER_LAST_CAMPUS_KEY, bool],
  };
}

function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

function readStorage(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

// The transfer link for this device's current state. Unset keys are left out,
// so the receiving device keeps its own defaults for them.
export function buildTransferUrl() {
  const payload = { v: VERSION };
  const favs = getFavouriteIds();
  if (favs.length) payload.f = favs;
  for (const [short, [key, codec]] of Object.entries(fields(null))) {
    const raw = readStorage(key);
    if (raw === null) continue;
    const value = codec.enc(raw);
    if (value !== undefined) payload[short] = value;
  }
  return `${location.origin}/${HASH_PREFIX}${toBase64Url(JSON.stringify(payload))}`;
}

// If the page was opened from a transfer link, removes the fragment (so a
// reload doesn't import again, and the hash routers never see it) and returns
// the raw payload. Returns null otherwise. Call before anything reads the hash.
export function takeImportHash() {
  if (!location.hash.startsWith(HASH_PREFIX)) return null;
  const raw = location.hash.slice(HASH_PREFIX.length);
  history.replaceState(null, '', location.pathname + location.search);
  return raw;
}

// Validates a payload against the classroom directory. Returns
// { favourites: number[], settings: { [storageKey]: string } }, or null when
// the payload can't be read at all. Individual bad fields are dropped.
export function parseTransfer(raw, classroomsData) {
  let payload;
  try {
    payload = JSON.parse(fromBase64Url(raw));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object' || payload.v !== VERSION) return null;

  const campusIds = (classroomsData ?? []).map(c => c.id);
  const classroomIds = new Set(
    (classroomsData ?? []).flatMap(c => c.buildings.flatMap(b => b.classrooms.map(r => r.id)))
  );

  const favourites = Array.isArray(payload.f)
    ? [...new Set(payload.f.filter(id => Number.isInteger(id) && classroomIds.has(id)))]
    : [];

  const settings = {};
  for (const [short, [key, codec]] of Object.entries(fields(campusIds))) {
    if (!(short in payload)) continue;
    const value = codec.dec(payload[short]);
    if (value !== undefined) settings[key] = value;
  }

  if (!favourites.length && !Object.keys(settings).length) return null;
  return { favourites, settings };
}

// Writes a parsed transfer. `favouritesMode` is 'merge' (keep this device's
// favourites and add the incoming ones) or 'replace'. The caller reloads
// afterwards: most settings are only read at start-up.
export function applyTransfer({ favourites, settings }, { favouritesMode = 'merge' } = {}) {
  if (favourites.length) {
    const next = favouritesMode === 'replace'
      ? favourites
      : [...new Set([...getFavouriteIds(), ...favourites])];
    setFavouriteIds(next);
  }
  for (const [key, value] of Object.entries(settings)) {
    try { localStorage.setItem(key, value); } catch { /* storage full or unavailable */ }
  }
}
