import { Hono } from "hono";
import type { Env } from "../index";
import { serveR2Json } from "../r2-json";

export const openingHours = new Hono<{ Bindings: Env }>();

openingHours.get("/", (c) => serveR2Json(c, c.env.DATA_BUCKET, "opening-hours.json", "public, max-age=3600"));
