// Halloween decorations (Oct 24 – Nov 1), lazy-loaded by utils/season.js.
// The pumpkin accent, the pumpkin on the "now" markers and the spooky strings
// are plain CSS / locale entries keyed on <html data-season="halloween">; this
// module adds what needs the DOM:
//   - cobwebs and small spiders on some classroom cards and on the pickers'
//     chips, each strung to the element's real rounded outline
//   - a haunted classroom per campus and day: a ghost peeking into its card
//     and floating over its building on the map
//   - a spider hanging from the settings button (tap it to scare it up)
//   - now and then a flock of bats across the screen, and a spider walking
//     along the tab bar
//   - a burst of candy when something gets starred
//   - the logo in its witch hat with a pumpkin, in the header and the tab icon
// Everything here is static or plays for a few seconds; nothing animates
// continuously except the small ghost. With reduced motion the bats, the
// walking spider and the candy stay off, and the rest holds still.

import { setDecorator } from '../utils/season.js';
import { classroomsData as directory } from '../classroom-search-data.js';

const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Randomness that stays put ─────────────────────────────────────────────
// Decorations come from a hash of what they sit on, so a card keeps the same
// web across re-renders and every visitor sees the same haunted room.

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  let s = seed || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

// Today in Milan, YYYY-MM-DD: the haunted rooms change at local midnight
function dayKey() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
}

// ── Artwork ───────────────────────────────────────────────────────────────

const SPIDER_PARTS = `<g class="hw-legs"><path d="M10 12 L4 7 L2 3M10 13 L3 11 L0 10M10 14 L3 16 L1 19M11 15 L6 20 L5 24M16 12 L22 7 L24 3M16 13 L23 11 L26 10M16 14 L23 16 L25 19M15 15 L20 20 L21 24"/></g>
  <ellipse class="hw-body" cx="13" cy="16" rx="4.6" ry="5.4"/><circle class="hw-body" cx="13" cy="9.6" r="3"/>
  <circle class="hw-eye" cx="11.9" cy="9.2" r=".75"/><circle class="hw-eye" cx="14.1" cy="9.2" r=".75"/>`;

const spiderSvg = (px) =>
  `<svg class="hw-spider" width="${px}" height="${px}" viewBox="0 0 26 26" aria-hidden="true">${SPIDER_PARTS}</svg>`;

const GHOST_SVG = `<svg width="30" height="34" viewBox="0 0 30 34" aria-hidden="true"><path class="hw-ghost-body" d="M15 2C8 2 4 7 4 14v17l3.7-3 3.6 3 3.7-3 3.7 3 3.6-3 3.7 3V14C26 7 22 2 15 2z"/><ellipse class="hw-ghost-face" cx="11" cy="13" rx="1.8" ry="2.5"/><ellipse class="hw-ghost-face" cx="19" cy="13" rx="1.8" ry="2.5"/><ellipse class="hw-ghost-face" cx="15" cy="19.5" rx="1.7" ry="2.1"/></svg>`;

const batSvg = (w) => `<svg width="${w.toFixed(0)}" height="${(w / 2).toFixed(0)}" viewBox="0 0 40 20" aria-hidden="true">
  <path class="hw-bat-shape hw-bat-wing" d="M19 9C15 3 8 2 1 5c3 2 4 4 3 7 3-2 5-1 6 2 2-3 5-3 8-2z"/>
  <path class="hw-bat-shape hw-bat-wing" d="M21 9c4-6 11-7 18-4-3 2-4 4-3 7-3-2-5-1-6 2-2-3-5-3-8-2z"/>
  <path class="hw-bat-shape" d="M17.6 6.2 17.2 3l1.9 2h1.8l1.9-2-.4 3.2c.8 1 1 2.2.8 3.6-.3 2.6-1.6 4.6-3.2 4.6s-2.9-2-3.2-4.6c-.2-1.4 0-2.6.8-3.6z"/>
  <circle class="hw-eye" cx="19.1" cy="7.2" r=".55"/><circle class="hw-eye" cx="20.9" cy="7.2" r=".55"/></svg>`;

