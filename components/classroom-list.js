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

// Builds and returns a Card UI element for the classroom passed as parameter
export function buildCardForClassroom(classroom) {
  const slotsHtml = classroom.slots
    .map(slot => `
      <span class="classroom-slot-chip">
        <span class="material-symbols-outlined classroom-slot-icon">schedule</span>
        ${slot.start} – ${slot.end}
      </span>
    `)
    .join('');

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
      <div class="classroom-slots">${slotsHtml}</div>
      ${featuresHtml ? `<div class="classroom-features">${featuresHtml}</div>` : ''}
    </div>
  `;
}