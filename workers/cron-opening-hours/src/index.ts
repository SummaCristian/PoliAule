// Port of scripts/fetch_opening_hours.py. Writes to an R2 bucket instead of
// the local filesystem.

import { parseHTML } from "linkedom";

export interface Env {
  DATA_BUCKET: R2Bucket;
}

const SOURCE_URL = "https://www.polimi.it/campus-e-servizi/spazi-e-aule-studio/orari-di-apertura-edifici";
const OUTPUT_KEY = "opening-hours.json";
const REQUEST_TIMEOUT_MS = 20_000;

const DEFAULT_HOURS: Hours = { mon_fri: ["07:15", "20:15"], sat: null, sun: null };

const PAGE_CAMPUS_LABEL_TO_IDS: Record<string, string[]> = {
  Leonardo: ["MIA01"],
  Bovisa: ["MIB01", "MIB02"],
  "La Masa": ["MIB01"],
};

const IGNORED_DESCRIPTOR_SUBSTRINGS = [
  "biblioteca",
  "archivi storici",
  "campo giuriati",
  "accesso carrario",
  "accesso pedonale",
  "patio",
  "agor",
];

const BUILDING_ID_RE = /edificio\s+([a-z0-9]+)/i;
const TIME_RANGE_RE = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/;

const MONTHS_IT: Record<string, number> = {
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4,
  maggio: 5, giugno: 6, luglio: 7, agosto: 8,
  settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
};
const MONTH_NAMES = Object.keys(MONTHS_IT).join("|");

const CLOSURE_RANGE_CROSS_RE = new RegExp(
  `dal (\\d{1,2}) (${MONTH_NAMES}) (\\d{4}) al (\\d{1,2}) (${MONTH_NAMES}) (\\d{4})`,
  "gi",
);
const CLOSURE_RANGE_SAME_MONTH_RE = new RegExp(
  `dal (\\d{1,2}) al (\\d{1,2}) (${MONTH_NAMES}) (\\d{4})`,
  "gi",
);
const CLOSURE_SINGLE_DAY_RE = new RegExp(`\\bil (\\d{1,2}) (${MONTH_NAMES}) (\\d{4})\\b`, "gi");

const MIN_BUILDINGS = 6;
const MIN_CAMPUS_DEFAULTS = 1;
const MIN_HOLIDAY_PERIODS = 1;

class ScrapeError extends Error {}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type HourRange = [string, string];
interface Hours {
  mon_fri: HourRange | null;
  sat: HourRange | null;
  sun: HourRange | null;
}
interface HolidayPeriod {
  start: string;
  end: string;
}
interface ParsedPage {
  buildings: Record<string, Hours>;
  campus_defaults: Record<string, Hours>;
  holiday_periods: HolidayPeriod[];
}

// ---------------------------------------------------------------------------
// Parsing helpers (mirror scripts/fetch_opening_hours.py)
// ---------------------------------------------------------------------------

function parseHoursCell(raw: string): HourRange | null {
  const text = raw.trim().toLowerCase();
  if (!text || text === "chiuso") return null;
  if (text === "h24") return ["00:00", "23:59"];
  const m = TIME_RANGE_RE.exec(text);
  if (!m) return null;
  const [, h1, m1, h2, m2] = m;
  return [`${h1.padStart(2, "0")}:${m1}`, `${h2.padStart(2, "0")}:${m2}`];
}

function isIgnoredDescriptor(descriptor: string): boolean {
  const lowered = descriptor.toLowerCase();
  return IGNORED_DESCRIPTOR_SUBSTRINGS.some((s) => lowered.includes(s));
}