// A web strung across the top-left corner of a box rounded with `radius`
// (mirror it for the top-right). The hub floats a little way in from the
// middle of the curve; each spoke runs until it meets the real outline (the
// top edge, the curve, or the left edge), so the web hugs pills and cards
// alike. On a pill, with no straight side, the lowest spoke stops at the
// curve's widest point.
function webSvg(size, radius, seed, { withSpider = false, boxHeight = Infinity } = {}) {
  const r = rng(seed);
  const R = Math.max(0, radius);
  let hub = R * (1 - Math.SQRT1_2) + size * (0.3 + r() * 0.06) * Math.SQRT1_2;
  const inside = (x, y) => !(x < R && y < R && Math.hypot(x - R, y - R) > R - 1);
  while (!inside(hub, hub)) hub += 1;
  const H = [hub, hub];

  // Distance from the hub to the outline along angle th
  const hit = (th) => {
    const dx = Math.cos(th), dy = Math.sin(th);
    let best = Infinity;
    if (dy < -1e-6) {
      const t = -H[1] / dy;
      if (H[0] + t * dx >= R) best = Math.min(best, t);
    }
    if (dx < -1e-6) {
      const t = -H[0] / dx;
      if (H[1] + t * dy >= R) best = Math.min(best, t);
    }
    if (R > 0) {
      const ox = H[0] - R, oy = H[1] - R;
      const b = dx * ox + dy * oy, disc = b * b - (ox * ox + oy * oy - R * R);
      if (disc >= 0) {
        const t = -b + Math.sqrt(disc);
        if (t > 0 && H[0] + t * dx <= R + 0.5 && H[1] + t * dy <= R + 0.5) best = Math.min(best, t);
      }
    }
    return best;
  };

  const reach = size * 0.8;
  const yEnd = Math.min(hub + reach, Math.max(R, boxHeight - R));
  const from = -Math.atan2(hub, reach) * 180 / Math.PI;
  const to = Math.atan2(yEnd - hub, -hub) * 180 / Math.PI - 360;
  const n = 7 + Math.floor(r() * 2);
  const spokes = [];
  for (let i = 0; i < n; i++) {
    const deg = from + (to - from) * (i / (n - 1)) + (i && i < n - 1 ? (r() - 0.5) * 8 : 0);
    const th = deg * Math.PI / 180;
    const len = hit(th);
    spokes.push({ th, len: Number.isFinite(len) ? len : size });
  }
  const at = (sp, f) => [H[0] + Math.cos(sp.th) * sp.len * f, H[1] + Math.sin(sp.th) * sp.len * f];
  const f1 = (v) => v.toFixed(1);

  let d = '';
  for (const sp of spokes) {
    const [x, y] = at(sp, 1);
    d += `M${f1(H[0])} ${f1(H[1])}L${f1(x)} ${f1(y)}`;
  }
  const rings = 3 + Math.floor(r() * 2);
  for (let k = 1; k <= rings; k++) {
    const f = k / (rings + 0.6);
    for (let i = 0; i < spokes.length - 1; i++) {
      const a = spokes[i], b = spokes[i + 1];
      const [x1, y1] = at(a, f), [x2, y2] = at(b, f);
      // Each thread sags toward the hub
      const [cx, cy] = at({ th: (a.th + b.th) / 2, len: Math.min(a.len, b.len) }, f * 0.8);
      d += `M${f1(x1)} ${f1(y1)}Q${f1(cx)} ${f1(cy)} ${f1(x2)} ${f1(y2)}`;
    }
  }
  let spider = '';
  if (withSpider) {
    const sp = spokes[2 + Math.floor(r() * (spokes.length - 4))];
    const [sx, sy] = at(sp, 0.55);
    spider = `<g transform="translate(${f1(sx)} ${f1(sy)}) rotate(${Math.round(r() * 360)}) scale(0.42) translate(-13 -13)">${SPIDER_PARTS}</g>`;
  }
  const box = Math.ceil(size * 1.3);
  // Drawn twice: a soft dark line under the thread, so it reads on light
  // walls as well as dark ones
  return `<svg class="hw-spider" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}" aria-hidden="true">` +
    `<path class="hw-web-outline" d="${d}"/><path class="hw-web-thread" d="${d}"/>${spider}</svg>`;
}

