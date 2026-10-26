// Carnevale Ambrosiano decorations (Giovedì grasso to Sabato grasso, which
// moves with Easter, see utils/season.js), lazy-loaded by utils/season.js. The
// magenta accent and the festive strings are plain CSS / locale entries keyed
// on <html data-season="carnival">; this module adds what needs the DOM:
//   - coriandoli, little discs of coloured paper, drifting down over the page
//     and thrown up when something gets starred (components/coriandoli.js)
//   - stelle filanti: twisting paper streamers hanging from the cards, the
//     picker chips, the banner and the classroom page's sections, swaying
//   - a masked room per campus and day: a Venetian mask on its card and over
//     its page's photo, over its building on the map, in its building's
//     folder and next to its name in the search
//   - a mask hanging from the data status button
//   - streamers from about two in three of every other glass box too: the
//     classroom page's sections, Settings, Info, the changelog, the not-found
//     page, the search's results box, the Campus sheet and the building headers
// With reduced motion nothing falls or sways: the streamers hang still.

import { setDecorator, graduationShown } from '../utils/season.js';
import { t } from '../i18n.js';
import { startCoriandoli, stopCoriandoli, throwCoriandoli } from './coriandoli.js';
import { classroomsData as directory, ensureClassroomDirectory } from '../classroom-search-data.js';

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Randomness that stays put ─────────────────────────────────────────────
// Decorations come from a hash of what they sit on, so a card keeps the same
// streamers across re-renders and every visitor sees the same masked room.

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Today in Milan, YYYY-MM-DD: the masked rooms change at local midnight
function dayKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
}

const f1 = (v) => v.toFixed(1);

// ── Artwork ───────────────────────────────────────────────────────────────

// Streamer paper: a colour and the shade of its other side
const PAPERS = [
  ['#e63946', '#a8202e'], ['#ffb703', '#d98600'], ['#06b6a4', '#047a6e'],
  ['#3a86ff', '#1f5cc4'], ['#8338ec', '#5a1fb0'], ['#ff5fa2', '#c93a7a'], ['#6cc644', '#4a9a2a'],
];

// A paper streamer hanging from a pin at its top: a ribbon that winds from
// side to side and twists as it goes, so that now its face shows and now its
// back (the darker shade), drawn as a strip of small quads, the two faces in
// a path each. `len` long, `seed` picks the paper, the winding and the twist.
function streamerSvg(len, seed) {
  const [face, back] = PAPERS[seed % PAPERS.length];
  const amp = 4 + (seed >>> 3) % 3;                      // how far it winds
  const turns = 1.7 + ((seed >>> 5) % 4) * 0.3;          // winds per length
  const twist = 2.2 + ((seed >>> 7) % 4) * 0.4;          // twists per length
  const width = 7.5;
  const steps = Math.max(24, Math.round(len * 0.9));
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const u = i / steps;
    // Winds more and more tightly towards the end, like a streamer unrolled
    const x = amp * Math.sin(u * turns * 6.2832) * (0.35 + 0.65 * u) + (u * u * 3);
    pts.push([x, u * len, width * Math.cos(u * twist * 6.2832 + 0.6) * (1 - 0.25 * u)]);
  }
  let front = '', rear = '';
  for (let i = 0; i < steps; i++) {
    const [x0, y0, w0] = pts[i], [x1, y1, w1] = pts[i + 1];
    const quad = `M${f1(x0 - w0 / 2)} ${f1(y0)}L${f1(x0 + w0 / 2)} ${f1(y0)}L${f1(x1 + w1 / 2)} ${f1(y1)}L${f1(x1 - w1 / 2)} ${f1(y1)}Z`;
    if (w0 + w1 >= 0) front += quad; else rear += quad;
  }
  const box = amp + width + 4;
  return `<svg width="${Math.round(box * 2)}" height="${len + 6}" viewBox="${-box} -3 ${box * 2} ${len + 6}" aria-hidden="true">` +
    `<path d="${rear}" fill="${back}"/><path d="${front}" fill="${face}"/>` +
    `<path d="M0 0.4V-0.4" stroke="${back}" stroke-width="2.8" stroke-linecap="round"/></svg>`;
}