// `any` here (rather than the DOM `Element` type) because linkedom's Element
// shape clashes with @cloudflare/workers-types' unrelated HTMLRewriter Element.
function cellText(el: any): string {
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

function parseHoursTable(
  table: any,
  buildings: Record<string, Hours>,
  campusDefaults: Record<string, Hours>,
): void {
  const rows = Array.from(table.querySelectorAll("tr")).slice(1) as any[]; // skip header row
  for (const tr of rows) {
    const cells = Array.from(tr.querySelectorAll("td, th")).map(cellText);
    if (cells.length < 5) continue;
    const [campusLabel, descriptor, monFriRaw, satRaw, sunRaw] = cells;

    if (descriptor.trim() === "Tutti" || descriptor.trim() === "Tutti gli altri spazi") {
      const hours = parseHoursCell(monFriRaw);
      if (hours === null) continue;
      campusDefaults[campusLabel.trim()] = {
        mon_fri: hours,
        sat: parseHoursCell(satRaw),
        sun: parseHoursCell(sunRaw),
      };
      continue;
    }

    if (isIgnoredDescriptor(descriptor)) continue;

    const match = BUILDING_ID_RE.exec(descriptor);
    if (!match) continue;

    const monFri = parseHoursCell(monFriRaw);
    if (monFri === null) continue;

    const buildingId = match[1].toUpperCase();
    buildings[buildingId] = { mon_fri: monFri, sat: parseHoursCell(satRaw), sun: parseHoursCell(sunRaw) };
  }
}

function parseClosureSentence(sentence: string): HolidayPeriod[] {
  const periods: HolidayPeriod[] = [];
  const consumedSpans: [number, number][] = [];
  const overlapsConsumed = (start: number, end: number) =>
    consumedSpans.some(([a, b]) => (a <= start && start < b) || (a < end && end <= b));
  const isoDate = (y: string, mo: string, d: string) =>
    `${y.padStart(4, "0")}-${String(MONTHS_IT[mo.toLowerCase()]).padStart(2, "0")}-${d.padStart(2, "0")}`;

  for (const m of sentence.matchAll(CLOSURE_RANGE_CROSS_RE)) {
    const [, d1, mo1, y1, d2, mo2, y2] = m;
    periods.push({ start: isoDate(y1, mo1, d1), end: isoDate(y2, mo2, d2) });
    consumedSpans.push([m.index!, m.index! + m[0].length]);
  }
  for (const m of sentence.matchAll(CLOSURE_RANGE_SAME_MONTH_RE)) {
    const span: [number, number] = [m.index!, m.index! + m[0].length];
    if (overlapsConsumed(...span)) continue;
    const [, d1, d2, mo, y] = m;
    periods.push({ start: isoDate(y, mo, d1), end: isoDate(y, mo, d2) });
    consumedSpans.push(span);
  }
  for (const m of sentence.matchAll(CLOSURE_SINGLE_DAY_RE)) {
    const span: [number, number] = [m.index!, m.index! + m[0].length];
    if (overlapsConsumed(...span)) continue;
    const [, d, mo, y] = m;
    const day = isoDate(y, mo, d);
    periods.push({ start: day, end: day });
    consumedSpans.push(span);
  }
  return periods;
}

function parsePage(html: string): ParsedPage {
  const { document } = parseHTML(html);

  const buildings: Record<string, Hours> = {};
  const campusDefaultsByLabel: Record<string, Hours> = {};

  const tables = Array.from(document.querySelectorAll("table")) as any[];
  for (const table of tables) {
    const headerRow = table.querySelector("tr");
    if (!headerRow) continue;
    const headerCells = Array.from(headerRow.querySelectorAll("td, th")).map(cellText);
    const head2 = headerCells.slice(0, 2).join("|");
    if (head2 === "Campus|Edifici / spazi" || head2 === "Campus|Edifici/spazi") {
      parseHoursTable(table, buildings, campusDefaultsByLabel);
    }
  }

  const campusDefaults: Record<string, Hours> = {};
  for (const [label, hours] of Object.entries(campusDefaultsByLabel)) {
    for (const campusId of PAGE_CAMPUS_LABEL_TO_IDS[label] ?? []) {
      campusDefaults[campusId] = hours;
    }
  }

  const text = (document.body?.textContent ?? "").replace(/\s+/g, " ").trim();
  const start = text.indexOf("l'Ateneo chiuderà");
  if (start === -1) throw new ScrapeError("Could not find the closure announcement sentence on the page");
  const end = text.indexOf(".", start);
  const sentence = text.slice(start, end !== -1 ? end : start + 500);
  const holidayPeriods = parseClosureSentence(sentence);

  return { buildings, campus_defaults: campusDefaults, holiday_periods: holidayPeriods };
}

function validate(parsed: ParsedPage): void {
  if (Object.keys(parsed.buildings).length < MIN_BUILDINGS) {
    throw new ScrapeError(
      `Only parsed ${Object.keys(parsed.buildings).length} buildings, expected at least ${MIN_BUILDINGS}. Page layout may have changed.`,
    );
  }
  if (Object.keys(parsed.campus_defaults).length < MIN_CAMPUS_DEFAULTS) {
    throw new ScrapeError("Could not parse any campus-wide default hours ('Tutti' rows).");
  }
  if (parsed.holiday_periods.length < MIN_HOLIDAY_PERIODS) {
    throw new ScrapeError("Could not parse any holiday closure periods.");
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function run(env: Env): Promise<void> {
  const res = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Failed to fetch ${SOURCE_URL}: HTTP ${res.status}`);
  const html = await res.text();

  let parsed: ParsedPage;
  try {
    parsed = parsePage(html);
    validate(parsed);
  } catch (err) {
    if (err instanceof ScrapeError) {
      console.error(`Scrape validation failed, leaving existing ${OUTPUT_KEY} untouched: ${err.message}`);
      return;
    }
    throw err;
  }

  const output = {
    generated_at: new Date().toISOString(),
    source_url: SOURCE_URL,
    holiday_periods: parsed.holiday_periods,
    buildings: parsed.buildings,
    campus_defaults: parsed.campus_defaults,
    default_hours: DEFAULT_HOURS,
  };

  await env.DATA_BUCKET.put(OUTPUT_KEY, JSON.stringify(output), {
    httpMetadata: { contentType: "application/json" },
  });

  console.log(
    `Written ${Object.keys(parsed.buildings).length} buildings, ${Object.keys(parsed.campus_defaults).length} campus defaults, ${parsed.holiday_periods.length} holiday periods to ${OUTPUT_KEY}`,
  );
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(run(env));
  },
  async fetch(_req: Request, env: Env): Promise<Response> {
    await run(env);
    return new Response("ok");
  },
};
