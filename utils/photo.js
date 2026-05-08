const PHOTO_API = 'https://onlineservices.polimi.it/maps_rest/rest/syncro/rooms/foto';

// idfoto (number) → resolved URL string, or 'error'
export const photoUrlCache = new Map();

export async function fetchPhotoUrl(idfoto) {
  if (photoUrlCache.has(idfoto)) return photoUrlCache.get(idfoto);

  try {
    const resp = await fetch(`${PHOTO_API}/${idfoto}`, { credentials: 'omit' });
    if (!resp.ok) throw new Error(`${resp.status}`);
    const text = await resp.text();
    const url = text.match(/https?:\/\/\S+/)?.[0];
    if (!url) throw new Error('No URL in response');

    const parsed = new URL(url);
    if (parsed.hostname !== 'docmanager.polimi.it' || parsed.protocol !== 'https:') {
      throw new Error(`Untrusted host: ${parsed.hostname}`);
    }

    photoUrlCache.set(idfoto, url);
    return url;
  } catch (err) {
    console.error('Photo URL fetch error:', err);
    photoUrlCache.set(idfoto, 'error');
    return 'error';
  }
}
