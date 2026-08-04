import type { Context } from "hono";

/** Streams an R2 object straight through as a JSON response, or 404s if missing.
 * `cacheControl` mirrors docs/api.md's current caching guidance per endpoint. */
export async function serveR2Json(c: Context, bucket: R2Bucket, key: string, cacheControl: string) {
  const obj = await bucket.get(key);
  if (!obj) return c.json({ error: `Not found: ${key}` }, 404);
  return new Response(obj.body, {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": cacheControl,
      "Last-Modified": obj.uploaded.toUTCString(),
    },
  });
}
