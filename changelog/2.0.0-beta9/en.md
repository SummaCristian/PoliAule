---
version: 2.0.0-beta9
date: 2026-10-03
channel: beta
title: Glass markers and favourite buildings
github: https://github.com/SummaCristian/poliaule/pull/37
---
- Redesigned the map markers for campuses and buildings
- Redesigned the time range picker in the Available tab
- Added favourite buildings
- Added a new expanded layout for Favourites in the Available tab
- See a classroom's whole day at a glance by hovering on the bottom of its card
- Classroom cards now show the current and next time slots
- Improved startup performance
- Updated the data to include every campus, building and classroom, including the Piacenza campus and many secondary buildings
- Updated the icons and logos
<!-- more -->
## Map markers
The map markers have been redesigned from scratch. They now have a clear glass body from Vitrium, which looks elegant and sleek on the colourful Mapbox map, and they show the building's alternative name too, so it's easier to recognise.

Primary buildings (the ones with classrooms) are green, while secondary buildings are completely clear and slightly smaller.

![Glass markers on the Campus map](media/map-markers.webp)

## Time range picker
The new time range picker joins the rest of the redesign, built with Vitrium to look modern and consistent.

It keeps the familiar feel: a horizontal time bar with a draggable selection on top. The interaction is simpler and made for touch: the selection now snaps to whole hours, and dragging (or the new tap) only moves the range to the chosen hour. The duration is set with a stepper in the top right corner, so there's no need to grab a precise spot to tell resizing from moving.

![The new time range picker](media/time-range-picker.webp)

## Favourites
You can now add an entire building to your favourites, for quick access to all its classrooms without filling your screen with individual cards. Buildings sit alongside your favourite classrooms, look like folders, and open into a popup with all their classrooms.

![A favourite building](media/favourite-buildings.webp)

On desktop, Favourites also have an expanded layout: the left column becomes a grid of your favourites so you can scan them all at once, and the pickers move to the top of the right column, sticky like on mobile.

![The expanded Favourites layout on desktop](media/favourites-expanded.webp)

## Peek at the occupation
The classroom cards have been tweaked to make checking a classroom's day quicker. They now show a small timeline of the current and next time slots, or of your query, with the status and occupations over time, so you can tell at a glance whether the status is about to change.

![A free classroom card with its next slot](media/card-timeline-1.webp) ![A card with a lesson coming up](media/card-timeline-2.webp) ![A busy classroom card](media/card-timeline-3.webp)

Hovering on the bottom of a card opens a popover with the classroom's whole day, without opening its details page.

![The whole day in a popover](media/day-popover.webp)

## Startup performance
Thanks to a new service worker, PoliAule now keeps most of its files on your device, so the UI is already there when you open it.

The same goes for the data: PoliAule reuses the data it already has to build the UI immediately, while it checks for updates in the background and refreshes the UI if there are any. Startup is much faster, especially on slow networks.

## Updated data
A new pass over PoliMaps' data takes PoliAule from 7 campuses, 36 buildings and 307 rooms to 14, 154 and 350. The Piacenza campus is finally here, along with several secondary campuses, the Casa dello Studente residences across Milan, and many secondary buildings in the existing campuses. Event-only rooms now show on the map too.

## New icons
PoliAule's icons have been redesigned to match the new glass style.

![PoliAule's new icon](media/icon-main.webp) ![PoliAule Beta's new icon](media/icon-beta.webp)
