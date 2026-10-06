---
version: 1.1.0
date: 2026-08-05
channel: stable
title: A new backend
github: https://github.com/SummaCristian/poliaule/releases/tag/1.1.0
---
- Polished animations and transitions for a smoother experience
- Redesigned the classroom cards with the classroom's picture and a more modern layout
- Overhauled the backend: new API URLs, data stored on Cloudflare R2, no more daily commits. PoliAule should be faster, more reliable and more scalable than ever
- Added a new API endpoint with the opening hours and days of campuses and buildings
- Laid the foundation for what's next: the beta can now have its own backend, so new features can be tested without affecting the stable app
<!-- more -->
This release is mostly about the backend. I've been working on a new architecture to make future features simpler to build, so not much changes in how you use PoliAule.

Expect new features soon, though, and keep an eye on PoliAule Beta: with the new backend in place, I can ship backend-based features there without touching the stable release, which means I can finally play with new features and get them to you sooner. Stay tuned!

> [!WARNING]
> All the APIs have moved to new URLs. See the updated `docs/api.md` to learn more.
