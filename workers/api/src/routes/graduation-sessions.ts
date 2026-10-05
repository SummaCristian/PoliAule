import { Hono } from "hono";
import type { Env } from "../index";
import { serveR2Json } from "../r2-json";

export const graduationSessions = new Hono<{ Bindings: Env }>();

graduationSessions.get("/", (c) => serveR2Json(c, c.env.DATA_BUCKET, "graduation-sessions.json"));
