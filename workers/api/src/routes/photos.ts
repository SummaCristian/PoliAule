import { Hono } from "hono";
import type { Env } from "../index";
import { serveR2Image } from "../r2-image";

export const photos = new Hono<{ Bindings: Env }>();

photos.get("/:id", (c) => serveR2Image(c, c.env.DATA_BUCKET, `photos/${c.req.param("id")}.jpg`));
