---
version: 2.0.0-beta6
date: 2026-09-15
channel: beta
title: The Campus map
github: https://github.com/SummaCristian/poliaule/pull/31
---
- Redesigned the Campus tab
- Added a map showing every building in a campus
- Added an option to turn off the glass effect, for better performance on slower devices
<!-- more -->
## Campus tab and map
The Campus tab has been redesigned from the ground up for a better, more complete experience.

It now features a full-screen map, powered by Mapbox, where you can freely explore the campuses in 3D and see every building and where it is, especially handy in larger campuses like Leonardo or Bovisa.

Next to the map there's a more classic grid of buildings, to quickly find what you're looking for. Use either view, or both together.

Tap a building to see the classrooms inside it.

## Performance
The most expensive effect in PoliAule's take on Liquid Glass is blur. Some GPUs, especially on cheaper devices, and some browsers struggle to compute it in real time, which makes performance terrible when it's used as much as in PoliAule.

Now, the first time PoliAule loads, it runs a hidden benchmark to decide whether your device can handle the full blur. If it can't, PoliAule uses a simpler glass material, more opaque and without blur, which looks similar at a fraction of the cost. You can always override this either way in Settings.

> [!NOTE]
> The benchmark only runs the first time PoliAule loads, and its result is stored in your browser. Browsers keep this storage separate for each (sub)domain, so PoliAule and PoliAule Beta don't share it.
