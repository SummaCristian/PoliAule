// Building footprints drawn behind the building cards' text (.bo-card-outline,
// building-overview.css). The paths come from OpenStreetMap via
// scripts/fetch_building_outlines.py: already normalised into a 100x100 box,
// north up, courtyards as inner rings (hence fill-rule: evenodd). Bundled,
// not fetched — footprints hardly ever change.
import outlines from '../data/building-outlines.json';

// '' when OSM had no footprint for the building; the card just goes without.
// The path is our own generated data, but it's still escaped-by-construction:
// only digits, spaces and M/L/Z ever end up in `d`.
export function buildingOutlineSvg(campusId, buildingName) {
  const entry = outlines[campusId]?.[buildingName];
  if (!entry || !/^[MLZ0-9. -]+$/.test(entry.d)) return '';
  return `<svg class="bo-card-outline" viewBox="0 0 100 100" aria-hidden="true" focusable="false">`
    + `<path d="${entry.d}" fill-rule="evenodd"/></svg>`;
}
