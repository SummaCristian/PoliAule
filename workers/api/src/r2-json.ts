import type { Context } from "hono";

// Sent to the edge cache, not the browser. Short-lived on purpose: Cloudflare's
// purge-by-URL API is not a hard guarantee (observed a purged URL still served
// stale from an edge node hours later), so this TTL — not the purge call — is
// what actually bounds staleness. The GitHub Actions workflows still purge on
// every write, which makes refreshes feel instant in the common case, but
// correctness no longer depends on that purge succeeding or propagating.
const EDGE_CACHE_CONTROL = "public, max-age=180";

// Sent to the browser: never serve a locally cached copy without asking the
// edge again. We do NOT use conditional requests (ETag/If-None-Match) here:
// cross-origin fetch()'s handling of 304 revalidation has proven inconsistent
// across real browsers (reproduced on desktop Firefox and Safari mobile as
// broken/stale loads), so every browser request always gets a full body back.
// The edge cache above is what keeps this cheap.
const BROWSER_CACHE_CONTROL = "no-store";

/** Serves an R2 object as JSON, 404s if missing. */
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

  return new Response(await edgeCached.clone().arrayBuffer(), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": BROWSER_CACHE_CONTROL,
      "Last-Modified": edgeCached.headers.get("Last-Modified") ?? "",
    },
  });
}
