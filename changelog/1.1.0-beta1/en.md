---
version: 1.1.0-beta1
date: 2026-05-09
channel: beta
title: Classroom pictures on the cards
github: https://github.com/SummaCristian/poliaule/releases/tag/1.1.0-beta1
---
- Polished animations and transitions for a smoother experience
- Redesigned the classroom cards with the classroom's picture and a more modern layout
<!-- more -->
The very first beta after the stable release. It doesn't bring much, but it brings things I've wanted to get my hands on for a while and had to put on hold to ship 1.0 as soon as possible. Now that it's out, I can finally focus on things I may be the only one caring about, like UI design!

## Polished animations
Every animation and transition in PoliAule has been cleaned up and polished, following [Emil Kowalski's principles for UI animation](https://animations.dev/).

## Classroom cards
Classroom cards now use the classroom's picture as their background. Everything else on them has been adjusted to this new design, with gradients and blur keeping the text legible.

![Classroom cards in the Available tab](media/cards-available.webp "Available tab")

![Classroom cards in the Search tab](media/cards-search.webp "Search tab")

Pictures are fetched by a shared utility that also caches them, and only when the card is about to show up on screen, so there are no performance hiccups, no network congestion, and no suspiciously high traffic hitting Politecnico's servers.
