import { API_BASE } from '../config.js';

// classroom id (number) → resolved URL string
export const photoUrlCache = new Map();

export async function fetchPhotoUrl(classroomId) {
  if (photoUrlCache.has(classroomId)) return photoUrlCache.get(classroomId);

  const url = `${API_BASE}/v1/photos/${classroomId}`;
  photoUrlCache.set(classroomId, url);
  return url;
}
