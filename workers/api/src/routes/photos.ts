import { Hono } from "hono";
import type { Env } from "../index";
import { serveR2Image } from "../r2-image";

export const photos = new Hono<{ Bindings: Env }>();

photos.get("/:id", (c) => serveR2Image(c, c.env.DATA_BUCKET, `photos/${c.req.param("id")}.jpg`));

// The small copy fetch_photos.py writes next to each photo (640px on its long
// side). Falls back to the full photo while a room has none yet.
photos.get("/:id/thumb", (c) => {
  const id = c.req.param("id");
  return serveR2Image(c, c.env.DATA_BUCKET, `photos/${id}_thumb.jpg`, `photos/${id}.jpg`);
});
