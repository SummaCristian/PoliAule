// Hover preview on classroom cards: rest the pointer on a card's text block
// (name, status, timeline) and a Vitrium popover shows that room's whole day,
// the same bar as the detail page's schedule (day-bar.js). The card's own
// timeline shows the moment; this shows the day around it.
//
// Mouse-and-wide-screen only: touch has no hover (a tap opens the detail page
// anyway), and under 600px the detail page's schedule styles turn its bars
// vertical. One popover for every card, re-anchored as the pointer moves;
// cards are found by delegation, so re-rendered lists need nothing.
//
// Timing, so sweeping across a grid doesn't flash popovers: it opens after the
// pointer rests OPEN_DELAY on a card, then, while one is open (or was just
// closed, within WARM_FOR), moving to another card switches at once, like
// toolbar tooltips. Leaving closes after CLOSE_DELAY. Pressing a card closes it
// at once, out of the way of the zoom into the detail page.
import { createPopover } from 'vitrium';
import { t, getLocale } from '../i18n.js';
import { escapeHtml } from '../utils/html.js';
import { getClassroomOnDay, getBuildingOpening } from '../available-rooms-script.js';
import { DAY_START, DAY_END, dayBarHtml, dayPct, minutesToTimeDisplay } from './day-bar.js';

// What the pointer has to rest on. The whole card ('.classroom-card') or just
// the bar ('.classroom-card-timeline') work too.
const TRIGGER = '.classroom-card .classroom-card-text';

const OPEN_DELAY = 450;
const CLOSE_DELAY = 150;
const WARM_FOR = 300;

const canHover = window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 600px)');

let popover = null;
let current = null;       // the trigger it's showing for, or waiting to
let openTimer = 0;
let closeTimer = 0;
let closedAt = 0;

const dateKeyOf = (d) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

// The popover's contents for a card: the day the card stands for (its query
// date on Available results, else today), with the queried range shaded and
// a now line when it's today. Null when that day's data isn't loaded.
function contentFor(card) {
  const id = card.dataset.openClassroom;
  const from = card.dataset.queryFrom, to = card.dataset.queryTo;
  const todayKey = dateKeyOf(new Date());
  const dateKey = card.dataset.queryDate?.replace(/-/g, '') ?? todayKey;
  const entry = getClassroomOnDay(id, dateKey);
  if (!entry) return null;
  const { classroom, building } = entry;

  const { html: barHtml } = dayBarHtml({
    occupancy: classroom.occupancy,
    opening: getBuildingOpening(building, dateKey),
    query: from && to ? { from, to } : null,
  });

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowHtml = dateKey === todayKey && nowMin >= DAY_START && nowMin <= DAY_END
    ? `<div class="detail-schedule-now-line" style="--pos:${dayPct(nowMin)}%"></div>`
    : '';

  // A grid line on every hour, a label on every other one from 8:00 (the
  // last, 20:00, would hang off the bar's end)
  const ticks = [], lines = [];
  for (let m = 8 * 60; m < DAY_END; m += 60) {
    lines.push(`<div class="cdp-grid-line" style="--pos:${dayPct(m)}%"></div>`);
    if ((m / 60) % 2 === 0 && m < 20 * 60) {
      ticks.push(`<span class="cdp-tick" style="--pos:${dayPct(m)}%">${minutesToTimeDisplay(m)}</span>`);
    }
  }

  const date = new Date(+dateKey.slice(0, 4), +dateKey.slice(4, 6) - 1, +dateKey.slice(6, 8));
  const dateLabel = dateKey === todayKey
    ? t('datepicker.today')
    : date.toLocaleDateString(getLocale(), { weekday: 'long', day: 'numeric', month: 'long' });

  return `
    <div class="cdp">
      <div class="cdp-head">
        <span class="cdp-name">${escapeHtml(classroom.name)}</span>
        <span class="cdp-date">${escapeHtml(dateLabel)}</span>
      </div>
      <div class="cdp-ticks">${ticks.join('')}</div>
      <div class="cdp-bar-wrap">
        <div class="cdp-grid">${lines.join('')}</div>
        <div class="detail-schedule-bar cdp-bar">${barHtml}</div>
        ${nowHtml}
      </div>
    </div>
  `;
}

function show(trigger) {
  const html = contentFor(trigger.closest('.classroom-card'));
  if (!html) return;
  popover ??= createPopover({ placement: 'top', role: 'tooltip', deform: false, dismissable: false, offset: 10 });
  popover.el.classList.add('cdp-popover');
  popover.setContent(html);
  popover.show(trigger);
}

function hide() {
  clearTimeout(openTimer);
  clearTimeout(closeTimer);
  if (popover?.isOpen) {
    popover.hide();
    closedAt = performance.now();
  }
  current = null;
}

function enter(trigger) {
  clearTimeout(closeTimer);
  if (trigger === current) return;
  clearTimeout(openTimer);
  current = trigger;
  const warm = popover?.isOpen || performance.now() - closedAt < WARM_FOR;
  if (warm) show(trigger);
  else openTimer = setTimeout(() => { if (current === trigger) show(trigger); }, OPEN_DELAY);
}

function leave() {
  clearTimeout(openTimer);
  clearTimeout(closeTimer);
  closeTimer = setTimeout(hide, CLOSE_DELAY);
}

export function initCardDayPopover() {
  document.addEventListener('pointerover', (e) => {
    if (!canHover.matches || e.pointerType !== 'mouse') return;
    const trigger = e.target.closest?.(TRIGGER);
    if (trigger) enter(trigger);
  });
  document.addEventListener('pointerout', (e) => {
    if (!current || e.pointerType !== 'mouse') return;
    // Moving between children of the same trigger isn't leaving it
    if (current.contains(e.relatedTarget)) return;
    leave();
  });
  // A press (opening the detail page, starting a scroll) closes it at once
  document.addEventListener('pointerdown', hide, true);

  // Keyboard: a focused card previews too, after the same rest
  document.addEventListener('focusin', (e) => {
    if (!canHover.matches || !e.target.matches?.('.classroom-card:focus-visible')) return;
    const trigger = e.target.querySelector(TRIGGER.split(' ').pop());
    if (trigger) enter(trigger);
  });
  document.addEventListener('focusout', (e) => {
    if (current && e.target.contains(current)) leave();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hide(); });
}
