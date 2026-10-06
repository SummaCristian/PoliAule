---
version: 0.3.0
date: 2026-03-20
channel: beta
title: First UI/UX polish
github: https://github.com/SummaCristian/poliaule/releases/tag/0.3.0
---
- Redesigned the Date picker
- Redesigned the Search button
- Fixed the blur in the Tab bar on Android
<!-- more -->
This release marks the beginning of a broader focus on UI and UX. With the core functionality now implemented and tested, development is shifting toward refining the main user flow, starting with a redesign of its first key components.

## Date picker
The date picker now has a custom inline layout that shows only the days for which data has been fetched. Available dates are clear at a glance, and picking one is faster and more intuitive.

- Today's date is clearly highlighted
- Sundays, when PoliMi is closed, look different
- More emphasis on the day of the week, often more relevant than the exact date
- Unavailable dates are gone, so there's no need to correct a selection after the fact

## Search button
The primary "Search" button has been redesigned to better reflect PoliAule's design system. It's the foundation for primary actions across the app, setting a consistent visual language for future components.

## Bug fixes
- Fixed transparency rendering issues on Android: Google Chrome and Chromium-based browsers now render the UI correctly, while Samsung Internet uses a solid-colour fallback because of its limited CSS support
