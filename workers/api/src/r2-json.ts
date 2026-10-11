import type { Context } from "hono";

// Sent to the edge cache, not the browser. Short-lived on purpose: Cloudflare's
// purge-by-URL API is not a hard guarantee (observed a purged URL still served
// stale from an edge node hours later), so this TTL — not the purge call — is
// what actually bounds staleness. The GitHub Actions workflows still purge on
// every write, which makes refreshes feel instant in the common case, but
// correctness no longer depends on that purge succeeding or propagating.
const EDGE_CACHE_CONTROL = "public, max-age=180";

// Sent to the browser: keep its HTTP cache out of the picture entirely. The
// frontend keeps its own copy (Cache Storage, see available-rooms-script.js)
// and revalidates it by sending If-None-Match itself, which this answers with
// a 304 when the ETag still matches.
const BROWSER_CACHE_CONTROL = "no-store";

// Cloudflare weakens a strong ETag (W/"...") when it compresses the response,
// so the client may echo either form back: compare them weakly.
const opaqueTag = (tag: string) => tag.trim().replace(/^W\//, "");

function matchesIfNoneMatch(header: string | undefined, etag: string) {
  if (!header) return false;
  if (header.trim() === "*") return true;
  const target = opaqueTag(etag);
  return header.split(",").some((tag) => opaqueTag(tag) === target);
}

/** Serves an R2 object as JSON, 404s if missing, 304s on a matching If-None-Match. */
export async function serveR2Json(c: Context, bucket: R2Bucket, key: string) {
  const cache = caches.default;
  // Keyed by the URL alone. Passing the incoming request would carry its
  // If-None-Match into cache.match(), which honours it and hands back a
  // bodiless 304: re-wrapped as a 200 below, that was an empty JSON body.
  const cacheKey = new Request(c.req.url);

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

  const etag = edgeCached.headers.get("ETag") ?? "";
  const lastModified = edgeCached.headers.get("Last-Modified") ?? "";
  if (etag && matchesIfNoneMatch(c.req.header("If-None-Match"), etag)) {
    return new Response(null, {
      status: 304,
      headers: { "Cache-Control": BROWSER_CACHE_CONTROL, "ETag": etag, "Last-Modified": lastModified },
    });
  }

  return new Response(await edgeCached.clone().arrayBuffer(), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": BROWSER_CACHE_CONTROL,
      "ETag": etag,
      "Last-Modified": lastModified,
    },
  });
}
