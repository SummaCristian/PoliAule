---
version: 0.9.0
date: 2026-05-01
channel: beta
title: Getting ready for 1.0
github: https://github.com/SummaCristian/poliaule/releases/tag/0.9.0
---
- Redesigned the availability timeline in the Available tab's results
- Replaced the two time pickers with a single Time range picker
- The details page now carries your query over when you reach it from the Available tab
- New, readable URLs for the classroom details page
- Added "Auto search on load" and "Live search"
- Added the Info page: tap the logo in the header to find out more about PoliAule!
- Launched PoliAule Beta, with its own icons, at [beta.poliaule.com](https://beta.poliaule.com)
- Published the documentation, and a new API endpoint listing the fetched dates
<!-- more -->
One of the most important points in PoliAule's history. The stable version is close, so every corner is being smoothed and every missing bit added: new features, fixes for PoliAule's old weak points, and a lot of polish, like the new Info page, final classroom URLs, and documentation to help new contributors.

PoliAule also kicks off its full deployment pipeline: a main branch for production and a beta branch for public beta testing.

## Timelines
The timeline in the Available results has a new, more elegant design. It does a better job of showing how occupations intersect the queried period, highlighting not only what happens inside it but also right before and after.

The timelines in the details page follow the same design and meaning, with occupations now red instead of green, to avoid misreadings.

## Time range picker
The two time pickers are replaced by a new Time range picker: a timeline with a range selector on top. Drag either handle to change the start or the end, or drag the whole block to move the selection through the day.

The older, more precise controls are still there: tap the handles of the selection, or its labels.

## Navigation and URLs
Opening a classroom from the Available results now carries your query along. On mobile the day view opens on the same day you were looking at, and on both mobile and desktop the queried time range is highlighted. Opening a classroom from the Search tab works as before.

Classroom URLs now use names, so they're easier to write and to read:

```
poliaule.com/#classroom/{campus}/{classroom}
poliaule.com/#classroom/leonardo/2.0.1
```

They're case-insensitive, so `T.2.1` and `t.2.1` both work. The campus slug is needed because some names exist in more than one campus, like `A.0.1` in both Lecco and Mantova.

## Auto search on load
PoliAule runs a search as soon as the page loads, using the default query. Paired with sensible defaults, this makes checking for free classrooms faster. It's on by default; you can turn it off, or change the defaults, in Settings.

## Live search
The results now refresh as soon as anything in the query changes, without pressing the button. It's on by default and can be turned off in Settings, since redoing the search on every change can be heavy on less capable devices.

## Info page
A new page with more information about PoliAule. Open it by tapping the logo in the top left corner from any page, or go straight to `poliaule.com/#info`.

## PoliAule Beta
PoliAule recently moved from GitHub Pages to Cloudflare Pages. Apart from better performance, nothing changes for you, but it makes it possible to deploy several branches on their own subdomains.

PoliAule's beta branch now lives at [beta.poliaule.com](https://beta.poliaule.com), with its own identity: custom favicons and app icon.

![PoliAule Beta's favicon](media/beta-favicon.webp) ![PoliAule Beta's app icon](media/beta-app-icon.webp)

## Documentation
The repository now has documentation on how PoliAule works, in the `docs` folder:

- `architecture.md`: how data is fetched and served, the JSON formats, the deployment pipeline and the external dependencies
- `api.md`: the documentation of PoliAule's REST API, which the app itself uses. It's free, so other services can use PoliAule's data instead of hitting Politecnico's servers
- `frontend.md`: how the UI is built: navigation, hash-based routing, View Transitions, localisation, PWA support and more

## New API endpoint
A new endpoint returns when the data was generated and the list of dates PoliAule has data for.
