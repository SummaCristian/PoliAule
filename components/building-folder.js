import { t } from '../i18n.js';
import { escapeHtml } from '../utils/html.js';
import { buildingOutlineSvg } from '../utils/building-outline.js';
import { thumbUrl, thumbUrlCache, markPhotoBroken, isPhotoBroken } from '../utils/photo.js';

// A building card drawn as a glass folder (styles: .bo-card in
// building-overview.css), shared by the Available tab's building overview and
// the Campus tab's sheet:
//
//   back    an SVG panel with a tab, a little taller than the front
//   papers  up to three of the building's classroom photos, card-shaped and
//           fanned out between the two layers. Just the image: the rest of
//           a classroom card (its text, rim, gradient stroke, big shadow)
//           would sit under the glass where none of it reads, and those are
//           the expensive parts to draw several dozen times
//   front   Vitrium glass (.lg-glass) holding the number, name, room count,
//           a caller-supplied footer and the building's outline. Its blur
//           lives on a separate, untilted .bo-card-frost right behind it:
//           Chrome skips backdrop-filter on anything with a 3D transform,
//           so the tilted front keeps only the tint, rim and stroke
//
// Hovering or pressing "opens" it: a single --open factor (0 at rest, 1 on
// hover, 1.4 pressed) lifts and spreads the cards and leans the front toward
// you, all in CSS. Hover and press come from pointer events rather than
// :hover / :active (see trackPointer). The papers are inert: the whole folder is one control, and
// a tap on a card inside it must never open that classroom.
//
// The back's path and the cards' fan depend on the folder's width, which the
// grid decides; one ResizeObserver keeps both in step with it.

const FOLDER_H = 204;   // the folder's fixed height, CSS px (matches .bo-card)
const BACK_TOP = 30;    // top of the tab
const TAB_H = 12;
const TAB_W = 58;
const CARD_W = 154;     // a .classroom-card's size (aspect 154 / 196), which the papers are scaled from
const CARD_H = 196;
const REST_Y = 44;      // the cards' resting top edge, just under the back's rim

// Where each card sits, per how many the folder holds: fraction of the free
// width, top offset from REST_Y, and rotation (deg).
// A compact folder (beside classroom cards, in Favourites) drops the headroom
// above the tab, so its top lines up with theirs: everything moves up by this.
const COMPACT_LIFT = BACK_TOP;

const FAN = {
  1: [[0.5, 0, -2]],
  2: [[0.19, 2, -4], [0.79, 0, 4]],
  3: [[0.06, 3, -5], [0.5, 0, 1], [0.94, 4, 5]],
};

const STATUS_RANK = { 'free': 0, 'free-soon': 1, 'partially-free': 2, 'occupied-soon': 3, 'occupied': 4, 'closed': 5 };

const hasPhoto = (classroom) => !!classroom.idfoto && !isPhotoBroken(classroom.id);

// The up-to-three rooms a folder shows: ones with a photo first, then the
// freest, then the biggest. `rooms` is [{ classroom, status }]; status may be
// null (no data today).
export function pickFolderRooms(rooms) {
  const rank = (s) => STATUS_RANK[s] ?? 6;
  return [...rooms]
    .sort((a, b) => hasPhoto(b.classroom) - hasPhoto(a.classroom)
      || rank(a.status) - rank(b.status)
      || (b.classroom.seats ?? 0) - (a.classroom.seats ?? 0))
    .slice(0, 3);
}

function backPath(w, h) {
  const r = 18, tr = 8;
  return `M0 ${h - r}L0 ${tr}Q0 0 ${tr} 0L${TAB_W - 9} 0`
    + `C${TAB_W - 2} 0 ${TAB_W + 2} ${TAB_H} ${TAB_W + 14} ${TAB_H}`
    + `L${w - r} ${TAB_H}Q${w} ${TAB_H} ${w} ${TAB_H + r}L${w} ${h - r}`
    + `Q${w} ${h} ${w - r} ${h}L${r} ${h}Q0 ${h} 0 ${h - r}Z`;
}

const laidOut = new WeakMap(); // folder -> the size layout() last ran for

// `height` is the folder's own: FOLDER_H, unless its host sizes it (the
// Favourites strip matches it to the classroom cards beside it).
function layout(folder, width, height = FOLDER_H) {
  if (!width) return;
  // A ResizeObserver reports every observed folder at least once, also when
  // nothing changed: skip those, each one is a style + layout pass.
  const size = `${width}x${height}`;
  if (laidOut.get(folder) === size) return;
  laidOut.set(folder, size);
  const baseScale = Number(folder.dataset.paperScale) || 0.5;
  const lift = folder.classList.contains('bo-card--compact') ? COMPACT_LIFT : 0;
  const backH = (height || FOLDER_H) - BACK_TOP + lift;
  const svg = folder.querySelector('.bo-card-back');
  svg.setAttribute('width', width);
  svg.setAttribute('height', backH);
  svg.querySelector('path').setAttribute('d', backPath(width, backH));

  // Papers grow a little with wider folders (desktop grid), never below the base size.
  const scale = Math.min(baseScale * 1.44, Math.max(baseScale, (width / 346) * (baseScale / 0.5)));
  const papers = folder.querySelectorAll('.bo-paper');
  const fan = FAN[papers.length] ?? [];
  const w = CARD_W * scale;
  const free = width - w;
  papers.forEach((paper, i) => {
    const [fx, dy] = fan[i];
    paper.style.left = `${fx * free}px`;
    paper.style.top = `${REST_Y - lift + dy}px`;
    paper.style.width = `${w}px`;
    paper.style.height = `${CARD_H * scale}px`;
  });
}

