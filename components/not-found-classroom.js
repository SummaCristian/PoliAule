// "Classroom not found": a #classroom/ hash that names no room, shown in-app
// by components/not-found-page.js. Only builds the markup; the page decides
// where it goes.
//
// A ghost of the classroom card the link asked for (tap it to flip it over),
// what went wrong, and the real rooms with the closest names to tap instead.
//
// `campus`: the campus object the hash's slug names, or null. `name`: the
// room name as typed in the link, or null. `classrooms`: the static
// directory (campus → buildings → classrooms), for the "Did you mean" list.
import { createButton } from 'vitrium';
import { t } from '../i18n.js';
import { thumbUrl, isPhotoBroken, markPhotoBroken } from '../utils/photo.js';
import { createTimeFormatter } from '../utils/time-format.js';
import { getClassroomStatusNow, getClassroomTimeline } from '../available-rooms-script.js';

const MAX_SUGGESTIONS = 3;

// The ghost's classroom, drawn in lines: a board on the wall, three rows of desks
const ROOM_SVG = `
  <svg class="nfc-room" viewBox="0 0 169 138" fill="none" stroke="currentColor" stroke-width="1.6"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="44" y="20" width="81" height="34" rx="3"></rect>
    <path d="M58 44c8-10 14 4 22-4M92 34h20M92 41h14" stroke-opacity=".6"></path>
    <path d="M38 76h93M30 96h109M20 118h129"></path>
    <path d="M44 76v8M125 76v8M38 96v10M131 96v10M28 118v12M141 118v12" stroke-opacity=".7"></path>
  </svg>`;

const GHOST_SVG = `
  <svg class="nfc-ghost" width="64" height="72" viewBox="0 0 64 72" aria-hidden="true">
    <path class="nfc-ghost-body" d="M6 32a26 26 0 0 1 52 0v34l-8.7-6-8.6 6-8.7-6-8.7 6-8.6-6L6 66z" stroke-width="2" stroke-linejoin="round"></path>
    <g class="nfc-ghost-eyes"><ellipse cx="23" cy="30" rx="3.6" ry="5"></ellipse><ellipse cx="41" cy="30" rx="3.6" ry="5"></ellipse></g>
  </svg>`;

// Same keys the classroom cards use, so a room reads the same here as there
const STATUS_KEYS = {
  'free': 'status.free',
  'occupied': 'status.cardBusy',
  'free-soon': 'status.cardFrom',
  'occupied-soon': 'status.cardUntil',
  'closed': 'status.closed',
};

