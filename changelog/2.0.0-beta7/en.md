---
version: 2.0.0-beta7
date: 2026-09-21
channel: beta
title: A new classroom page
github: https://github.com/SummaCristian/poliaule/pull/34
---
- Redesigned the classroom details page
- Added a map showing where the building is, inside the details page
- Added the building's opening hours to the details page
- Improved the performance of the whole app
- Moved the whole design system to Vitrium, the component library extracted from PoliAule
<!-- more -->
## Details page
The redesigned details page now has a full-bleed background with the classroom's photo, for a more immersive experience.

It also shows new information: a map with the building's location, with links to Google Maps and Apple Maps to get directions, and a separate tab with the building's opening hours across the week.

## Performance
PoliAule's files are now delivered more efficiently, so it should load faster and feel better to use on the go. This is still a work in progress, but the difference should already be noticeable.

## Vitrium
PoliAule now ships with **Vitrium**, the component library built by extracting PoliAule's distinctive components, generalised and expanded along the way. It's available on npm, so anyone can use it. Find out more at [vitrium.summacristian.com](https://vitrium.summacristian.com).
