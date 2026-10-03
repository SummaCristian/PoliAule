// One day's occupancy bar: the inside of the detail page's schedule rows, and
// of the card's hover preview (card-day-popover.js). Builds the markup only;
// each caller wraps it in its own row and adds its own interactions (the
// detail page's hover cursor and booking popovers stay over there).
import { t } from '../i18n.js';
import { escapeHtml } from '../utils/html.js';
import { createTimeFormatter } from '../utils/time-format.js';

// The span every bar covers, in minutes since midnight
export const DAY_START = 7 * 60 + 15;
export const DAY_END = 20 * 60 + 15;
const TOTAL = DAY_END - DAY_START;

export function timeToMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTimeDisplay(minutes) {
  const d = new Date();
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return createTimeFormatter({ hour: 'numeric', minute: '2-digit' }).format(d);
}

// A time's position along the bar, as a percentage string
export const dayPct = (minutes) => ((minutes - DAY_START) / TOTAL * 100).toFixed(2);

// The bar's contents, in paint order: the hours the building is shut (hatched,
// labelled where there's room, so they don't read as bookings), the queried
// range, then each booking as a tinted glass block.
//
//   occupancy    the room's slots that day ({ inizio, fine, ... })
//   opening      getBuildingOpening()'s answer for that day (null: unknown,
//                nothing drawn)
//   query        { from, to } "HH:MM" to shade, or null
//   blockAttrs   (slot, idx) => extra attributes for a block, e.g. the detail
//                page's data-slot-idx / tabindex for its booking popovers
//   isHighlighted (slot) => true for the block to draw as the search highlight
//
// Returns { html, openAttrs }: openAttrs carries the open range for the bar
// element itself (the detail page's hover cursor reads it).
export function dayBarHtml({ occupancy, opening, query = null, blockAttrs = () => '', isHighlighted = () => false }) {
  let openFrom = DAY_START, openTo = DAY_END;
  if (opening?.closed) {
    openFrom = openTo = DAY_START;
  } else if (opening) {
    openFrom = Math.max(timeToMinutes(opening.opens), DAY_START);
    openTo = Math.min(timeToMinutes(opening.closes), DAY_END);
  }
  const closedRanges = !opening ? []
    : openFrom >= openTo
      ? [[DAY_START, DAY_END]]
      : [[DAY_START, openFrom], [openTo, DAY_END]].filter(([s, e]) => e > s);
  const closedHtml = closedRanges.map(([s, e]) => {
    const left  = dayPct(s);
    const width = ((e - s) / TOTAL * 100).toFixed(2);
    // Label only where there's room for it; the hatching still says it
    const label = (e - s) / TOTAL >= 0.15 ? `<span>${escapeHtml(t('detail.closed'))}</span>` : '';
    return `<div class="detail-schedule-closed" role="img" aria-label="${escapeHtml(t('detail.closed'))} ${minutesToTimeDisplay(s)}–${minutesToTimeDisplay(e)}" style="--block-start:${left}%;--block-size:${width}%">${label}</div>`;
  }).join('');
  const openAttrs = opening ? ` data-open-from="${openFrom}" data-open-to="${openTo}"` : '';

  let queryHtml = '';
  if (query) {
    const qFrom = Math.max(timeToMinutes(query.from), DAY_START);
    const qTo   = Math.min(timeToMinutes(query.to),   DAY_END);
    queryHtml = `<div class="detail-schedule-query-region" style="--qfrom:${dayPct(qFrom)}%;--qto:${dayPct(qTo)}%"></div>`;
  }

  const blocksHtml = (occupancy || []).map((slot, idx) => {
    if (!slot.inizio || !slot.fine) return '';
    const s = Math.max(timeToMinutes(slot.inizio), DAY_START);
    const e = Math.min(timeToMinutes(slot.fine), DAY_END);
    if (e <= s) return '';
    const left  = dayPct(s);
    const width = ((e - s) / TOTAL * 100).toFixed(2);
    const blockClass = 'detail-schedule-block lg-glass lg-glass--tinted' + (isHighlighted(slot) ? ' detail-schedule-block--highlight' : '');
    return `<div class="${blockClass}"${blockAttrs(slot, idx)} style="--block-start:${left}%;--block-size:${width}%;--idx:${idx}"></div>`;
  }).join('');

  return { html: closedHtml + queryHtml + blocksHtml, openAttrs };
}