// ── Haunted rooms ─────────────────────────────────────────────────────────
// One per campus per day, from the rooms people actually book (no secondary
// buildings, no events-only rooms) that have a photo for the ghost to float
// over. The map haunts that room's building.

let haunted = null; // { day, ids: Set<number>, buildings: Set<"campusId:name"> }

function hauntedRooms() {
  const day = dayKey();
  if (haunted?.day === day) return haunted;
  haunted = { day, ids: new Set(), buildings: new Set() };
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
    const [id, buildingName] = rooms[hash(`${day}:${campus.id}`) % rooms.length];
    haunted.ids.add(id);
    haunted.buildings.add(`${campus.id}:${buildingName}`);
  }
  return haunted;
}

// ── Classroom cards ───────────────────────────────────────────────────────

let cardRadius = 16;

function decorateCard(card, classroom) {
  const clip = card.querySelector('.classroom-card-clip');
  if (!clip || clip.querySelector(':scope > .hw-decor, :scope > .hw-ghost')) return;
  const id = classroom.id;

  if (hauntedRooms().ids.has(id)) {
    const ghost = document.createElement('div');
    ghost.className = 'hw-ghost';
    ghost.innerHTML = GHOST_SVG;
    clip.appendChild(ghost);
  }

  // About one card in three
  const h = hash(String(id));
  if (h % 3 !== 0) return;
  const kind = ['web', 'web', 'webspider', 'hang'][(h >>> 4) % 4];
  // Cards that can show the favourite star keep its top-right corner free
  const right = card.dataset.favStar === undefined && ((h >>> 8) & 1) === 1;

  const el = document.createElement('div');
  el.className = 'hw-decor hw-decor--card';
  if (kind === 'hang') {
    const len = 14 + ((h >>> 16) % 22);
    el.classList.add('hw-hang');
    el.style.left = `${18 + ((h >>> 10) % 50)}%`;
    el.innerHTML = `<div class="hw-hang-thread" style="height:${len}px"></div>` +
      `<div class="hw-hang-bug" style="top:${len - 2}px">${spiderSvg(16)}</div>`;
  } else {
    if (right) el.classList.add('hw-decor--right');
    el.innerHTML = webSvg(34 + ((h >>> 12) % 14), cardRadius, h, { withSpider: kind === 'webspider' });
  }
  clip.appendChild(el);
}

// ── Picker chips ──────────────────────────────────────────────────────────

const CHIP_HOSTS = ['campus-chip-picker', 'date-chip-picker', 'time-range-chip-picker'];

function decorateChips() {
  const day = dayKey();
  for (const tag of CHIP_HOSTS) {
    const chip = document.querySelector(`${tag} .lg-chip`);
    if (!chip || chip.querySelector(':scope > .hw-decor')) continue;
    // About half the chips, a different half each day
    const h = hash(`${tag}:${day}`);
    if (h % 2) continue;
    const cs = getComputedStyle(chip);
    const height = chip.offsetHeight;
    if (!height) continue;
    const radius = Math.min(parseFloat(cs.borderTopRightRadius) || 0, height / 2) - (parseFloat(cs.borderTopWidth) || 0);
    const el = document.createElement('span');
    // The right end: the left one holds the chip's icon
    el.className = 'hw-decor hw-decor--chip hw-decor--right';
    el.innerHTML = webSvg(15 + (h >>> 9) % 4, radius, h, { boxHeight: height });
    chip.appendChild(el);
  }
}

// ── Map markers ───────────────────────────────────────────────────────────

