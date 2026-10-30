---
version: 2.1.0-beta1
date: 2026-10-30
channel: beta
title: Favourites on shuffle
---
- Reorder your Favourites: an edit mode, drag to move, and on desktop drag a card or a building straight into them
- New seasonal themes: Easter, Carnevale Ambrosiano, Pi Day, PoliMi's birthday, and Sant'Ambrogio
- Halloween, Christmas, Easter and Carnevale now decorate Settings, the changelog and the other pages too
- A redesigned data status indicator that tells you when a check failed, and the app now looks for new data on its own
- A new "page not found" screen, a lighter icon set, and better SEO and link previews
- Lots of fixes and polish
<!-- more -->
The first beta after 2.0.1, with a bit of everything: a Favourites section you can finally reorder, a calendar full of new holidays, and a lot of work under the hood.

## Reorder your Favourites
Favourites now has an edit mode: remove entries, undo and redo, and drag them around to put them in the order you like. On desktop you can also drag a classroom card, or a building's name, straight into the Favourites to star it exactly where you drop it. If it's already a favourite, it moves instead.

![Editing the Favourites](media/favourites-edit.mp4#loop "Edit mode: drag to reorder, remove, undo and redo")

![Dragging a classroom into the Favourites](media/favourites-drag-card.mp4#loop "Drag a classroom card into the Favourites")

![Dragging a building into the Favourites](media/favourites-drag-building.mp4#loop "Or a building's name")

## New holidays
- **Easter**, from Palm Sunday to Pasquetta: a lilac accent, an egg hidden in one room per campus every day (tap it to crack it open), blossom petals, doves, and 3D eggs and blossoming trees on the Campus map.
- **Carnevale Ambrosiano**, from Giovedì grasso to Sabato grasso: a magenta accent, paper streamers, coriandoli, and a masked room per campus.
- **Pi Day**, on March 14: the πoliAule wordmark, Aula π, the digits of π crossing the screen at 15:14, and a check for how many decimals you know in the search.
- **PoliMi's birthday**, on November 29, with a banner that counts the years.
- **Sant'Ambrogio**, on December 7, has its own banner inside Christmas.

Easter and Carnevale also bring their own logo. Halloween, Christmas, Easter and Carnevale now dress Settings, the changelog and the other secondary pages, too. You can turn all of it off in Settings.

## Data status
The data status indicator has been redesigned. It marks failed checks, the rule for when data counts as out of date has been fixed, and PoliAule now checks for new data by itself when you leave the page open. A first visit with no data no longer gets stuck.

## Under the hood
- A new "page not found" screen, both as a static page and inside the app
- Only the icons PoliAule actually uses are shipped, and Lighthouse's accessibility findings are fixed
- robots.txt, a sitemap, security.txt, cover images and Open Graph tags for shared links
- Sticky headers wait to stick until they can, which works around an iOS Safari issue with its bottom bar
- Updated Vitrium, and the glass now follows its roles and styles