// The masks' colours: the mask, its darker rim, and the two feathers
const MASKS = [
  ['#8a2bd6', '#5a168f', '#ff5fa2', '#06b6a4'],
  ['#d62e4a', '#8f1a2e', '#ffb703', '#3a86ff'],
  ['#0b9ca0', '#06666b', '#8338ec', '#ff5fa2'],
  ['#2f6fe0', '#1c4a9e', '#ffb703', '#e63946'],
];

// A Venetian half mask (a Columbina), in gold trim, with a plume, in a box
// 78 x 46: the mask is 58 wide and its feathers reach up and to the right.
// `seed` picks the colours.
function maskSvg(seed) {
  const [mask, rim, f1c, f2c] = MASKS[seed % MASKS.length];
  const eyeL = 'M9.5 17.5C11 13 18 12.5 23.5 17C21.5 22 14 22.5 9.5 17.5Z';
  const eyeR = 'M54.5 17.5C53 13 46 12.5 40.5 17C42.5 22 50 22.5 54.5 17.5Z';
  return `<svg viewBox="0 -10 78 46" aria-hidden="true">
  <path d="M50 9C53 -3 63 -8 74 -4C68 0 62 4 56 12Z" fill="${f1c}"/>
  <path d="M52 10C58 2 68 0 76 6C69 6 62 9 57 14Z" fill="${f2c}"/>
  <path d="M48 8C49 -2 56 -8 66 -9C62 -4 58 2 54 10Z" fill="#f2c14e"/>
  <path d="M50 9C57 2 65 -3 72 -4M52 10C60 5 68 3 75 6" fill="none" stroke="rgba(255,255,255,.55)" stroke-width=".7" stroke-linecap="round"/>
  <path d="M3 18C3 9 11 5 21 8C25 9.4 28 11 32 11C36 11 39 9.4 43 8C53 5 61 9 61 18C61 27 52 32 44 28C40 26 37 22 32 22C27 22 24 26 20 28C12 32 3 27 3 18Z" fill="${rim}"/>
  <path d="M4.6 17.4C4.6 10 11.4 6.8 20.6 9.4C25 10.8 28.2 12.6 32 12.6C35.8 12.6 39 10.8 43.4 9.4C52.6 6.8 59.4 10 59.4 17.4C59.4 25 52 29 45 26.6C40.6 25 37.6 20.8 32 20.8C26.4 20.8 23.4 25 19 26.6C12 29 4.6 25 4.6 17.4Z" fill="${mask}"/>
  <path d="M8 13.6C13 9.6 19.6 10.2 25 13.4M39 13.4C44.4 10.2 51 9.6 56 13.6" fill="none" stroke="rgba(255,255,255,.38)" stroke-width="1.5" stroke-linecap="round"/>
  <path d="${eyeL}" fill="#17101f"/><path d="${eyeR}" fill="#17101f"/>
  <path d="${eyeL}" fill="none" stroke="#f2c14e" stroke-width="1.4" stroke-linejoin="round"/><path d="${eyeR}" fill="none" stroke="#f2c14e" stroke-width="1.4" stroke-linejoin="round"/>
  <path d="M7.5 22.4C10.5 26.4 15 26.6 18.4 24.4M56.5 22.4C53.5 26.4 49 26.6 45.6 24.4M27 14.4C28 12.6 30 12.2 32 14C34 12.2 36 12.6 37 14.4" fill="none" stroke="#f2c14e" stroke-width="1" stroke-linecap="round"/>
  <path d="M32 13.6L34.4 16.6L32 19.6L29.6 16.6Z" fill="#fff3c4" stroke="#f2c14e" stroke-width=".8" stroke-linejoin="round"/>
  <circle cx="8.6" cy="12.6" r="1.1" fill="#fff3c4"/><circle cx="55.4" cy="12.6" r="1.1" fill="#fff3c4"/><circle cx="15" cy="25.6" r="1" fill="#fff3c4"/><circle cx="49" cy="25.6" r="1" fill="#fff3c4"/>
</svg>`;
}

