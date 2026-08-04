import type { Context } from "hono";

/** Streams an R2 object straight through as a JSON response, or 404s if missing.
 * `cacheControl` mirrors docs/api.md's current caching guidance per endpoint.
 *
 * Also stores the response in Cloudflare's edge cache (the Cache-Control header
 * alone only advises downstream clients; it does not cache anything at the edge
 * by itself). Repeat requests for the same URL are served straight from cache
 * without touching R2, which keeps R2 read volume roughly independent of how
 * much traffic the API gets.
 */
export async function serveR2Json(c: Context, bucket: R2Bucket, key: string, cacheControl: string) {
  const cache = caches.default;
  const cacheKey = new Request(c.req.url, c.req.raw);

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const obj = await bucket.get(key);
  if (!obj) return c.json({ error: `Not found: ${key}` }, 404);

  const response = new Response(obj.body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": cacheControl,
      "Last-Modified": obj.uploaded.toUTCString(),
    },
  });

  c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}
