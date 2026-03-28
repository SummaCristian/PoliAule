const FEATURE_ICONS = {
  4: { icon: 'videocam', label: 'Video projector' },
  5: { icon: 'mic', label: 'Radio microphone' },
  6: { icon: 'blinds', label: 'Dimmable' },
  7: { icon: 'cable', label: 'Wired desk' },
  142: { icon: 'electrical_services', label: 'Power outlets' },
  223: { icon: 'video_call', label: 'Videoconference' },
};

const STATUS_LABELS = {
  'free': 'Free',
  'partially-free': 'Partially Free',
};

// ---------- TIMELINE HELPERS ----------

function timeToMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function buildTimeline(occupancy, fromTime, toTime) {
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
    return `<div class="timeline-block ${isConflict ? 'timeline-block--busy' : 'timeline-block--context'}" style="left:${pct(s)};width:${wPct(s, e)}"></div>`;
  }).join('');

  // Time labels at every :15 mark within display range
  const offset = ((15 - (displayStart % 60)) + 60) % 60;
  const firstTick = displayStart + offset;
  const labelsHtml = [];
  for (let t = firstTick; t <= displayEnd; t += 60) {
    labelsHtml.push(`<div class="timeline-tick-label" style="left:${pct(t)}"><span>${minutesToTime(t)}</span></div>`);
  }

  const indicatorFrom = `<div class="timeline-time-indicator" style="left:${pct(fromMin)}">${fromTime}</div>`;
  const indicatorTo   = `<div class="timeline-time-indicator" style="left:${pct(toMin)}">${toTime}</div>`;

  return `
    <div class="classroom-timeline">
      <div class="timeline-bar-wrapper">
        ${indicatorFrom}
        ${indicatorTo}
        <div class="timeline-bar">
          ${queryHtml}
          ${blocksHtml}
        </div>
        <div class="timeline-ticks">${labelsHtml.join('')}</div>
      </div>
    </div>
  `;
}

// ---------- CARD ----------

// Builds and returns a Card UI element for the classroom passed as parameter
export function buildCardForClassroom(classroom, fromTime, toTime) {
  const featuresHtml = (classroom.features ?? [])
    .filter(f => FEATURE_ICONS[f.id])
    .map(f => {
      const { icon, label } = FEATURE_ICONS[f.id];
      return `<span class="material-symbols-outlined classroom-feature-icon" title="${label}">${icon}</span>`;
    })
    .join('');

  return `
    <div class="classroom-card">
      <div class="classroom-card-header">
        <h4 class="classroom-name">${classroom.name}</h4>
        <h4 class="classroom-status-txt ${classroom.status}">${STATUS_LABELS[classroom.status]}</h4>
      </div>
      ${buildTimeline(classroom.occupancy, fromTime, toTime)}
      ${featuresHtml ? `<div class="classroom-features">${featuresHtml}</div>` : ''}
    </div>
  `;
}