// ── Carnival rooms ────────────────────────────────────────────────────────
// One masked room per campus per day, from the rooms people actually book
// that have a photo for the mask to sit over (the same way as Halloween's
// haunted rooms). The map puts a mask on its building.

let maskedRooms = null; // { day, ids: Set<number>, buildings: Set<"campusId:name"> }

function masked() {
  const day = dayKey();
  if (maskedRooms?.day === day) return maskedRooms;
  // Not picked (nor remembered) until the rooms have loaded
  if (!directory) return { day, ids: new Set(), buildings: new Set() };
  maskedRooms = { day, ids: new Set(), buildings: new Set() };
  for (const campus of directory ?? []) {
    if (campus.secondary) continue;
    const rooms = [];
    for (const building of campus.buildings ?? []) {
      if (building.secondary) continue;
      for (const room of building.classrooms ?? []) {
        if (!room.eventsOnly && !room.noSchedule && room.idfoto) rooms.push([room.id, building.name]);
      }
    }
    if (!rooms.length) continue;
    const [id, buildingName] = rooms[hash(`mask:${day}:${campus.id}`) % rooms.length];
    maskedRooms.ids.add(id);
    maskedRooms.buildings.add(`${campus.id}:${buildingName}`);
  }
  return maskedRooms;
}

let maskLabel = '';

function decor(className, html) {
  const el = document.createElement('div');
  el.className = `cv-decor ${className}`;
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = html;
  return el;
}

// A streamer hanging from the top edge of `host` (or from its bottom edge, out
// into the gap under it, for what has text or controls near its top), `left` px or % along it
function hang(host, seed, { left, len = 30 + (seed >>> 9) % 26, className = '', below = false } = {}) {
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  const el = decor(`cv-streamer ${className}`, streamerSvg(len, seed));
  el.style.left = left ?? `${12 + (seed >>> 4) % 66}%`;
  if (below) el.style.top = '100%';
  el.style.setProperty('--cv-sway-delay', `${(-((seed >>> 11) % 40) / 10).toFixed(1)}s`);
  host.appendChild(el);
  return el;
}

// Streamers on the glass boxes of a secondary page: about two in three (a
// different two in three each day), the first always. They hang from the
// bottom edge, out into the gap under the box, like the banner's and the
// chips', so they never cover the box's own text or controls; `span` is the
// stretch of the edge they hang from, as percentages from the left, kept to
// where the box below has no heading or legend. A box that has one already
// isn't given another when it's shown again.
function decorateBoxes(root, selector, salt, { span = [60, 92] } = {}) {
  const h = hash(`${salt}:${dayKey()}`);
  root.querySelectorAll(selector).forEach((box, i) => {
    if (i && (h >>> (i % 16)) % 3 === 0) return;
    if (box.querySelector(':scope > .cv-decor')) return;
    const left = span[0] + ((h >>> (i % 12)) % (span[1] - span[0]));
    hang(box, h + i * 7, { left: `${left}%`, len: 24 + ((h >>> (i % 9)) % 11), below: true });
  });
}

const decorateSettings = (page) => decorateBoxes(page, '.settings-group', 'settings');
// The changelog's entries have their chevron on the right edge, and the next
// one's tags and title run from the left to about two thirds: the streamers
// keep to the stretch between them and the chevron
const decorateChangelog = (content) => decorateBoxes(content, '.cl-entry--stable, .cl-toggle-row, .cl-card', 'changelog', { span: [70, 84] });
const decorateInfo = (page) => decorateBoxes(page, '.info-section', 'info');
// Not the ghost card (it clips what hangs out of it, and its caption sits under
// it): the cards of the page's suggestions
const decorateNotFound = (page) => decorateBoxes(page, '.nf-room-card, .nfc-did', 'notfound');

// ── Classroom cards ───────────────────────────────────────────────────────
// The masked room's card wears its mask; a third of the others have a
// streamer or two hanging from their top edge.

