import type { Context } from "hono";

// Photos are fetched (and their manifest hash-compared) once a month by
// fetch_photos.py, so — unlike the JSON endpoints in r2-json.ts — staleness
// for weeks is harmless. Both edge and browser get the same long, cacheable
// response; the workflow purges the edge cache for changed ids on upload.
const CACHE_CONTROL = "public, max-age=2592000, immutable"; // 30 days
// A stand-in (see fallbackKey) is only right until the real object is uploaded,
// so it must not stick around for a month in browsers the purge can't reach.
const FALLBACK_CACHE_CONTROL = "public, max-age=3600"; // 1 hour

/**
 * Serves an R2 object as an image, 404s if missing. With `fallbackKey`, a
 * missing object is answered with that one instead (a thumbnail not generated
 * yet, say, gets the full photo), briefly cached.
 */
export async function serveR2Image(c: Context, bucket: R2Bucket, key: string, fallbackKey?: string) {
  const cache = caches.default;
  const cacheKey = new Request(c.req.url, c.req.raw);

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let obj = await bucket.get(key);
  let cacheControl = CACHE_CONTROL;
  if (!obj && fallbackKey) {
    obj = await bucket.get(fallbackKey);
    cacheControl = FALLBACK_CACHE_CONTROL;
  }
  if (!obj) return c.json({ error: `Not found: ${key}` }, 404);

  const response = new Response(await obj.arrayBuffer(), {
    headers: {
      // What the object was uploaded as (photos are all JPEGs; eggs may not be)
      "Content-Type": obj.httpMetadata?.contentType ?? "image/jpeg",
      "Cache-Control": cacheControl,
      "ETag": obj.httpEtag,
      "Last-Modified": obj.uploaded.toUTCString(),
    },
  });
  c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));

  return response;
}
