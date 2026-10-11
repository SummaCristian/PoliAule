import { Hono } from "hono";
import { cors } from "hono/cors";
import { classrooms } from "./routes/classrooms";
import { openingHours } from "./routes/opening-hours";
import { graduationSessions } from "./routes/graduation-sessions";
import { occupancy } from "./routes/occupancy";
import { photos } from "./routes/photos";
import { config } from "./routes/config";
import { eggs } from "./routes/eggs";

export interface Env {
  DATA_BUCKET: R2Bucket;
  // URL-restricted Mapbox public token, set via `wrangler secret put MAPBOX_TOKEN`
  // (per environment). Served to the frontend by GET /v1/config.
  MAPBOX_TOKEN: string;
}

const app = new Hono<{ Bindings: Env }>();

// The API only ever answers with JSON or images, never a page: tell browsers not
// to sniff a type out of the body, and that if one ever does render a response
// as a document it may load nothing and can't be framed. Deliberately no
// Cross-Origin-Resource-Policy: the API is public, and the frontend and third
// parties read it cross-origin. Rebuilds the response because the ones coming
// out of the edge cache have immutable headers.
app.use("*", async (c, next) => {
  await next();
  const headers = new Headers(c.res.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  headers.set("Referrer-Policy", "no-referrer");
  c.res = new Response(c.res.body, { status: c.res.status, statusText: c.res.statusText, headers });
});

// ETag is exposed so the frontend can store it and revalidate with If-None-Match.
// That header makes those requests preflighted; maxAge lets browsers reuse the
// preflight (each caps it: Chrome at 2 h, Firefox at 24 h).
app.use("*", cors({ exposeHeaders: ["ETag"], maxAge: 86400 }));

app.route("/v1/config", config);
app.route("/v1/classrooms", classrooms);
app.route("/v1/opening-hours", openingHours);
app.route("/v1/graduation-sessions", graduationSessions);
app.route("/v1/occupations", occupancy);
app.route("/v1/photos", photos);
app.route("/v1/eggs", eggs);

export default app;