function decorateCard(card, classroom) {
  const id = classroom.id;
  const clip = card.querySelector('.classroom-card-clip');
  if (!clip || clip.querySelector(':scope > .cv-decor')) return;
  if (masked().ids.has(id)) {
    clip.appendChild(decor('cv-mask cv-mask--card', maskSvg(hash(`mask:${dayKey()}:${id}`))));
    return;
  }
  const h = hash(`card:${id}`);
  if (h % 3 !== 0) return;
  hang(clip, h);
  if ((h >>> 3) % 3 === 0) hang(clip, h >>> 5 | 1, { left: `${60 + (h >>> 8) % 28}%` });
}

// ── Building folders ──────────────────────────────────────────────────────
// The masked room's building has a mask sticking out of its papers.

function decorateFolder(folder, { campusId, building }) {
  if (!masked().buildings.has(`${campusId}:${building.name}`) || folder.querySelector('.cv-folder-mask')) return;
  folder.querySelector('.bo-card-papers')?.appendChild(decor('cv-folder-mask', maskSvg(hash(`${campusId}:${building.name}`))));
}

// ── Classroom page ────────────────────────────────────────────────────────
// The masked room's photo wears its mask, and a streamer hangs from a section.

function decorateDetail(page, { classroom }) {
  const h = hash(`detail:${classroom.id}`);
  const sections = [...page.querySelectorAll('.detail-section:not(.detail-map-section)')]
    .filter((section) => !section.querySelector('.detail-section-header'));
  // The first section always, each of the others about half the time, from
  // the middle of the bottom edge: the schedule below has its title on the
  // left and its legend on the right
  sections.forEach((section, i) => {
    if (i && !((h >>> i) & 1)) return;
    if (!section.querySelector(':scope > .cv-decor')) hang(section, h + i, { left: `${46 + (h >>> i) % 18}%`, len: 24 + (h >>> (i + 3)) % 10, below: true });
  });
  const photo = page.querySelector('.detail-photo-container');
  if (photo && masked().ids.has(classroom.id) && !photo.querySelector('.cv-mask')) {
    photo.appendChild(decor('cv-mask cv-mask--photo', maskSvg(hash(`mask:${dayKey()}:${classroom.id}`))));
  }
}

// The season's banner (utils/season.js): streamers hanging along its bottom
// edge, clear of its text
function decorateBanner(banner) {
  if (banner.querySelector(':scope > .cv-decor')) return;
  [[7, 11], [31, 5], [58, 8], [88, 2]].forEach(([left, k], i) => hang(banner, hash(`banner:${dayKey()}:${i}`) + k, { left: `${left}%`, len: 24 + (i * 7) % 16, below: true }));
}

// ── Building headers (Available results) ─────────────────────────────────
// A short streamer from the jump button of a third of them

function decorateBuildingHeader(header, { building }) {
  const h = hash(`header:${building.name}`);
  const jump = header.querySelector('.building-section-jump');
  if (h % 3 || !jump || jump.querySelector(':scope > .cv-decor')) return;
  hang(jump, h, { left: '50%', len: 16 + (h >>> 7) % 8, className: 'cv-streamer--chip', below: true });
}

// ── The search's results box ──────────────────────────────────────────────

function decorateSearchPanel() {
  const frame = document.querySelector('.search-results-frame');
  if (!frame || frame.querySelector(':scope > .cv-decor')) return;
  const h = hash(`searchpanel:${dayKey()}`);
  hang(frame, h, { left: `${60 + h % 30}%`, len: 26 + (h >>> 5) % 12 });
}

// ── The Campus sheet ──────────────────────────────────────────────────────
// A streamer from its top edge, put on once the Campus tab has finished
// fading in (decorations in the sheet while it fades turned iOS Safari's
// bottom safe area solid), and back whenever the sheet is rebuilt, as it is
// when the layout flips between phone and desktop.

const MAP_TAB = 'search-classrooms-container';
const mapShowing = () => !!document.getElementById(MAP_TAB)?.classList.contains('visible') && !document.hidden;
let sheetReady = false;
let sheetOn = false;

