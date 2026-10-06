---
version: 2.0.0-beta10
date: 2026-10-07
channel: beta
title: Final refinements and last touches
github: https://github.com/SummaCristian/poliaule/pull/38
---
- Improved performance all around the webapp
- Added live weather to the Campus map
- Added the new changelog page
- Fixed some bugs
<!-- more -->

## Performance

Performed several rounds of automated testing to identify all potential sources or lag and reduced them as much as possible.

PoliAule should now smoother even on older devices.

## Live weather in map

The map inside the Campus tab now reflects the current weather forecast for the selected Campus. Rain and Snow are supported with multiple levels of intensity.

The map also shows realistic shadows depending on the time of the day, but only in light mode. Dark mode remains dark.

## Changelog page

Added an entire page dedicated to the current and previous changelogs.

Hey, if you are reading this, you already found it!

Here you will find all the information about what's going on behind the scenes of PoliAule. Enable beta changelogs and you will know what I'm working on before anyone else.

New updates are also highlighted in the Available tab for the first week after release, just to be sure you don't miss anything new.

## Bug fixes

I finally got time to empty my backlog of bugs I had to fix.
This most likely doesn't mean I'm done with all the bugs, it simply means I have fixed all the ones I know of (for now).

Here is a small list of what I have fixed:

- Fixed a bug that caused Google Chrome on Android to crash when a certain combiantion of back navigation events via both PoliAule's buttons and the browser/OS ones were used. I'm still trying to figure out what is the specific problem, but I believe it's Chrome's fault (the renderer crashes XO). In the meantime, no fancy animation when you press the system back button or use the system back gesture
- Settings popup and Campus sheet no longer reach behind the header in a PWA environment
- Safari had once again decided it didn't like the way I was placing the sheet, too close to the bottom safe-area. Now it seems to accept it without turning the safe-area solid
- The debouncing algorithm in search now won't ignore your keystrokes if you type too fast. You are welcome.
- Classrooms whose occupation I couldn't find will not be reported as free anymore. They are now listed as "Not Available" and won't appear as free anywhere at all.

## One more thing

If you reached this far, you deserve a little something.
I have added a few easter eggs here around. Some are small, some are larger. I don't wanna spoil too much, so I'm just gonna say two things: SEASONAL THEMES, and VERY CLOSE. You'll understand.
