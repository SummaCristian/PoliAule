# PoliAule - Public Data API

PoliAule pre-fetches classroom occupancy data from Politecnico di Milano every morning and hourly during the day, and serves it through a small versioned REST API backed by Cloudflare Workers + R2. These endpoints are publicly accessible. If you want to build something on top of PoliMi classroom data, you can use them directly instead of scraping Politecnico yourself.

> [!IMPORTANT]
> PoliAule's API now has a new home!
> If you were using it before August 2026 (v1.0.0), the old URLs won't work anymore.
>
> Please update to the new ones, and sorry for the disruption. Please note that the new URLs provide feature parity with the previous ones, just relocated. The URL format has slightly changed as well, but the REST architecture remains the same

---

## Endpoints

All endpoints are under `https://api.poliaule.com` and require no authentication. A separate `https://api-beta.poliaule.com` serves the beta deployment with the same response shapes, though it may include in-progress changes.

The JSON endpoints (`/v1/classrooms`, `/v1/occupations`, `/v1/occupations/:date`, `/v1/opening-hours`, `/v1/graduation-sessions`) send `Cache-Control: no-store` with an `ETag` (exposed to cross-origin `fetch()`). Keep your own copy and send its ETag back as `If-None-Match`: an unchanged file comes back as a bodiless `304 Not Modified`.

### Static classroom metadata

```
GET /v1/classrooms
```

Returns the full list of campuses, buildings, and classrooms with their static attributes (name, location, features, seat count). This data changes rarely and can be cached aggressively.

### Available dates

```
GET /v1/occupations
```

Returns the list of dates for which occupancy data currently exists. Fetch this first to know which dates are available before requesting individual dates. A `generated_at` timestamp is also included to indicate when the last fetch occurred and how fresh the data is. Use this one for freshness: each day's own `generated_at` (below) only moves when that day's data changes.

```json
{
  "generated_at": "2026-04-29T05:54:14.317071",
  "dates": ["20260429", "20260430", "20260501", "20260502", "20260503", "20260504", "20260505"]
}
```

### Daily occupancy

```
GET /v1/occupations/:date
```

Returns occupancy slots for all classrooms on a given date. `:date` is `YYYY-MM-DD` (e.g. `/v1/occupations/2026-04-29`).

Up to 7 dates are available at any time, covering today through the next 6 days. Data is regenerated early each morning (around 3 AM UTC) and then hourly during the day, roughly 07:00 to 20:00 Italian time. A date is skipped (no data generated) if it falls in a university holiday period, or if every building is closed that weekday according to `/v1/opening-hours` below.

### Building opening hours

```
GET /v1/opening-hours
```

Returns per-building opening hours, campus-wide defaults, and holiday closure periods, scraped weekly from PoliMi's official opening-hours page. Use this to know when a specific building (not just a specific room's booked slots) is actually open.

```json
{
  "generated_at": "2026-07-30T11:58:36.196790",
  "source_url": "https://www.polimi.it/campus-e-servizi/spazi-e-aule-studio/orari-di-apertura-edifici",
  "holiday_periods": [
    { "start": "2026-08-10", "end": "2026-08-21" }
  ],
  "buildings": {
    "21": { "mon_fri": ["07:30", "20:30"], "sat": ["08:00", "14:00"], "sun": null }
  },
  "campus_defaults": {
    "MIA01": { "mon_fri": ["07:00", "21:00"], "sat": ["07:00", "20:00"], "sun": null }
  },
  "common_areas": [
    { "building": "11", "name": "Patio", "mon_fri": ["00:00", "23:59"], "sat": ["00:00", "23:59"], "sun": ["00:00", "23:59"] }
  ],
  "default_hours": { "mon_fri": ["07:15", "20:15"], "sat": null, "sun": null }
}
```

To resolve a given building's hours: look it up in `buildings` by its number/code (the leading alphanumeric token of its `name` in `classrooms.json`, e.g. `"32.1"` → `"32"`); if not found, look up its campus `id` in `campus_defaults`; if that's also missing, use `default_hours`. `null` for `sat`/`sun` means closed that day.