const resizer = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const box = entry.contentBoxSize?.[0];
    layout(entry.target, box?.inlineSize ?? entry.contentRect.width, box?.blockSize ?? entry.contentRect.height);
  }
});

// Hover for any pointer that can hover (mouse, trackpad, Pencil), on any
// device. `@media (hover: hover)` goes by the primary input, which on an iPad
// is touch even with a trackpad attached, so :hover in it never fired there;
// and a plain :hover sticks after a finger tap. A finger never sets it.
//
// Press is .bo-card--pressed rather than :active, which a finger sets the
// moment it lands, so every scroll that started on a folder opened it, and
// on a phone the folder fought the scroll. A finger presses only once it has
// rested PRESS_DELAY without moving, and lets go as soon as it moves (a
// scroll, which also ends in pointercancel), like a native list row.
const PRESS_DELAY = 90;   // ms
const PRESS_SLOP = 8;     // px a finger can drift before it counts as a scroll

function trackPointer(folder) {
  let timer = 0;
  let start = null;
  const press = () => folder.classList.add('bo-card--pressed');
  const release = () => {
    clearTimeout(timer);
    start = null;
    folder.classList.remove('bo-card--pressed');
  };
  folder.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'touch') folder.classList.add('bo-card--hover');
  });
  folder.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') { press(); return; }
    start = { x: e.clientX, y: e.clientY };
    clearTimeout(timer);
    timer = setTimeout(press, PRESS_DELAY);
  });
  folder.addEventListener('pointermove', (e) => {
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > PRESS_SLOP) release();
  });
  folder.addEventListener('pointerup', release);
  folder.addEventListener('pointerleave', () => {
    release();
    folder.classList.remove('bo-card--hover');
  });
  folder.addEventListener('pointercancel', () => {
    release();
    folder.classList.remove('bo-card--hover');
  });
}

// Builds the folder. `rooms` are the ones to show as papers (see
// pickFolderRooms), each { classroom, status }; `footerHtml` is trusted markup
// for the front's bottom row (the caller escapes anything in it);
// `paperScale` is the cards' size relative to a real classroom card;
// `compact` drops the headroom above the tab (see COMPACT_LIFT).
export function buildBuildingFolder({ campusId, building, rooms, total, footerHtml = '', paperScale = 0.5, compact = false }) {
  const folder = document.createElement('div');
  folder.className = compact ? 'bo-card bo-card--compact' : 'bo-card';
  folder.dataset.buildingName = building.name;
  folder.dataset.paperScale = paperScale;

  folder.innerHTML = `
    <svg class="bo-card-back" height="${FOLDER_H - BACK_TOP}" aria-hidden="true" focusable="false"><path/></svg>
    <div class="bo-card-papers" inert></div>
    <div class="bo-card-frost" aria-hidden="true"></div>
    <div class="bo-card-front lg-glass">
      ${buildingOutlineSvg(campusId, building.name)}
      <span class="bo-card-kicker">${escapeHtml(t('building.prefix'))}</span>
      <span class="bo-card-name">${escapeHtml(building.name)}</span>
      ${building.altName ? `<span class="bo-card-alt">${escapeHtml(building.altName)}</span>` : ''}
      <span class="bo-card-total">${escapeHtml(t('overview.subtitle').replace('{n}', total))}</span>
      <div class="bo-card-footer">${footerHtml}</div>
    </div>
  `;

  // Each paper's tilt and spread depend only on how many there are, so they
  // are set here, before the folder's first style pass. Set later (from
  // layout()), they changed the papers' transform and every paper played its
  // 0.45s transition from flat to fanned as the folder appeared.
  const papers = folder.querySelector('.bo-card-papers');
  const fan = FAN[rooms.length] ?? [];
  rooms.forEach(({ classroom }, i) => {
    const paper = document.createElement('div');
    paper.className = 'bo-paper';
    paper.style.setProperty('--rot', `${fan[i][2]}deg`);
    paper.style.setProperty('--dx', `${Math.round((i - (rooms.length - 1) / 2) * 7)}px`);
    if (hasPhoto(classroom)) {
      // Same thumbnail (and cache) the classroom cards use, so it is usually
      // already in the HTTP cache by the time a folder shows it.
      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.onerror = () => { markPhotoBroken(classroom.id); img.remove(); };
      img.src = thumbUrlCache.get(classroom.id) ?? thumbUrl(classroom.id);
      thumbUrlCache.set(classroom.id, img.src);
      paper.appendChild(img);
    }
    papers.appendChild(paper);
  });

  trackPointer(folder);
  resizer.observe(folder);
  return folder;
}
