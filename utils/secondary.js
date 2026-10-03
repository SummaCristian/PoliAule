import { classroomsData as directory } from '../classroom-search-data.js';

// The static directory's (/v1/classrooms) two "not really a place to study"
// markers:
//   - `secondary: true` on a campus or building: nothing to book there (no
//     classrooms, or only events-only ones). Drawn smaller on the map, hidden
//     from the Campus sheet's building grid unless asked for, and left out of
//     the Available tab entirely.
//   - `eventsOnly: true` on a classroom: generally closed outside of official
//     events. Left out of the Available tab; its detail page warns about it.
// Read from the directory rather than the occupation files, so the Available
// tab honours them whatever occupation data it was handed.

const indexes = new WeakMap();

function index() {
  if (!directory) return null;
  let idx = indexes.get(directory);
  if (!idx) {
    idx = { campuses: new Set(), buildings: new Set(), rooms: new Set() };
    for (const campus of directory) {
      if (campus.secondary) idx.campuses.add(campus.id);
      for (const building of campus.buildings ?? []) {
        if (building.secondary) idx.buildings.add(`${campus.id}:${building.name}`);
        for (const room of building.classrooms ?? []) {
          if (room.eventsOnly) idx.rooms.add(room.id);
        }
      }
    }
    indexes.set(directory, idx);
  }
  return idx;
}

export function isSecondaryCampus(campusId) {
  return index()?.campuses.has(campusId) ?? false;
}

export function isSecondaryBuilding(campusId, buildingName) {
  return index()?.buildings.has(`${campusId}:${buildingName}`) ?? false;
}

export function isEventsOnly(classroomId) {
  return index()?.rooms.has(classroomId) ?? false;
}

// The rooms of `building` the Available tab works with: none for a secondary
// building, and never an events-only room.
export function availableTabRooms(campusId, building) {
  if (isSecondaryCampus(campusId) || isSecondaryBuilding(campusId, building.name)) return [];
  return (building.classrooms ?? []).filter(room => !isEventsOnly(room.id));
}