function decorateSheet() {
  const glass = document.querySelector('.campus-sheet .lg-sheet__glass');
  if (!sheetOn || !sheetReady || !glass || !mapShowing() || glass.querySelector(':scope > .cv-decor')) return;
  const h = hash(`sheet:${dayKey()}`);
  hang(glass, h, { left: `${64 + h % 24}%`, len: 26 });
}

function sheetAfterFadeIn() {
  const tab = document.getElementById(MAP_TAB);
  if (!tab || !mapShowing()) return;
  Promise.all(tab.getAnimations().map((a) => a.finished)).then(() => {
    if (!sheetOn || !mapShowing()) return;
    sheetReady = true;
    decorateSheet();
  }, () => { /* left mid-fade: the next tabvisible tries again */ });
}

// ── Search ────────────────────────────────────────────────────────────────
// A mask by the masked rooms' names

function decorateSearchRow(row, item) {
  if (row.querySelector('.cv-search-mask')) return;
  if (item.type !== 'classroom' || !masked().ids.has(item.room.id)) return;
  const badge = document.createElement('span');
  badge.className = 'cv-search-mask';
  badge.innerHTML = maskSvg(hash(`mask:${dayKey()}:${item.room.id}`));
  badge.title = maskLabel;
  badge.setAttribute('role', 'img');
  badge.setAttribute('aria-label', maskLabel);
  row.querySelector('.search-row-title-text')?.appendChild(badge);
}

// ── Map markers ───────────────────────────────────────────────────────────

function decorateMarker(el, { campus, building }) {
  if (el.querySelector(':scope > .cv-map-mask')) return;
  if (!masked().buildings.has(`${campus.id}:${building.name}`)) return;
  const mask = document.createElement('span');
  mask.className = 'cv-map-mask';
  mask.innerHTML = maskSvg(hash(`${campus.id}:${building.name}`));
  el.prepend(mask);
}

// ── Picker chips ──────────────────────────────────────────────────────────
// A short streamer hanging from the bottom edge of each of the three chips, a
// different one each day

const CHIP_HOSTS = ['campus-chip-picker', 'date-chip-picker', 'time-range-chip-picker'];

function decorateChips() {
  const day = dayKey();
  for (const tag of CHIP_HOSTS) {
    const chip = document.querySelector(`${tag} .lg-chip`);
    if (!chip || chip.querySelector(':scope > .cv-decor')) continue;
    const h = hash(`${tag}:${day}`);
    hang(chip, h, { left: `${22 + h % 56}%`, len: 14 + (h >>> 7) % 8, className: 'cv-streamer--chip', below: true });
  }
}

// ── Mask under the data status button ─────────────────────────────────────
// Not the settings button: on the Campus map the locate button sits below
// that one, and the mask would hang over it. Hangs on a ribbon from behind
// the button, swaying; a tap gives it a swing.

let dangler = null;
let danglerResize = null;

function placeDangler() {
  const btn = document.getElementById('data-fetch-btn');
  if (!dangler || !btn) return;
  dangler.style.left = `${btn.offsetLeft + btn.offsetWidth / 2}px`;
  dangler.style.top = `${btn.offsetTop + btn.offsetHeight / 2}px`;
}

function startDangler() {
  const btn = document.getElementById('data-fetch-btn');
  const host = btn?.offsetParent;
  if (!host) return;
  dangler = document.createElement('div');
  dangler.className = 'cv-dangler';
  dangler.innerHTML = `<div class="cv-dangler-sway"><div class="cv-dangler-line"></div>` +
    `<button type="button" class="cv-dangler-mask" tabindex="-1" aria-hidden="true">${maskSvg(hash(`dangler:${dayKey()}`))}</button></div>`;
  dangler.querySelector('.cv-dangler-mask').addEventListener('click', (e) => {
    e.stopPropagation();
    if (reduceMotion()) return;
    const sway = dangler.querySelector('.cv-dangler-sway');
    sway.classList.remove('cv-dangler-sway--swing');
    void sway.offsetWidth;
    sway.classList.add('cv-dangler-sway--swing');
  });
  host.appendChild(dangler);
  placeDangler();
  danglerResize = new ResizeObserver(placeDangler);
  danglerResize.observe(host);
}

