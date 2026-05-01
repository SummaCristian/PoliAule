# PoliAule - Architecture

PoliAule is a static web app that finds available classrooms at Politecnico di Milano. It has no custom server: a GitHub Actions job pre-fetches occupancy data nightly, the frontend reads those JSON files directly through the built-in REST API.

---

## System Overview

```mermaid
graph TD
    classDef ci fill:#fde68a,stroke:#f59e0b,color:#713f12
    classDef py fill:#dbeafe,stroke:#3b82f6,color:#1e3a8a
    classDef api fill:#f3f4f6,stroke:#9ca3af,color:#374151
    classDef store fill:#dcfce7,stroke:#22c55e,color:#14532d
    classDef cf fill:#ffedd5,stroke:#f97316,color:#7c2d12
    classDef browser fill:#ede9fe,stroke:#8b5cf6,color:#2e1065

    subgraph CI ["Nightly CI"]
        GHA["GitHub Actions"]:::ci
        PY["scripts/fetch.py"]:::py
    end

    API["PoliMaps API"]:::api
    JSON[("occupancy/*.json")]:::store

    subgraph Delivery ["Delivery"]
        CFP["Cloudflare Pages"]:::cf
        BROWSER["Browser"]:::browser
    end

    GHA -->|runs nightly| PY
    PY -->|fetch per room/day| API
    API -->|slot list| PY
    PY -->|writes| JSON
    JSON -->|served by| CFP
    CFP -->|static files| BROWSER
```

Data never passes through a custom backend. The browser fetches occupancy JSON files the same way it fetches any static asset.

---

## Data Pipeline

### fetch.py

Runs on a schedule (and can be triggered manually). For each of the next 7 non-Sunday, non-holiday days it:

1. Reads `data/classrooms.json` to get room IDs.
2. GETs the occupancy endpoint for every room on each day.
3. Writes one `occupancy/occupation_YYYYMMDD.json` per day, mirroring the classrooms structure plus an `occupancy` array of hourly slots.
4. Deletes stale files (dates before today).

```mermaid
sequenceDiagram
    participant GHA as GitHub Actions
    participant PY as fetch.py
    participant API as PoliMaps API
    participant FS as occupancy/

    GHA->>PY: run
    PY->>PY: fetch_days() - next 7 days (skip Sundays + holidays)
    loop each day × each room
        PY->>API: GET occupancy/{id}/{date}
        API-->>PY: [{slot}, ...]
        PY-->>PY: wait 0.5s (skipped with --no-delay)
    end
    PY->>FS: write occupation_YYYYMMDD.json × 7
    PY->>FS: delete files older than today
```

Rate limiting: 0.5 seconds between calls (skippable via `--no-delay`), 3 retries with 2 seconds backoff on failure.

### JSON schema (abbreviated)

```
occupation_YYYYMMDD.json
└── date: "YYYY-MM-DD"
└── campuses[]
    └── id, name
    └── buildings[]
        └── id, name
        └── classrooms[]
            └── id, name, features[]
            └── occupancy[]          ← added by fetch.py; each entry is a BOOKED slot
                └── { inizio: "HH:MM", fine: "HH:MM" }
```

`data/classrooms.json` has the same structure minus the `occupancy` field; it's the static source of truth for room metadata. 

> Full schema and usage examples are in [api.md](./api.md).

---

## Frontend Architecture

> For more detail on routing, navigation, the View Transition API, and PWA support, see [frontend.md](./frontend.md).

The frontend is vanilla ES modules, no build step or framework.