export function createClassroomNotFound({ campus, name, classrooms, onHome, onSearch }) {
  const campusName = campus?.name ?? null;
  const roomName = name?.trim() || null;

  const el = document.createElement('div');
  el.className = 'nfc';
  el.innerHTML = `
    <div class="nfc-mist" aria-hidden="true"></div>
    <div class="nfc-column">
      <div class="nfc-float">
        <button type="button" class="nfc-flip" aria-pressed="false">
          <span class="nfc-flip-inner">
            <span class="nfc-face nfc-front">
              <span class="nfc-art">
                ${ROOM_SVG}
                <span class="nfc-badge" aria-hidden="true">?</span>
              </span>
              <span class="nfc-card-text">
                <span class="nfc-card-name"></span>
                <span class="nfc-card-where"></span>
              </span>
            </span>
            <span class="nfc-face nfc-back" aria-hidden="true">
              ${GHOST_SVG}
              <span class="nfc-back-text"></span>
            </span>
          </span>
        </button>
      </div>
      <div class="nfc-floor" aria-hidden="true"></div>
      <p class="nfc-caption" aria-live="polite"></p>

      <h1 class="nfc-title"></h1>
      <p class="nfc-text"></p>
    </div>
  `;

  const column = el.querySelector('.nfc-column');
  const flip = el.querySelector('.nfc-flip');
  const caption = el.querySelector('.nfc-caption');

  // The card: what the link asked for, as a card that isn't there
  const cardName = el.querySelector('.nfc-card-name');
  cardName.textContent = roomName ?? '?';
  // Long names (the directory has "LABORATORIO EXTREME DESIGN") step down to fit the card
  const len = (roomName ?? '?').length;
  if (len > 16) cardName.classList.add('nfc-card-name--xs');
  else if (len > 9) cardName.classList.add('nfc-card-name--sm');
  el.querySelector('.nfc-card-where').textContent = campusName
    ? t('notFound.classroomWhere').replace('{campus}', campusName)
    : `${t('building.prefix')} ?`;
  el.querySelector('.nfc-back-text').textContent = t('notFound.ghost');
  flip.setAttribute('aria-label', t('notFound.flipLabel'));

  const setCaption = (flipped) => {
    caption.textContent = t(flipped ? 'notFound.flipBack' : 'notFound.flipHint');
  };
  setCaption(false);
  flip.addEventListener('click', () => {
    const flipped = flip.classList.toggle('is-flipped');
    flip.setAttribute('aria-pressed', String(flipped));
    setCaption(flipped);
  });

  el.querySelector('.nfc-title').textContent = t('notFound.classroomTitle');
  const text = el.querySelector('.nfc-text');
  if (campusName && roomName) {
    fillTemplate(text, t('notFound.classroomText'), { room: roomName, campus: campusName }, 'room');
  } else {
    text.textContent = t('notFound.textClassroom');
  }

  // Did you mean: only with a name to compare, and only when something is close
  const matches = roomName ? closestRooms(roomName, campus ? [campus] : classrooms) : [];
  if (matches.length) column.appendChild(buildSuggestions(matches, !campus));

  column.appendChild(createButton({
    icon: '<i class="hgi-stroke hgi-search-01" aria-hidden="true"></i>',
    text: campusName
      ? t('notFound.searchCampus').replace('{campus}', campusName)
      : t('notFound.search'),
    className: 'nfc-search lg-glass--tinted',
    onClick: onSearch,
  }));

  return el;
}

// Fills `{key}` slots of a translated string. Values go in as text nodes, never
// markup (the room name comes straight from the URL); `bold` names the slot
// that's set in bold.
function fillTemplate(target, template, values, bold) {
  for (const part of template.split(/(\{\w+\})/)) {
    const key = part.match(/^\{(\w+)\}$/)?.[1];
    if (key === undefined) {
      target.append(part);
    } else if (key === bold) {
      const b = document.createElement('b');
      b.textContent = values[key] ?? '';
      target.append(b);
    } else {
      target.append(values[key] ?? '');
    }
  }
}

// ── Did you mean ────────────────────────────────────────────────────────

function buildSuggestions(matches, showCampus) {
  const section = document.createElement('section');
  section.className = 'nfc-did lg-ring';
  section.dataset.glassStyle = 'frost';
  const heading = document.createElement('h2');
  heading.className = 'nfc-did-title';
  heading.textContent = t('notFound.didYouMean');
  section.appendChild(heading);

  const rows = matches.map(match => buildRow(match, showCampus));
  rows.forEach(row => section.appendChild(row.el));

  // Opened straight from a link, the occupancy data is still on its way when
  // this draws: fill the statuses in as it arrives, then stop looking (or when
  // the page redraws and this list is gone)
  let tries = 0;
  const poll = () => {
    if (!section.isConnected) return;
    const known = rows.map(row => row.updateStatus()).some(Boolean);
    if (!known && ++tries < 20) setTimeout(poll, 700);
  };
  rows.forEach(row => row.updateStatus());
  setTimeout(poll, 0); // once the page has put it in the DOM
  return section;
}

