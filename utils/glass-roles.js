// The app's own glass panels as a Vitrium glass role: they read their blur as
// --lg-material-blur-<size> (right for the glass style in force where each one
// is, so the sections and frames that force `frost` keep it) the way Vitrium's
// surfaces do. It is the `surface` role's values; a role of our own rather than
// `surface` because that one can't be given more selectors, and most of these
// are built in many places (JS, Mapbox's controls, pseudo-elements) where an
// attribute on each would be easy to miss. Importing the module defines it.
import { defineGlassRole } from 'vitrium';

const SIZES = ['sm', 'md', 'lg', 'clear'];
const by = (make) => Object.fromEntries(SIZES.map((s) => [`blur-${s}`, make(s)]));

defineGlassRole('panel', {
  slots: by(() => 'blur'),
  styles: {
    frost: by((s) => `var(--lg-blur-${s}-frost)`),
    transparent: by(() => 'var(--lg-blur-transparent)'),
    curated: 'frost',
  },
  selector: [
    '.detail-back-btn', '.detail-status-wrapper', '.detail-stat', '.detail-title',
    '.detail-section', '.detail-feature-chip', '.detail-events-only', '.detail-schedule-labels-pill',
    '.bo-title', '.bo-close', '.bo-card-frost', '.building-section-titles', '.campus-sheet-star',
    '.campus-map .mapboxgl-ctrl-attrib.mapboxgl-compact-show', '.campus-map .mapboxgl-ctrl-attrib-button',
    '.campus-map .mapboxgl-ctrl-group button', '.map-pin__plate',
    '.info-section', '.info-badge', '.settings-group', '.kb-help-panel',
    '.search-bar-wrapper', '.search-overlay-close', '.search-results-frame',
    '.nf-caption', '.nf-room-card', '.nfc-did',
  ].join(', '),
});
