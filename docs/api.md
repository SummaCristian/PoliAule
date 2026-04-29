# PoliAule - Public Data API

PoliAule pre-fetches classroom occupancy data from Politecnico di Milano every night and stores it as plain JSON files served by Cloudflare Pages. These files are publicly accessible. If you want to build something on top of PoliMi classroom data, you can use them directly instead of scraping Politecnico yourself.

---

## Endpoints

All endpoints are under `https://poliaule.com` and require no authentication.

### Static classroom metadata

```
GET /data/classrooms.json
```

Returns the full list of campuses, buildings, and classrooms with their static attributes (name, location, features, seat count). This file changes rarely and can be cached aggressively.

### Available dates

```
GET /occupancy/list.json
```

Returns the list of dates for which an occupancy file currently exists. Fetch this first to know which dates are available before requesting individual files. A `generated_at` timestamp is also included to indicate when the last fetch occurred and how fresh the data is.

```json
{
  "generated_at": "2026-04-29T05:54:14.317071",
  "dates": ["20260429", "20260430", "20260501", "20260502", "20260503", "20260504", "20260505"]
}
```

### Daily occupancy

```
GET /occupancy/occupation_YYYYMMDD.json
```

Returns occupancy slots for all classrooms on a given date. Dates follow the `YYYYMMDD` format (e.g. `occupation_20260429.json`).

Up to 7 files are available at any time, covering today through the next 6 days. Files are regenerated nightly around 3 AM UTC. Sundays and university holiday periods (Christmas, Summer) are skipped; no file is generated for those dates.

---

## Response schemas

### `/data/classrooms.json`

```
[                                   ← array of campuses
  {
    id:        string               // e.g. "MIA01"
    name:      string               // e.g. "Milano Leonardo - Città Studi"
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

### `/occupancy/occupation_YYYYMMDD.json`

Same structure as `classrooms.json`, with a top-level metadata wrapper and an `occupancy` array added to each classroom.

```
{
  generated_at: string   // ISO 8601 timestamp of when the file was built
  date:         string   // "YYYYMMDD"
  campuses: [
    {
      ...                // same campus/building/classroom fields as above
      buildings: [
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

| ID | Name |
|---|---|
| `MIA01` | Milano Leonardo - Città Studi |
| `MIA06` | Milano - Via Colombo |
| `MIB01` | Milano Bovisa - Via La Masa |
| `MIB02` | Milano Bovisa - Via Durando |
| `CRG02` | Cremona |
| `LCF04` | Lecco |
| `MNG01` | Mantova |

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

## Usage notes

- **CORS**: files are served as static assets by Cloudflare Pages and are accessible from any origin via `fetch()`.
- **Caching**: occupancy files are regenerated once per day. Cache them for up to an hour on your side to stay reasonably fresh without hammering the CDN.
- **Missing dates**: if a file for a given date does not exist (404), the date was skipped (Sunday or holiday) or the nightly job has not run yet.
- **Null fields**: optional fields (`idfoto`, `workstations`, `accessible_seats`, etc.) may be `null` if Politecnico did not provide them for a given room.

---

## Example: finding free rooms

```js
const date = '20260429';
const res = await fetch(`https://poliaule.com/occupancy/occupation_${date}.json`);
const { campuses } = await res.json();

const campus = campuses.find(c => c.id === 'MIA01');

for (const building of campus.buildings) {
  for (const classroom of building.classrooms) {
    const isFullyFree = classroom.occupancy.length === 0;
    if (isFullyFree) console.log(classroom.name, '- free all day');
  }
}
```
