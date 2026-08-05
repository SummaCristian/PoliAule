# PoliAule - Public Data API

PoliAule pre-fetches classroom occupancy data from Politecnico di Milano every night and serves it through a small versioned REST API backed by Cloudflare Workers + R2. These endpoints are publicly accessible. If you want to build something on top of PoliMi classroom data, you can use them directly instead of scraping Politecnico yourself.

---

## Endpoints

All endpoints are under `https://api.poliaule.com` and require no authentication. A separate `https://api-beta.poliaule.com` serves the beta deployment with the same response shapes, though it may include in-progress changes.

### Static classroom metadata

```
GET /v1/classrooms
```

Returns the full list of campuses, buildings, and classrooms with their static attributes (name, location, features, seat count). This data changes rarely and can be cached aggressively.

### Available dates

```
GET /v1/occupations
```

Returns the list of dates for which occupancy data currently exists. Fetch this first to know which dates are available before requesting individual dates. A `generated_at` timestamp is also included to indicate when the last fetch occurred and how fresh the data is.

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

Up to 7 dates are available at any time, covering today through the next 6 days. Data is regenerated twice daily: around 3 AM UTC (4 AM Italian time) and 10 AM UTC (~12 PM Italian time). A date is skipped (no data generated) if it falls in a university holiday period, or if every building is closed that weekday according to `/v1/opening-hours` below.

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
  "default_hours": { "mon_fri": ["07:15", "20:15"], "sat": null, "sun": null }
}
```

To resolve a given building's hours: look it up in `buildings` by its number/code (the leading alphanumeric token of its `name` in `classrooms.json`, e.g. `"32.1"` → `"32"`); if not found, look up its campus `id` in `campus_defaults`; if that's also missing, use `default_hours`. `null` for `sat`/`sun` means closed that day.

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
    buildings: [
      {
        name:       string
        altName:    string | null
        address:    string
        lat:        number
        long:       number
        idEdificio: number | null
        classrooms: [
          {
            id:                number   // stable room identifier
            name:              string   // e.g. "2.0.1"
            seats:             number | null
            accessible_seats:  number | null
            workstations:      number | null
            idfoto:            number | null   // photo reference
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
  generated_at: string   // ISO 8601 timestamp of when the file was built
  date:         string   // "YYYYMMDD"
  campuses: [
    {
      id:        string  // campus identifier
      name:      string  // short display name
      lat:       number
      long:      number
      buildings: [       // same building/classroom fields as classrooms.json
        {
          ...
          classrooms: [
            {
              ...
              occupancy: [   // list of BOOKED time slots (not free slots)
                {
                  inizio: string   // start time, "HH:MM"
                  fine:   string   // end time,   "HH:MM"
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
- **Caching**: occupancy data is regenerated twice per day. Cache responses for up to an hour on your side to stay reasonably fresh without hammering the API.
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
