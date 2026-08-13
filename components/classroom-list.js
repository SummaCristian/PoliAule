import { t } from '../i18n.js';
import { escapeHtml } from '../utils/html.js';
import { createTimeFormatter } from '../utils/time-format.js';
import { fetchPhotoUrl } from '../utils/photo.js';

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

// Update the "now" position on all visible list-timeline now indicators every minute.
setInterval(() => {
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  document.querySelectorAll('.timeline-time-indicator--now[data-now-start]').forEach(el => {
    const start = +el.dataset.nowStart;
    const tot   = +el.dataset.nowTotal;
    const inRange = nowMin > start && nowMin < start + tot;
    el.hidden = !inRange;
    if (inRange) {
      const fraction = (nowMin - start) / tot;
      el.style.left = `${(fraction * 100).toFixed(2)}%`;
      el.classList.toggle('timeline-time-indicator--edge-left', fraction < 0.07);
      el.classList.toggle('timeline-time-indicator--edge-right', fraction > 0.93);
    }
  });
}, 60_000);

function buildTimeline(occupancy, fromTime, toTime, isToday = false) {
  const fromMin = timeToMinutes(fromTime);
  const toMin = timeToMinutes(toTime);

  // Display 1 hour of context on each side
  const displayStart = fromMin - 60;
  const displayEnd = toMin + 60;
  const total = displayEnd - displayStart;

  const pct = m => `${((m - displayStart) / total * 100).toFixed(2)}%`;
  const wPct = (s, e) => `${((Math.min(e, displayEnd) - Math.max(s, displayStart)) / total * 100).toFixed(2)}%`;
  const fraction = m => (m - displayStart) / total;
  const edgeClassFor = m => {
    const f = fraction(m);
    if (f < 0.07) return ' timeline-time-indicator--edge-left';
    if (f > 0.93) return ' timeline-time-indicator--edge-right';
    return '';
  };

  // Query region highlight
  const queryHtml = `<div class="timeline-query-region" style="left:${pct(fromMin)};width:${wPct(fromMin, toMin)}"></div>`;

  // Generate blocks only for occupations
  const blocksHtml = (occupancy ?? []).map(slot => {
    const s = timeToMinutes(slot.inizio);
    const e = timeToMinutes(slot.fine);
    
    // Clip to display range
    const clipS = Math.max(s, displayStart);
    const clipE = Math.min(e, displayEnd);
    
    if (clipE <= clipS) return '';

    // A block is "query" if it intersects the query range
    // but for the visual "on top" effect, we might want to split it 
    // if it spans across the query boundary. 
    // However, to keep it simple and clean, let's just render the clipped block
    // and let CSS handle the styling if we can.
    // Actually, splitting is better for the "dashed context" vs "solid query" look.
    
    const segments = [];
    
    // Segment 1: before query
    if (clipS < fromMin) {
      const end = Math.min(clipE, fromMin);
      if (end > clipS) segments.push({ s: clipS, e: end, scope: 'context' });
    }
    
    // Segment 2: inside query
    if (clipE > fromMin && clipS < toMin) {
      const start = Math.max(clipS, fromMin);
      const end = Math.min(clipE, toMin);
      if (end > start) segments.push({ s: start, e: end, scope: 'query' });
    }
    
    // Segment 3: after query
    if (clipE > toMin) {
      const start = Math.max(clipS, toMin);
      if (clipE > start) segments.push({ s: start, e: clipE, scope: 'context' });
    }

    return segments.map((seg, i) => {
      const isFirst = i === 0;
      const isLast = i === segments.length - 1;
      const classes = ['timeline-block', 'timeline-block--busy', `timeline-block--${seg.scope}`];
      if (!isFirst) classes.push('timeline-block--seamless-left');
      if (!isLast) classes.push('timeline-block--seamless-right');
      return `<div class="${classes.join(' ')}" style="left:${pct(seg.s)};width:${wPct(seg.s, seg.e)}"></div>`;
    }).join('');
  }).join('');

  // Pick a tick interval that yields ~4–6 labels across the display range
  const niceDivisions = [15, 20, 30, 45, 60, 90, 120, 180, 240];
  const tickInterval = niceDivisions.find(d => d >= total / 5) ?? 240;

  // Generate candidates at HH:15 marks (one per hour), plus occupation boundaries
  const candidateTimes = new Set();
  // Filter boundaries to only those that were in the original occupancy for tick marks
  for (const slot of (occupancy ?? [])) {
    const s = timeToMinutes(slot.inizio);
    const e = timeToMinutes(slot.fine);
    if (s > displayStart && s < displayEnd) candidateTimes.add(s);
    if (e > displayStart && e < displayEnd) candidateTimes.add(e);
  }
  const firstMark = Math.ceil((displayStart - 15) / 60) * 60 + 15;
  for (let t = firstMark; t <= displayEnd; t += 60) {
    candidateTimes.add(t);
  }

  // Sort and enforce minimum spacing to prevent label overlap
  const minSpacing = Math.round(tickInterval * 0.75);
  const edgeMargin = 20;
  const labelsHtml = [];
  let lastAdded = -Infinity;
  for (const t of [...candidateTimes].sort((a, b) => a - b)) {
    if (t - displayStart >= edgeMargin && displayEnd - t >= edgeMargin && t - lastAdded >= minSpacing) {
      labelsHtml.push(`<div class="timeline-tick-label" style="left:${pct(t)}"><span data-time-minutes="${t}">${minutesToTimeDisplay(t)}</span></div>`);
      lastAdded = t;
    }
  }

  const indicatorFrom = `<div class="timeline-time-indicator${edgeClassFor(fromMin)}" data-time-minutes="${fromMin}" style="left:${pct(fromMin)}">${minutesToTimeDisplay(fromMin)}</div>`;
  const indicatorTo   = `<div class="timeline-time-indicator${edgeClassFor(toMin)}" data-time-minutes="${toMin}" style="left:${pct(toMin)}">${minutesToTimeDisplay(toMin)}</div>`;

  let indicatorNow = '';
  if (isToday) {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    if (nowMin > displayStart && nowMin < displayEnd) {
      indicatorNow = `<div class="timeline-time-indicator timeline-time-indicator--now${edgeClassFor(nowMin)}" data-now-start="${displayStart}" data-now-total="${total}" style="left:${pct(nowMin)}">${t('timepicker.now')}</div>`;
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

// ---------- PHOTO ----------

async function _loadCardPhoto(classroomId, card) {
  const img = card.querySelector('.classroom-card-photo');
  const url = await fetchPhotoUrl(classroomId);
  card.style.setProperty('--card-photo-url', `url("${url}")`);
  img.onerror = () => card.classList.add('photo-failed');
  img.src = url;
  img.decode().then(() => img.classList.add('loaded')).catch(() => card.classList.add('photo-failed'));
}

const _photoObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    _photoObserver.unobserve(entry.target);
    if (entry.target.dataset.idfoto) _loadCardPhoto(entry.target.dataset.openClassroom, entry.target);
  }
}, { rootMargin: '300px' });

