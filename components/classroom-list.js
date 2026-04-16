import { t } from '../i18n.js';
import { createTimeFormatter } from '../utils/time-format.js';

const FEATURE_ICONS = {
  4: { icon: 'videocam', key: 'features.videoProjector' },
  5: { icon: 'mic', key: 'features.radioMic' },
  6: { icon: 'blinds', key: 'features.dimmable' },
  7: { icon: 'cable', key: 'features.wiredDesk' },
  142: { icon: 'electrical_services', key: 'features.powerOutlets' },
  223: { icon: 'video_call', key: 'features.videoconf' },
};

// ---------- TIMELINE HELPERS ----------

function timeToMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}


function minutesToTimeDisplay(minutes) {
  const d = new Date();
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return createTimeFormatter({ hour: 'numeric', minute: '2-digit' }).format(d);
}

// Re-format all rendered timeline labels when the user changes the time format setting.
window.addEventListener('timeformatchange', () => {
  document.querySelectorAll('[data-time-minutes]').forEach(el => {
    el.textContent = minutesToTimeDisplay(+el.dataset.timeMinutes);
  });
});

function buildTimeline(occupancy, fromTime, toTime, isToday = false) {
  const fromMin = timeToMinutes(fromTime);
  const toMin = timeToMinutes(toTime);

  // Display 1 hour of context on each side
  const displayStart = fromMin - 60;
  const displayEnd = toMin + 60;
  const total = displayEnd - displayStart;

  const pct = m => `${((m - displayStart) / total * 100).toFixed(2)}%`;
  const wPct = (s, e) => `${((Math.min(e, displayEnd) - Math.max(s, displayStart)) / total * 100).toFixed(2)}%`;

  // Query region highlight
  const queryHtml = `<div class="timeline-query-region" style="left:${pct(fromMin)};width:${wPct(fromMin, toMin)}"></div>`;

  // Occupied blocks clipped to display range
  const blocksHtml = (occupancy ?? []).map(slot => {
    const s = Math.max(timeToMinutes(slot.inizio), displayStart);
    const e = Math.min(timeToMinutes(slot.fine), displayEnd);
    if (e <= s) return '';
    const isConflict = s < toMin && e > fromMin;
    return `<div class="timeline-block ${isConflict ? 'timeline-block--busy' : 'timeline-block--context'}" style="left:calc(${pct(s)} + 2px);width:calc(${wPct(s, e)} - 4px)"></div>`;
  }).join('');

  // Collect occupation boundary times within the display range
  const rawBoundaries = [];
  for (const slot of (occupancy ?? [])) {
    const s = timeToMinutes(slot.inizio);
    const e = timeToMinutes(slot.fine);
    if (s > displayStart && s < displayEnd) rawBoundaries.push(s);
    if (e > displayStart && e < displayEnd) rawBoundaries.push(e);
  }
  const boundaries = [...new Set(rawBoundaries)].sort((a, b) => a - b);

  // Pick a tick interval that yields ~4–6 labels across the display range
  const niceDivisions = [15, 20, 30, 45, 60, 90, 120, 180, 240];
  const tickInterval = niceDivisions.find(d => d >= total / 5) ?? 240;

  // Generate candidates at HH:15 marks (one per hour), plus occupation boundaries
  const candidateTimes = new Set(boundaries);
  const firstMark = Math.ceil((displayStart - 15) / 60) * 60 + 15;
  for (let t = firstMark; t <= displayEnd; t += 60) {
    candidateTimes.add(t);
  }

  // Sort and enforce minimum spacing to prevent label overlap
  const minSpacing = Math.round(tickInterval * 0.75);
  const labelsHtml = [];
  let lastAdded = -Infinity;
  for (const t of [...candidateTimes].sort((a, b) => a - b)) {
    if (t - lastAdded >= minSpacing) {
      labelsHtml.push(`<div class="timeline-tick-label" style="left:${pct(t)}"><span data-time-minutes="${t}">${minutesToTimeDisplay(t)}</span></div>`);
      lastAdded = t;
    }
  }

  const indicatorFrom = `<div class="timeline-time-indicator" data-time-minutes="${fromMin}" style="left:${pct(fromMin)}">${minutesToTimeDisplay(fromMin)}</div>`;
  const indicatorTo   = `<div class="timeline-time-indicator" data-time-minutes="${toMin}" style="left:${pct(toMin)}">${minutesToTimeDisplay(toMin)}</div>`;

  let indicatorNow = '';
  if (isToday) {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    if (nowMin > displayStart && nowMin < displayEnd) {
      indicatorNow = `<div class="timeline-time-indicator timeline-time-indicator--now" style="left:${pct(nowMin)}">${t('timepicker.now')}</div>`;
    }
  }

  return `
    <div class="classroom-timeline" data-display-start="${displayStart}" data-display-end="${displayEnd}">
      <div class="timeline-bar-wrapper">
        ${indicatorFrom}
        ${indicatorTo}
        ${indicatorNow}
        <div class="timeline-hover-cursor" hidden></div>
        <div class="timeline-bar">
          ${queryHtml}
          ${blocksHtml}
          <div class="timeline-hover-line" hidden></div>
        </div>
        <div class="timeline-ticks">${labelsHtml.join('')}</div>
      </div>
    </div>
  `;
}