```mermaid
graph TD
    classDef entry fill:#f8fafc,stroke:#64748b,color:#1e293b
    classDef shell fill:#dbeafe,stroke:#3b82f6,color:#1e3a8a
    classDef data fill:#dcfce7,stroke:#22c55e,color:#14532d
    classDef i18n fill:#fde68a,stroke:#f59e0b,color:#713f12
    classDef component fill:#ede9fe,stroke:#8b5cf6,color:#2e1065
    classDef store fill:#f1f5f9,stroke:#475569,color:#0f172a

    IH["index.html"]:::entry
    SC["script.js"]:::shell
    ARS["available-rooms-script.js"]:::data
    SCS["search-classrooms-script.js"]:::data
    I18N["i18n.js"]:::i18n

    CP["campus-picker.js"]:::component
    CD["classroom-detail.js"]:::component
    CL["classroom-list.js"]:::component
    TP["time-picker.js"]:::component
    TRS["time-range-slider.js"]:::component
    SET["settings.js"]:::component
    HAP["haptics.js"]:::component
    TT["tooltip.js"]:::component

    IH -->|loads| SC
    SC -->|imports| ARS
    SC -->|imports| SCS
    SC -->|imports| I18N
    SC -->|imports| CP
    SC -->|imports| CD
    SC -->|imports| CL
    SC -->|imports| TP
    SC -->|imports| TRS
    SC -->|imports| SET
    SC -->|imports| HAP
    SC -->|registers| TT
    SCS -->|imports| ARS
    SCS -->|imports| I18N
    ARS -->|fetches| JSON[("occupancy/*.json")]:::store
```

### Key modules

| File | Responsibility |
|---|---|
| `script.js` | App shell: splash screen, tab routing, form wiring, campus picker init |
| `available-rooms-script.js` | Fetches occupancy JSON, exposes `findAvailableClassrooms()` |
| `search-classrooms-script.js` | Search tab: full-text index, hierarchy navigation, classroom status |
| `i18n.js` | Locale detection (browser / localStorage), `t()` translation helper |
| `components/campus-picker.js` | Campus selector UI + popup |
| `components/classroom-detail.js` | Classroom detail page with timeline and photo |
| `components/time-picker.js` | Morphing time input |
| `components/time-range-slider.js` | Dual-handle slider for time range |
| `components/settings.js` | User preferences (remembered campus, partial availability, etc.) |
| `components/tooltip.js` | Side-effect module: registers a global `data-tooltip` attribute handler |
| `components/popover.js` | `@floating-ui/dom` wrapper (exported, available for future use) |

### Classroom photos

Classroom photos are fetched on-demand when the user opens a detail page, not at startup. If the classroom has an `idfoto` field in the data, `ClassroomDetail._loadPhoto()` fires a single request at that point. Nothing is preloaded or cached beyond the browser's own HTTP cache.

### Localization

`i18n.js` detects locale from `localStorage` → `navigator.language` → `'en'` fallback. Supported: `en`, `it`. Translation files live in `locales/en.json` and `locales/it.json`. The `t(key)` helper is called by virtually every component.

---

## Deployment

PoliAule is hosted on **Cloudflare Pages** across two branches, each mapped to its own custom domain:

| Branch | Domain | Purpose |
|---|---|---|
| `main` | `poliaule.com` | Production |
| `beta` | `beta.poliaule.com` | Staging / preview |

Development happens on `dev`, which gets merged into `beta` for testing and then into `main` for release.

```mermaid
graph LR
    classDef branch fill:#f1f5f9,stroke:#94a3b8,color:#1e293b
    classDef staging fill:#ffedd5,stroke:#f97316,color:#7c2d12
    classDef prod fill:#dcfce7,stroke:#22c55e,color:#14532d
    classDef site fill:#ede9fe,stroke:#8b5cf6,color:#2e1065

    DEV["dev"]:::branch
    BETA["beta"]:::staging
    MAIN["main"]:::prod
    BETA_SITE["beta.poliaule.com"]:::site
    PROD["poliaule.com"]:::site

    DEV -->|merge into| BETA
    BETA -->|merge into| MAIN
    MAIN -->|Cloudflare Pages| PROD
    BETA -->|Cloudflare Pages| BETA_SITE
```

### Keeping beta in sync

After the nightly fetch commits new occupancy data to `main`, the Actions workflow checks out `beta` and merges `main` into it. That way `beta.poliaule.com` always serves fresh data, even when no code changes are in flight.

The app detects its environment from `location.hostname` at startup and shows a badge for `beta.poliaule.com` and local dev.

---

## External Dependencies (CDN)

| Library | Used for |
|---|---|
| `@floating-ui/dom` | Popover positioning |
| `web-haptics` | Mobile vibration feedback |
| Google Fonts (Nunito) | Typography |
| Google Material Symbols | Icons |