// ---------- CARD ----------

// Builds and returns a Card DOM element for the classroom passed as parameter
export function buildCardForClassroom(classroom, building, fromTime, toTime, isToday = false, date = null) {
  const featuresHtml = (classroom.features ?? [])
    .filter(f => FEATURE_ICONS[f.id])
    .map(f => {
      const { icon, key } = FEATURE_ICONS[f.id];
      return `<span class="material-symbols-outlined classroom-feature-icon" data-feature-id="${f.id}" data-tooltip="${t(key)}">${icon}</span>`;
    })
    .join('');

  const statusLabel = classroom.status === 'free' ? t('status.free') : t('status.partiallyFree');
  const timelineHtml = buildTimeline(classroom.occupancy, fromTime, toTime, isToday);

  const el = document.createElement('div');
  el.dataset.openClassroom = classroom.id;
  el.dataset.queryFrom = fromTime;
  el.dataset.queryTo = toTime;
  if (date) el.dataset.queryDate = date;
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  el.setAttribute('aria-label', `View details for ${escapeHtml(classroom.name)}`);

  if (classroom.idfoto) {
    el.className = 'classroom-card classroom-card--with-photo';
    el.dataset.idfoto = classroom.idfoto;
    el.innerHTML = `
      <img class="classroom-card-photo" alt="">
      <div class="classroom-card-overlay"></div>
      <div class="classroom-card-content">
        <div class="classroom-card-header">
          <div class="classroom-card-header-left">
            <h4 class="classroom-name" title="${escapeHtml(classroom.name)}">${escapeHtml(classroom.name)}</h4>
          </div>
          <div class="classroom-detail-btn">
            <span class="material-symbols-outlined">chevron_right</span>
          </div>
        </div>
        ${timelineHtml}
        <div class="classroom-card-meta-row">
          <h4 class="classroom-status-txt ${classroom.status}">${statusLabel}</h4>
          ${featuresHtml ? `<div class="classroom-features">${featuresHtml}</div>` : ''}
        </div>
      </div>
    `;
    _photoObserver.observe(el);
  } else {
    el.className = 'classroom-card';
    el.innerHTML = `
      <div class="classroom-card-header">
        <div class="classroom-card-header-left">
          <h4 class="classroom-name" title="${escapeHtml(classroom.name)}">${escapeHtml(classroom.name)}</h4>
        </div>
        <div class="classroom-detail-btn">
          <span class="material-symbols-outlined">chevron_right</span>
        </div>
      </div>
      ${timelineHtml}
      <div class="classroom-card-meta-row">
        <h4 class="classroom-status-txt ${classroom.status}">${statusLabel}</h4>
        ${featuresHtml ? `<div class="classroom-features">${featuresHtml}</div>` : ''}
      </div>
    `;
  }

  return el;
}
