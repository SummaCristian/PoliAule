import type { Context } from "hono";

// Sent to the edge cache, not the browser: long-lived, since the GitHub Actions
// workflows explicitly purge affected URLs on every write. This is a backstop
// in case a purge is ever missed, not the primary freshness mechanism.
const EDGE_CACHE_CONTROL = "public, max-age=86400";

// Sent to the browser: always revalidate before using a cached copy, so a
// stale local response can never linger silently. Paired with ETag below,
// an unchanged response comes back as a cheap 304 instead of a full refetch.
const BROWSER_CACHE_CONTROL = "no-cache";

/** Serves an R2 object as JSON, 404s if missing, 304s on a matching ETag. */
export async function serveR2Json(c: Context, bucket: R2Bucket, key: string) {
  const cache = caches.default;
  const cacheKey = new Request(c.req.url, c.req.raw);

  let edgeCached = await cache.match(cacheKey);
  if (!edgeCached) {
    const obj = await bucket.get(key);
    if (!obj) return c.json({ error: `Not found: ${key}` }, 404);

    edgeCached = new Response(await obj.arrayBuffer(), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": EDGE_CACHE_CONTROL,
        "ETag": obj.httpEtag,
        "Last-Modified": obj.uploaded.toUTCString(),
      },
    });
    c.executionCtx.waitUntil(cache.put(cacheKey, edgeCached.clone()));
  }

  const etag = edgeCached.headers.get("ETag");
  const ifNoneMatch = c.req.header("If-None-Match");
  if (etag && ifNoneMatch === etag) {
    return new Response(null, { status: 304, headers: { "ETag": etag, "Cache-Control": BROWSER_CACHE_CONTROL } });
  }

  return new Response(await edgeCached.clone().arrayBuffer(), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": BROWSER_CACHE_CONTROL,
      "ETag": etag ?? "",
      "Last-Modified": edgeCached.headers.get("Last-Modified") ?? "",
    },
  });
}
