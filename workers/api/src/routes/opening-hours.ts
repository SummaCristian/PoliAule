import { Hono } from "hono";
import type { Env } from "../index";
import { serveR2Json } from "../r2-json";

export const openingHours = new Hono<{ Bindings: Env }>();

// Scraped weekly, so cache aggressively, same rationale as classrooms.
openingHours.get("/", (c) => serveR2Json(c, c.env.DATA_BUCKET, "opening-hours.json", "public, max-age=3600"));
