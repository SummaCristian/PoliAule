---
version: 1.0.0
date: 2026-05-08
channel: stable
title: PoliAule 1.0 is here
github: https://github.com/SummaCristian/poliaule/releases/tag/1.0.0
---
I'm thrilled to announce the first stable release of PoliAule! It ends the beta period, with the two main features everyone could ask for: searching for free classrooms in every campus, and seeing lots of details about each classroom.

- **Available classrooms**: find the classrooms that are free at any moment in any of Politecnico's campuses
- **Search**: browse every campus, building and classroom, and open any of them
- **Classroom details**: a page with everything known about a classroom: its weekly schedule, seats, features and a picture
- **Installable**: add PoliAule to your phone or computer and open it like an app
- **Italian and English**
- **Customisable**: Settings let you tune almost every part of PoliAule's behaviour
- **Open source**, with a free REST API
<!-- more -->
Compared to 0.9.0 there aren't many new user-facing features: this release fixes some of the last bugs, addresses a few last-minute security issues, and polishes everything, from the UI to the code and documentation.

I hope this tool can be useful to many students out there, and I'm excited to keep improving it. If you have any feedback or suggestions, don't hesitate to reach out or [open an issue on GitHub](https://github.com/SummaCristian/poliaule/issues)!

## Everything in 1.0
- **Available classrooms**: search for the classrooms that are free at any moment in any of Politecnico's campuses, with a query you can tune to your needs and preferences
- **Search**: browse all the campuses, buildings and classrooms, to discover places you maybe didn't know or to reach any classroom you're interested in
- **Classroom details**: a dedicated page with everything known about any classroom, including its weekly schedule, its seat count, its features and even a picture
- **PWA support**: PoliAule is a full *Progressive Web App*, so you can install it on your phone or computer and open it like an app. It works especially well on mobile, give it a try!
- **Two languages**: both Italian and English are supported
- **Customisation**: advanced users can dive into Settings to customise almost any part of PoliAule's behaviour
- **Open source**: anyone can look at the code at any time, and the repository documents the main architectural choices behind PoliAule's development and deployment
- **REST API**: the API built for PoliAule is free for any developer who wants the same data for similar projects. Instead of hitting Politecnico's servers, feel free to use PoliAule's data: see `docs/api.md`
- **XSS protection**: protected against *Cross-Site Scripting*, both in the app and in the REST API