// ---------- TIMELINE HOVER ----------

let _activeBar = null;

document.addEventListener('mousemove', e => {
  const bar = e.target.closest?.('.timeline-bar');

  if (_activeBar && _activeBar !== bar) {
    const wrapper = _activeBar.closest('.timeline-bar-wrapper');
    if (wrapper) wrapper.querySelector('.timeline-hover-cursor').hidden = true;
    _activeBar.querySelector('.timeline-hover-line').hidden = true;
    _activeBar = null;
  }

  if (!bar) return;
  _activeBar = bar;

  const wrapper = bar.closest('.timeline-bar-wrapper');
  const cursor = wrapper?.querySelector('.timeline-hover-cursor');
  const line = bar.querySelector('.timeline-hover-line');
  const timeline = bar.closest('.classroom-timeline');
  if (!cursor || !line || !timeline) return;

  const displayStart = +timeline.dataset.displayStart;
  const displayEnd = +timeline.dataset.displayEnd;

  const rect = bar.getBoundingClientRect();
  const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const minutes = Math.round(displayStart + fraction * (displayEnd - displayStart));
  const pct = `${(fraction * 100).toFixed(2)}%`;

  cursor.style.left = pct;
  cursor.textContent = minutesToTimeDisplay(minutes);
  cursor.hidden = false;

  line.style.left = pct;
  line.hidden = false;
});

// ---------- CARD ----------

// Builds and returns a Card UI element for the classroom passed as parameter
export function buildCardForClassroom(classroom, building, fromTime, toTime, isToday = false) {
  const featuresHtml = (classroom.features ?? [])
    .filter(f => FEATURE_ICONS[f.id])
    .map(f => {
      const { icon, key } = FEATURE_ICONS[f.id];
      return `<span class="material-symbols-outlined classroom-feature-icon" title="${t(key)}">${icon}</span>`;
    })
    .join('');

  const buildingDisplay = building.altName ? `${building.altName} (${building.name})` : building.name;

  return `
    <div class="classroom-card" data-open-classroom="${classroom.id}" role="button" tabindex="0" aria-label="View details for ${classroom.name}">
      <div class="classroom-card-header">
        <div class="classroom-card-header-left">
          <h4 class="classroom-name" title="${classroom.name}">${classroom.name}</h4>
          <h4 class="classroom-status-txt ${classroom.status}">${classroom.status === 'free' ? t('status.free') : t('status.partiallyFree')}</h4>
        </div>
        <div class="classroom-detail-btn">
          <span class="material-symbols-outlined">chevron_right</span>
        </div>
      </div>
      ${buildTimeline(classroom.occupancy, fromTime, toTime, isToday)}
      ${featuresHtml ? `<div class="classroom-features">${featuresHtml}</div>` : ''}
    </div>
  `;
}