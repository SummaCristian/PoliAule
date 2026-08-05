import { Hono } from "hono";
import { cors } from "hono/cors";
import { classrooms } from "./routes/classrooms";
import { openingHours } from "./routes/opening-hours";
import { occupancy } from "./routes/occupancy";

export interface Env {
  DATA_BUCKET: R2Bucket;
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());

app.route("/v1/classrooms", classrooms);
app.route("/v1/opening-hours", openingHours);
app.route("/v1/occupations", occupancy);

export default app;
