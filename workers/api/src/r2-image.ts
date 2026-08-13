import type { Context } from "hono";

// Photos are fetched (and their manifest hash-compared) once a month by
// fetch_photos.py, so — unlike the JSON endpoints in r2-json.ts — staleness
// for weeks is harmless. Both edge and browser get the same long, cacheable
// response; the workflow purges the edge cache for changed ids on upload.
const CACHE_CONTROL = "public, max-age=2592000, immutable"; // 30 days

/** Serves an R2 object as a JPEG image, 404s if missing. */
export async function serveR2Image(c: Context, bucket: R2Bucket, key: string) {
  const cache = caches.default;
  const cacheKey = new Request(c.req.url, c.req.raw);

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const obj = await bucket.get(key);
  if (!obj) return c.json({ error: `Not found: ${key}` }, 404);

  const response = new Response(await obj.arrayBuffer(), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": CACHE_CONTROL,
      "ETag": obj.httpEtag,
      "Last-Modified": obj.uploaded.toUTCString(),
    },
  });
  c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));

  return response;
}