function decorateMarker(el, { campus, building }) {
  if (el.querySelector(':scope > .hw-map-ghost')) return;
  if (!hauntedRooms().buildings.has(`${campus.id}:${building.name}`)) return;
  const ghost = document.createElement('span');
  ghost.className = 'hw-map-ghost';
  ghost.innerHTML = GHOST_SVG;
  el.prepend(ghost);
}

// ── Spider under the settings button ──────────────────────────────────────

let dangler = null;
let danglerTimer = 0;
let danglerResize = null;

function placeDangler() {
  const btn = document.getElementById('settings-btn');
  if (!dangler || !btn) return;
  dangler.style.left = `${btn.offsetLeft + btn.offsetWidth / 2}px`;
  dangler.style.top = `${btn.offsetTop + btn.offsetHeight / 2}px`;
}

function lowerDangler() {
  if (!dangler) return;
  dangler.classList.remove('hw-dangler--climbing', 'hw-dangler--up');
}

function climbDangler() {
  if (!dangler) return;
  clearTimeout(danglerTimer);
  dangler.classList.add('hw-dangler--up', 'hw-dangler--climbing');
  setTimeout(() => dangler?.classList.remove('hw-dangler--climbing'), 450);
  // Comes back down after a while
  danglerTimer = setTimeout(lowerDangler, 20000 + Math.random() * 10000);
}

function startDangler() {
  const btn = document.getElementById('settings-btn');
  const host = btn?.offsetParent;
  if (!host) return;
  dangler = document.createElement('div');
  dangler.className = 'hw-dangler hw-dangler--up';
  dangler.innerHTML = `<div class="hw-dangler-sway"><div class="hw-dangler-line"></div>` +
    `<button type="button" class="hw-dangler-bug" tabindex="-1" aria-hidden="true">${spiderSvg(26)}</button></div>`;
  dangler.querySelector('.hw-dangler-bug').addEventListener('click', (e) => {
    e.stopPropagation();
    climbDangler();
  });
  host.appendChild(dangler);
  placeDangler();
  danglerResize = new ResizeObserver(placeDangler);
  danglerResize.observe(host);
  // Lowers itself in once the app has settled
  danglerTimer = setTimeout(lowerDangler, 1500);
}

// ── Bats ──────────────────────────────────────────────────────────────────

let batLayer = null;
let batTimer = 0;

function releaseBats() {
  if (reduceMotion() || document.hidden || !batLayer) return;
  const W = innerWidth, H = innerHeight;
  const ltr = Math.random() < 0.5;
  const count = 3 + Math.floor(Math.random() * 3);
  const baseY = H * (0.12 + Math.random() * 0.35);
  for (let i = 0; i < count; i++) {
    const size = 34 + Math.random() * 20;
    const bat = document.createElement('div');
    bat.className = 'hw-bat';
    bat.style.setProperty('--hw-flap', `${(0.13 + Math.random() * 0.08).toFixed(2)}s`);
    bat.innerHTML = batSvg(size);
    batLayer.appendChild(bat);
    // A wavy line across the screen, drifting up, tilting with each bob
    const y0 = baseY + (Math.random() - 0.5) * 90;
    const rise = -40 - Math.random() * 60;
    const amp = 8 + Math.random() * 12, waves = 2 + Math.random() * 1.5, phase = Math.random() * 6.28;
    const x0 = ltr ? -size - 10 : W + 10, x1 = ltr ? W + 10 : -size - 10;
    const frames = [];
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      const wave = phase + t * waves * 6.28;
      frames.push({ transform: `translate(${(x0 + (x1 - x0) * t).toFixed(1)}px, ${(y0 + rise * t + Math.sin(wave) * amp).toFixed(1)}px) rotate(${(Math.cos(wave) * 10).toFixed(1)}deg)` });
    }
    const anim = bat.animate(frames, {
      duration: 2600 + Math.random() * 1200,
      delay: i * (90 + Math.random() * 160),
      easing: 'linear',
      fill: 'backwards',
    });
    anim.onfinish = anim.oncancel = () => bat.remove();
  }
}

