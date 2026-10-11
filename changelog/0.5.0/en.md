---
version: 0.5.0
date: 2026-03-29
channel: beta
title: New results and a dual-pane desktop layout
github: https://github.com/SummaCristian/poliaule/releases/tag/0.5.0
---
- Redesigned the available classroom results
- Updated the desktop layout into a dual-pane design
- Added classroom features (power sockets, ethernet, projector, etc.)
<!-- more -->
The biggest UI improvement to date. The Campus picker is now the last element of the Available tab still waiting for its redesign, which means the focus will soon shift to the Search tab.

## Results
Available classrooms now have a new, dedicated UI: a list of cards, one per **building**, each working as an accordion. Inside, a list of inner cards shows the individual **classrooms**.

Each classroom shows a time graph with detailed availability inside and around the requested time period, plus icons for the **features** available in that classroom.

## Dual-pane layout
On desktop, where there's enough horizontal space, the Available tab now shows its content in two panes: the form with all its usual fields on the left, the results on the right.

It adapts to mobile devices and narrower desktop windows, turning into a single vertical column when needed.

## Classroom features
Data about classroom features (Dotazioni) now comes from another PoliMi REST API, so PoliAule can show icons for what each classroom offers. Currently supported:

- Projector
- Environmental microphone
- Dimmable lights
- Ethernet port at each seat
- Power outlet at each seat
- Videoconference support
