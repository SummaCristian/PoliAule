---
version: 0.8.0
date: 2026-04-16
channel: beta
title: Search tab and classroom details
github: https://github.com/SummaCristian/poliaule/releases/tag/0.8.0
---
- Added the Search tab: find any classroom by browsing campuses and buildings, or with a search bar
- Added the classroom details page: a picture, the number of seats, the features and the full weekly schedule
- Added a splash screen to make the page load smoother
- Added a quick switch between the "From" and "To" time pickers on mobile
- Added a setting to choose which tab opens on startup
- Improved the Available tab
<!-- more -->
One of the biggest releases in PoliAule's history. It finally completes the UI with the long-awaited Search tab and a brand new details page, where you can explore everything PoliAule knows about any classroom in any campus.

Many smaller things have been tweaked, improved or rewritten too: small redesigns, micro-animations, and much more care for the smallest details.

## Time pickers
On mobile, the time pickers now have a button to jump straight from one to the other, without closing and reopening them.

They also limit the selection to between 07:15 and 20:15. Picking a later time automatically moves to the next valid day.

## Splash screen
A splash screen now covers the time it takes to fetch and process the data on load. When everything is ready, PoliAule's logo glides into the header and reveals the UI.

## Default tab
Choose whether PoliAule always opens on a specific tab, Available or Search, or remembers the last one you used.

## Search tab
The Search tab is finally here. It holds a nested list of campuses, their buildings and their classrooms, with their current availability and features, plus a search bar to find any classroom you want. Tap a classroom to open its new details page.

The search looks your query up among classroom, building and campus names. It's also forgiving: since most classroom names look like X.Y.Z, you can type spaces instead of dots.

## Classroom details
A brand new page dedicated to a single classroom, with everything PoliAule knows about it:

- Its picture
- Its current status
- The number of seats, accessible seats and computer workstations
- Its features
- The full schedule for the next 7 days

The schedule adapts to your screen: a single-day view with a familiar date picker on mobile, a full 7-row weekly schedule on desktop.

> [!TIP]
> Although PoliAule runs entirely in your browser, the details page is reached through a **hash** in the URL, like poliaule.com/**#classroom/32**. The part after the `#` is never sent to the server, but PoliAule reads it on load and opens the details of classroom 32 (2.0.1, in this case) straight away.
>
> This means classroom pages **can be shared as links!**

> [!WARNING]
> These URLs may change before the stable release of PoliAule 1.0.0: I'm looking for a way to make them more readable, using classroom names instead of IDs.

## Available tab
The classrooms in the results can now be tapped to open their details page, just like in the Search tab.

The whole results section has been rebuilt almost from scratch. Classroom cards are now rendered lazily, which greatly improves performance on weaker devices, and on powerful phones too during some complex transitions (*cough* Safari *cough*).

> [!WARNING]
> Showing every building expanded is no longer possible. Lazy rendering was needed for good performance on mobile browsers, so now every building starts collapsed, and expanding one collapses the other. This keeps the number of cards on screen under control.