function scheduleBats(first = false) {
  // The first flock soon after launch, then every one to two and a half minutes
  const wait = first ? 8000 + Math.random() * 12000 : 60000 + Math.random() * 90000;
  batTimer = setTimeout(() => {
    releaseBats();
    scheduleBats();
  }, wait);
}

// ── Spider walking along the tab bar ──────────────────────────────────────

let tabSpiderTimer = 0;

function sendTabSpider() {
  if (reduceMotion() || document.hidden || !batLayer) return;
  const wrapper = document.querySelector('.bn-wrapper');
  const bar = wrapper?.querySelector('.lg-tabbar__bar');
  // Only the phone's floating bar, not the desktop side rail, and not under
  // a classroom page
  if (!bar || wrapper.classList.contains('lg-tabbar--vertical') || wrapper.classList.contains('detail-open')) return;
  const rect = bar.getBoundingClientRect();
  if (!rect.width) return;
  const size = 18;
  const curve = rect.height / 2;
  const y = rect.top - size / 2 - 1;
  const x0 = rect.left + curve * 0.6 - size / 2;
  const x1 = rect.right - curve * 0.6 - size / 2;
  const el = document.createElement('div');
  el.className = 'hw-walker';
  el.innerHTML = spiderSvg(size);
  batLayer.appendChild(el);
  const walk = el.animate([
    { transform: `translate(${x0}px, ${y}px) rotate(90deg)` },
    { transform: `translate(${(x0 + x1) / 2}px, ${y - 1}px) rotate(92deg)`, offset: 0.5 },
    { transform: `translate(${x1}px, ${y}px) rotate(90deg)` },
  ], { duration: Math.max(1800, (x1 - x0) * 28), easing: 'linear', fill: 'forwards' });
  walk.onfinish = () => {
    // Off the end of the bar it tips over and drops out of sight
    const fall = el.animate([
      { transform: `translate(${x1}px, ${y}px) rotate(90deg)` },
      { transform: `translate(${x1 + 14}px, ${y + 4}px) rotate(150deg)`, offset: 0.2 },
      { transform: `translate(${x1 + 26}px, ${innerHeight + 40}px) rotate(320deg)` },
    ], { duration: 700, easing: 'cubic-bezier(.5, 0, .9, .6)', fill: 'forwards' });
    fall.onfinish = fall.oncancel = () => el.remove();
  };
  walk.oncancel = () => el.remove();
}

function scheduleTabSpider() {
  tabSpiderTimer = setTimeout(() => {
    sendTabSpider();
    scheduleTabSpider();
  }, 50000 + Math.random() * 70000);
}

// ── Candy when something gets starred ─────────────────────────────────────

let candy = null;          // { fire, shapes }
let candyCanvas = null;
let lastTap = null;        // { x, y, at }

const rememberTap = (e) => { lastTap = { x: e.clientX, y: e.clientY, at: performance.now() }; };

async function burstCandy() {
  if (reduceMotion()) return;
  if (!candy) {
    const { default: confetti } = await import('canvas-confetti');
    candyCanvas = document.createElement('canvas');
    candyCanvas.className = 'hw-candy';
    document.body.appendChild(candyCanvas);
    let shapes = ['circle'];
    try {
      shapes = ['🍬', '🍭', '🍫'].map((text) => confetti.shapeFromText({ text, scalar: 1.8 }));
    } catch { /* no emoji shapes: plain dots */ }
    candy = { fire: confetti.create(candyCanvas, { resize: true }), shapes };
  }
  // From the star that was just tapped, or the top of the screen
  const tap = lastTap && performance.now() - lastTap.at < 1500 ? lastTap : { x: innerWidth / 2, y: innerHeight * 0.2 };
  candy.fire({
    particleCount: 16, spread: 75, startVelocity: 20, gravity: 0.9, ticks: 140, scalar: 1.8, flat: true,
    shapes: candy.shapes,
    colors: ['#f07a1a', '#a855f7', '#22c55e', '#ef4444'],
    origin: { x: tap.x / candyCanvas.clientWidth, y: Math.min(1, tap.y / candyCanvas.clientHeight) },
    disableForReducedMotion: true,
  });
}

