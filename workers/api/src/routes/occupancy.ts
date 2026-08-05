import { Hono } from "hono";
import type { Env } from "../index";
import { serveR2Json } from "../r2-json";

export const occupancy = new Hono<{ Bindings: Env }>();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

occupancy.get("/", (c) => serveR2Json(c, c.env.DATA_BUCKET, "occupancy/list.json"));

// :date is ISO (YYYY-MM-DD), mapped to the compact YYYYMMDD R2 key internally.
occupancy.get("/:date", (c) => {
  const date = c.req.param("date");
  if (!DATE_RE.test(date)) return c.json({ error: "date must be in YYYY-MM-DD format" }, 400);
  const compact = date.replaceAll("-", "");
  return serveR2Json(c, c.env.DATA_BUCKET, `occupancy/occupation_${compact}.json`);
});
