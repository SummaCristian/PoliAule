import { Hono } from "hono";
import type { Env } from "../index";
import { serveR2Image } from "../r2-image";

// Easter-egg images, uploaded to R2 by hand under `eggs/<name>` (no extension:
// served as whatever --content-type they were uploaded with) so they never
// enter the git history. Deliberately left out of docs/api.md.
export const eggs = new Hono<{ Bindings: Env }>();

eggs.get("/:name", (c) => serveR2Image(c, c.env.DATA_BUCKET, `eggs/${c.req.param("name")}`));