function buildRow({ room, building, campus }, showCampus) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'nfc-row';
  row.innerHTML = `
    <span class="nfc-thumb"></span>
    <span class="nfc-row-body">
      <span class="nfc-row-name"></span>
      <span class="nfc-row-where"></span>
    </span>
    <span class="nfc-status" hidden><span class="nfc-status-dot"></span><span class="nfc-status-label"></span></span>
  `;

  row.querySelector('.nfc-row-name').textContent = room.name;
  row.querySelector('.nfc-row-where').textContent = [
    `${t('building.prefix')} ${building.name}`,
    showCampus ? campus.name : null,
  ].filter(Boolean).join(' · ');

  const thumb = row.querySelector('.nfc-thumb');
  const placeholder = () => {
    thumb.classList.add('nfc-thumb--none');
    thumb.innerHTML = '<i class="hgi-stroke hgi-door-01" aria-hidden="true"></i>';
  };
  if (room.idfoto && !isPhotoBroken(room.id)) {
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('load', () => img.classList.add('loaded'));
    img.addEventListener('error', () => { markPhotoBroken(room.id); placeholder(); });
    img.src = thumbUrl(room.id);
    thumb.appendChild(img);
  } else {
    placeholder();
  }

  // Same address the detail page writes. replace(), not a push: the broken link
  // shouldn't stay in the history to come back to, and the page then opens as
  // it does for a link followed from outside (its own Back clears the hash)
  row.addEventListener('click', () => {
    const url = '#classroom/' + campus.slug + '/' + encodeURIComponent(room.name);
    location.replace(location.pathname + location.search + url);
  });

  const statusEl = row.querySelector('.nfc-status');
  const label = row.querySelector('.nfc-status-label');
  return {
    el: row,
    // False while there's no occupancy data for the room (yet)
    updateStatus() {
      const status = getClassroomStatusNow(room.id);
      const key = STATUS_KEYS[status];
      if (!key) return false;
      let shown = t(key);
      if (status === 'free-soon' || status === 'occupied-soon') {
        const next = getClassroomTimeline(room.id)?.nextChange;
        shown = t(next ? key : (status === 'free-soon' ? 'status.freeSoon' : 'status.occupiedSoon'))
          .replace('{time}', next ? formatTime(next) : '');
      }
      statusEl.className = `nfc-status nfc-status--${status}`;
      statusEl.hidden = false;
      label.textContent = shown;
      return true;
    },
  };
}

function formatTime(hhmm) {
  const d = new Date();
  d.setHours(Number(hhmm.slice(0, 2)), Number(hhmm.slice(3, 5)), 0, 0);
  return createTimeFormatter({ hour: 'numeric', minute: '2-digit' }).format(d);
}

// ── Ranking ─────────────────────────────────────────────────────────────

// Lowercase, no accents, and only letters and digits: "B.2.44", "b 2 44" and
// "B244" are the same name
const normalise = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

function levenshtein(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// How close `room` is to the typed name, 0 when it isn't close at all. Edit
// distance as a share of the longer name, plus a bonus for one name starting
// with the other and for the room's building being the one the name starts
// with ("B2.4" and building B2). Names are compared whole and without the
// suffix some rooms carry ("B2.0.1 - D.I.").
function closeness(query, room, building) {
  const full = normalise(room.name);
  const names = [full];
  const head = normalise(room.name.split(/\s+-\s+/)[0]);
  if (head && head !== full) names.push(head);

  let best = 0;
  for (const n of names) {
    if (!n) continue;
    const longest = Math.max(query.length, n.length);
    const shortest = Math.min(query.length, n.length);
    const distance = levenshtein(query, n);
    const contained = shortest >= 3 && (n.includes(query) || query.includes(n));
    // A third of the name may differ; on a short one (T.1) a single letter is
    // already a different room, so it has to start the same
    if (!contained && (distance > Math.max(1, Math.floor(longest / 3)) || (shortest <= 3 && n[0] !== query[0]))) continue;
    let score = 1 - distance / longest;
    if (contained) score = Math.max(score, 0.6);
    if (shortest >= 2 && (n.startsWith(query) || query.startsWith(n))) score += 0.15;
    best = Math.max(best, score);
  }
  if (!best) return 0;

  const buildingName = normalise(building.name);
  if (buildingName && query.startsWith(buildingName)) best += 0.1;
  return best;
}

// The rooms with the names closest to `name`, at most MAX_SUGGESTIONS
function closestRooms(name, campuses) {
  const query = normalise(name);
  if (!query) return [];
  const found = [];
  for (const campus of campuses) {
    for (const building of campus.buildings) {
      for (const room of building.classrooms) {
        const score = closeness(query, room, building);
        if (score > 0) found.push({ room, building, campus, score });
      }
    }
  }
  found.sort((a, b) => b.score - a.score || a.room.name.localeCompare(b.room.name, undefined, { numeric: true }));
  return found.slice(0, MAX_SUGGESTIONS);
}
