import { Hono } from "hono";
import type { Env } from "../index";
import { serveR2Json } from "../r2-json";

export const classrooms = new Hono<{ Bindings: Env }>();

classrooms.get("/", (c) => serveR2Json(c, c.env.DATA_BUCKET, "classrooms.json", "public, max-age=3600"));