const onFavouritesChanged = (e) => {
  if (e.detail?.added != null) burstCandy();
};

// ── Logo and tab icon ─────────────────────────────────────────────────────
// The header and splash logos' own <img>s take the Halloween drawing (the
// usual logo plus a hat and a pumpkin, the chair at the same spot), so the
// splash and Info page morphs keep working on them; .hw-logo sizes it so the
// chair lands exactly where it was (see style.css). index.html already swaps
// them as they're parsed; this covers the season being turned on later, and
// puts the usual logo back when it's turned off. The tab icon changes too; a
// home screen icon can't.

const LOGO_SRC = '/favicons/halloween/logo.webp';
const USUAL_LOGO_SRC = '/favicons/main/logo.webp';
const ICON_SRC = '/favicons/halloween/favicon-96x96.png';
let logoSwap = null;   // { el, src }
let iconSwap = null;   // [{ link, href, type }]

function startLogo() {
  const el = document.querySelector('.header-logo');
  if (el?.classList.contains('hw-logo')) {
    logoSwap = { el, src: USUAL_LOGO_SRC };
  } else if (el) {
    const img = new Image();
    img.src = LOGO_SRC;
    // Swapped only once it's decoded, so the header never shows a blank logo
    img.decode().then(() => {
      if (logoSwap) return;
      logoSwap = { el, src: el.getAttribute('src') };
      el.src = LOGO_SRC;
      el.classList.add('hw-logo');
    }).catch(() => { /* keep the usual logo */ });
  }
  iconSwap = [...document.querySelectorAll('link[rel~="icon"]')].map((link) => ({ link, href: link.getAttribute('href'), type: link.type }));
  for (const { link } of iconSwap) {
    link.type = 'image/png';
    link.href = ICON_SRC;
  }
}

function stopLogo() {
  if (logoSwap) {
    logoSwap.el.src = logoSwap.src;
    logoSwap.el.classList.remove('hw-logo');
    logoSwap = null;
  }
  for (const { link, href, type } of iconSwap ?? []) {
    link.type = type;
    link.href = href;
  }
  iconSwap = null;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────

let chipsTimer = 0;

export function start() {
  cardRadius = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--radius-lg')) || 16;

  setDecorator('card', decorateCard);
  setDecorator('marker', decorateMarker);
  // Whatever was built before this module loaded
  document.querySelectorAll('.classroom-card').forEach((card) => {
    const id = Number(card.dataset.openClassroom);
    if (id) decorateCard(card, { id });
  });
  document.querySelectorAll('.map-pin[data-building][data-campus]').forEach((el) => {
    decorateMarker(el, { campus: { id: el.dataset.campus }, building: { name: el.dataset.building } });
  });

  // The chips may still be upgrading
  Promise.all(CHIP_HOSTS.map((tag) => customElements.whenDefined(tag))).then(() => {
    chipsTimer = setTimeout(decorateChips, 300);
  });

  startLogo();
  startDangler();

  batLayer = document.createElement('div');
  batLayer.className = 'hw-sky';
  batLayer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(batLayer);
  scheduleBats(true);
  scheduleTabSpider();

  window.addEventListener('pointerdown', rememberTap, { capture: true, passive: true });
  window.addEventListener('favourites-changed', onFavouritesChanged);
}

export function stop() {
  stopLogo();
  clearTimeout(chipsTimer);
  clearTimeout(danglerTimer);
  clearTimeout(batTimer);
  clearTimeout(tabSpiderTimer);
  danglerResize?.disconnect();
  dangler?.remove();
  dangler = null;
  batLayer?.remove();
  batLayer = null;
  candyCanvas?.remove();
  candyCanvas = null;
  candy = null;
  document.querySelectorAll('.hw-decor, .hw-ghost, .hw-map-ghost').forEach((el) => el.remove());
  window.removeEventListener('pointerdown', rememberTap, { capture: true });
  window.removeEventListener('favourites-changed', onFavouritesChanged);
}