// ── Coriandoli when something gets starred ────────────────────────────────

let lastTap = null; // { x, y, at }

const rememberTap = (e) => { lastTap = { x: e.clientX, y: e.clientY, at: performance.now() }; };

const onFavouritesChanged = (e) => {
  // On a graduation day its own burst takes this one's place (components/graduation.js)
  if (e.detail?.added == null || graduationShown()) return;
  // From the star that was just tapped, or the top of the screen
  const tap = lastTap && performance.now() - lastTap.at < 1500 ? lastTap : { x: innerWidth / 2, y: innerHeight * 0.2 };
  throwCoriandoli(tap.x, tap.y, { down: tap.y < innerHeight * 0.3 });
};

// ── Lifecycle ─────────────────────────────────────────────────────────────

// Whatever was built before this module loaded, or before the rooms did (the
// masked rooms need them)
function decorateBuilt() {
  document.querySelectorAll('.classroom-card').forEach((card) => {
    const id = Number(card.dataset.openClassroom);
    if (id) decorateCard(card, { id });
  });
  document.querySelectorAll('.map-pin[data-building][data-campus]').forEach((el) => {
    decorateMarker(el, { campus: { id: el.dataset.campus }, building: { name: el.dataset.building } });
  });
  document.querySelectorAll('.bo-card[data-building-name]').forEach((folder) => {
    decorateFolder(folder, { campusId: folder.dataset.campusId, building: { name: folder.dataset.buildingName } });
  });
  const banner = document.querySelector('.season-banner:not(.update-banner)');
  if (banner) decorateBanner(banner);
}

let chipsTimer = 0;
let listeners = new AbortController();

export function start() {
  listeners = new AbortController();
  const { signal } = listeners;
  maskLabel = t('season.carnival.maskRoom');

  startCoriandoli();
  setDecorator('card', decorateCard);
  setDecorator('marker', decorateMarker);
  setDecorator('folder', decorateFolder);
  setDecorator('detail', decorateDetail);
  setDecorator('searchRow', decorateSearchRow);
  setDecorator('banner', decorateBanner);
  setDecorator('buildingHeader', decorateBuildingHeader);
  setDecorator('info', decorateInfo);
  setDecorator('notFound', decorateNotFound);
  setDecorator('settings', decorateSettings);
  setDecorator('changelog', decorateChangelog);
  decorateBuilt();
  document.querySelectorAll('.building-section-header').forEach((header) => {
    const section = header.closest('.building-section');
    if (section) decorateBuildingHeader(header, { building: { name: section.dataset.buildingName } });
  });
  // The changelog is built when it's opened, so it may be there already
  const changelog = document.querySelector('#changelog-overlay .cl-content');
  if (changelog) decorateChangelog(changelog);
  decorateSearchPanel();
  sheetOn = true;
  sheetAfterFadeIn();
  document.addEventListener('tabvisible', sheetAfterFadeIn, { signal });
  document.addEventListener('campussheetresize', decorateSheet, { signal });
  startDangler();
  // The chips may still be upgrading
  Promise.all(CHIP_HOSTS.map((tag) => customElements.whenDefined(tag))).then(() => {
    chipsTimer = setTimeout(decorateChips, 300);
  });
  if (!directory) {
    ensureClassroomDirectory().then(decorateBuilt).catch(() => { /* no masked rooms today */ });
  }

  window.addEventListener('pointerdown', rememberTap, { capture: true, passive: true, signal });
  window.addEventListener('favourites-changed', onFavouritesChanged, { signal });
}

export function stop() {
  listeners.abort();
  sheetOn = false;
  sheetReady = false;
  stopCoriandoli();
  clearTimeout(chipsTimer);
  danglerResize?.disconnect();
  dangler?.remove();
  dangler = null;
  document.querySelectorAll('.cv-decor, .cv-search-mask, .cv-map-mask').forEach((el) => el.remove());
}
