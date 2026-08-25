import { getApiBase } from '../config.js';

// classroom id (number) → resolved URL string
export const photoUrlCache = new Map();

export async function fetchPhotoUrl(classroomId) {
  if (photoUrlCache.has(classroomId)) return photoUrlCache.get(classroomId);

  const url = `${getApiBase()}/v1/photos/${classroomId}`;
  photoUrlCache.set(classroomId, url);
  return url;
}
