import type { Context } from "hono";

/** Streams an R2 object as a JSON response, 404s if missing, and stores/serves
 * it via Cloudflare's edge cache (Cache-Control alone doesn't cache at the edge). */
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