`common_areas` lists a building's common spaces with their own hours (e.g. building 11's Patio and Agorà, open around the clock), keyed by the same building code. They're open even when the building's classrooms aren't, so they never change the building's own hours. `["00:00", "23:59"]` means open 24 hours (the page's "H24").

### Graduation sessions

```
GET /v1/graduation-sessions
```

Returns the days of PoliMi's graduation sessions (sessioni di laurea) and the campuses each one is held at, scraped monthly from the "Periodi di lezione e sessioni di laurea" PDF linked on [polimi.it/studenti/calendari-e-scadenze](https://www.polimi.it/studenti/calendari-e-scadenze). Classrooms used for the ceremonies usually show as free in the occupancy data, so on these days a campus's rooms may be taken even when `/v1/occupations` says otherwise.

```json
{
  "generated_at": "2026-10-11T06:31:02.512840",
  "source_url": "https://www.polimi.it/studenti/calendari-e-scadenze",
  "documents": [
    { "academic_year": "2026/2027", "title": "Periodi di lezione e sessioni di laurea - 2026/2027", "url": "https://www.polimi.it/fileadmin/…/Calendario_a.a._2026-2027_-periodi_lezione-sessioni_laurea_v1.1.pdf" }
  ],
  "sessions": [
    {
      "date": "2026-09-30",
      "academic_year": "2026/2027",
      "session": "Settembre 2026",
      "levels": ["triennale"],
      "campuses": ["CRG02", "LCF04", "MIB01", "MIB02", "MNG01", "PCL01"],
      "campus_parts": [
        { "group": "poli_territoriali", "event": null, "campuses": ["CRG02", "LCF04", "MNG01", "PCL01"] },
        { "group": "design", "event": "proclamazione", "campuses": ["MIB02", "MIB01"] }
      ],
      "level_text": "Laurea Triennale",
      "campus_text": "Poli Territoriali + Proclamazione Design"
    }
  ]
}
```

One entry per day, sorted by date; a session spanning several days has one entry for each. `campuses` holds the campus `id`s (as in `/v1/classrooms`) graduating that day, which is all you need to tell whether a campus has a graduation day. `campus_parts` says why: the PDF's campus cell split on `+`, each part with the campuses it covers:

- `milano`: every primary campus in Milan (Leonardo, Colombo, Bovisa's Durando and La Masa)
- `poli_territoriali`: every primary campus outside Milan (Cremona, Lecco, Mantova, Piacenza)
- `design`: the Design School's days, held at Bovisa only; `event` is `"discussione"` (thesis defences) or `"proclamazione"` (the proclamation), or `null` if the PDF doesn't say

Secondary campuses (offices, residences) are never included. `levels` is any of `"triennale"`, `"magistrale"`, `"ciclo_unico"` (LM C.U.) and `"dottorato"`. `level_text` and `campus_text` are the PDF's cells verbatim. The days of an academic year stay listed until they've passed, even after the page has replaced that year's PDF with the next one.

### Classroom photos

```
GET /v1/photos/:id
```

Returns the classroom's photo as a JPEG image. `:id` is the classroom's stable `id` from `/v1/classrooms` (not PoliMi's internal `idfoto`). Only classrooms with a non-null `idfoto` have a photo; requesting any other id returns 404. Photos are re-fetched from PoliMi once a month, so responses are cacheable for a long time (`Cache-Control: public, max-age=2592000, immutable`).

```
GET /v1/photos/:id/thumb
```

The same photo scaled down to 640px on its long side (the full one is typically 1500x1125), for places that show it small: list cards, search rows. Same caching. A classroom whose thumbnail hasn't been generated yet gets the full photo here instead, with a short `Cache-Control: public, max-age=3600` so the real thumbnail takes over once it's uploaded.

### Frontend config

```
GET /v1/config
```

Returns `{ "mapboxToken": string }` — the URL-restricted Mapbox public token the Campus tab map uses, kept in a worker secret rather than the (public) source repo. `503` with `mapboxToken: null` if the secret is unset. `Cache-Control: public, max-age=3600`.

---

## Response schemas

### `/v1/classrooms`

```
[                                   ← array of campuses
  {
    id:        string               // e.g. "MIA01"
    name:      string               // short display name, e.g. "Leonardo"
    slug:      string               // URL-safe identifier, e.g. "leonardo"
    city:      string               // e.g. "Milan"
    group:     string | undefined   // group within the city, e.g. "Città Studi" or "Bovisa" - omitted for single-campus cities
    lat:       number
    long:      number
    secondary: true | undefined     // nothing to book here (offices, residences, ...); omitted otherwise
    buildings: [
      {
        name:       string
        altName:    string | null
        address:    string
        lat:        number
        long:       number
        idEdificio: number | null
        secondary:  true | undefined   // no classrooms, or only events-only ones; omitted otherwise
        classrooms: [
          {
            id:                number   // stable room identifier
            name:              string   // e.g. "2.0.1"
            floor:             number | null   // parsed from name (X.Y.Z -> Y); null if not resolvable
            seats:             number | null
            accessible_seats:  number | null
            workstations:      number | null
            idfoto:            number | null   // photo reference
            eventsOnly:        true | undefined   // generally closed outside official events; omitted otherwise
            noSchedule:        true | undefined   // PoliMi publishes no schedule for it; omitted otherwise
            features: [
              {
                id: number
                it: string   // feature name in Italian
                en: string   // feature name in English
              }
            ]
          }
        ]
      }
    ]
  }
]
```

### `/v1/occupations/:date`

Same structure as `/v1/classrooms`, with a top-level metadata wrapper and an `occupancy` array added to each classroom. Campus-level metadata fields (`slug`, `city`, `group`) are **not** included here; fetch `/v1/classrooms` for those.

```
{
  generated_at: string   // ISO 8601 timestamp (UTC) of when this day's data last changed; an hourly run that finds
                         // nothing new keeps it, so the file and its ETag stay the same (a 304 for If-None-Match)
  date:         string   // "YYYYMMDD"
  campuses: [
    {
      id:        string  // campus identifier
      name:      string  // short display name
      lat:       number
      long:      number
      secondary: true | undefined
      buildings: [       // same building/classroom fields as classrooms.json, `secondary` included
        {
          ...
          classrooms: [
            {
              ...             // includes `floor`, `eventsOnly` and `noSchedule`, as in /v1/classrooms
              occupancy: [   // list of BOOKED time slots (not free slots); null when the schedule is unknown that day (e.g. a `noSchedule` room)
                {
                  inizio: string        // start time, "HH:MM"
                  fine:   string        // end time,   "HH:MM"

                  // The fields below are scraped separately from onlineservices.polimi.it
                  // and merged in by start/end time; a slot keeps only inizio/fine when the
                  // scrape didn't cover it (network error, unrecognized campus, parse failure).
                  category:     string | undefined         // "COURSE" | "EXAM" | "OTHER"
                  idrichiesta:  number | undefined          // Polimi's internal booking id

                  // category === "COURSE" or "EXAM" only:
                  course:       string | undefined
                  code:         number | undefined          // course code, e.g. 54324
                  professors:   string[] | undefined
                  section:      string | undefined          // e.g. "Sez. A", only present for multi-section courses

                  // category === "OTHER" only (exams, events, tutoring, maintenance, ...):
                  raw:          string | undefined          // the unparsed scraped name
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

Each entry in `occupancy` represents a time slot in which the classroom is **not available** (booked or in use). A classroom with an empty `occupancy` array is free for the entire day.

---

## Known campuses

| ID | Name | Slug | City | Group |
|---|---|---|---|---|
| `MIA01` | Leonardo | `leonardo` | Milan | Città Studi |
| `MIA06` | Colombo | `colombo` | Milan | Città Studi |
| `MIB01` | La Masa | `la-masa` | Milan | Bovisa |
| `MIB02` | Durando | `durando` | Milan | Bovisa |
| `CRG02` | Cremona | `cremona` | Cremona | — |
| `LCF04` | Lecco | `lecco` | Lecco | — |
| `MNG01` | Mantova | `mantova` | Mantova | — |

---

## Known room features

| ID | English label |
|---|---|
| `4` | Video projector |
| `5` | Radio microphone |
| `6` | Dimmable (blinds) |
| `7` | Wired desk |
| `142` | Seats with electric socket |
| `223` | Videoconference / meeting |

---

## Security & data safety

### What we do on our end

String fields in the occupancy files pass through a tag-stripping step before being written. Any `<...>` sequences that the upstream Polimi API might return are removed at ingestion time, so the files you receive will never contain raw HTML tags.

### What you should do on your end

**Tag stripping is not a substitute for output escaping.** Stripping tags removes the most obvious attack shape, but a determined payload can survive in other forms (e.g. attribute injection, URL schemes). If you render any string field from these files into an HTML page, escape it at the point of rendering.

**JavaScript**

```js
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

// Safe:
el.innerHTML = `<span>${escapeHtml(classroom.name)}</span>`;

// Also safe (no escaping needed — textContent never parses HTML):
el.textContent = classroom.name;
```

**Python**

```python
import html

# Safe:
snippet = f"<span>{html.escape(classroom['name'])}</span>"
```

**URLs in href / src attributes**

The `features` array does not contain URLs. If you ever construct links from field values, validate that the URL uses `https:` before placing it in an `href` or `src` attribute — a value like `javascript:…` is syntactically valid in those attributes and will execute on click.

```js
function safeUrl(url) {
  try { return new URL(url).protocol === 'https:' ? url : '#'; }
  catch { return '#'; }
}
```

---

## Usage notes

- **CORS**: the API is served by a Cloudflare Worker and is accessible from any origin via `fetch()`.
- **Caching**: occupancy data is regenerated hourly during the day. Cache responses for up to an hour on your side to stay reasonably fresh without hammering the API.
- **Missing dates**: if a given date returns 404, the date was skipped (every building closed that weekday, or a holiday) or the scheduled job has not run yet.
- **Null fields**: optional fields (`idfoto`, `workstations`, `accessible_seats`, etc.) may be `null` if Politecnico did not provide them for a given room.

---

## Example: finding free rooms

```js
const date = '2026-04-29';
const res = await fetch(`https://api.poliaule.com/v1/occupations/${date}`);
const { campuses } = await res.json();

const campus = campuses.find(c => c.id === 'MIA01');

for (const building of campus.buildings) {
  for (const classroom of building.classrooms) {
    const isFullyFree = classroom.occupancy.length === 0;
    if (isFullyFree) console.log(classroom.name, '- free all day');
  }
}
```
