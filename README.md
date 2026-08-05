<div align="center">
  <img src="./favicons/main/icon-border.png" width="150">
  <h1>PoliAule</h1>

  [![Visit poliaule.com](https://img.shields.io/badge/%F0%9F%8C%90_Visit-poliaule.com-2ecc5a?style=for-the-badge)](https://poliaule.com)

  [![Latest Release](https://img.shields.io/github/v/release/SummaCristian/poliaule?label=Release&color=blue&include_prereleases)](https://github.com/SummaCristian/poliaule/releases/latest)
  [![GitHub Pages](https://img.shields.io/website?url=https%3A%2F%2Fpoliaule.com&label=poliaule.com)](https://poliaule.com)
  [![Fetch Occupancy](https://img.shields.io/github/actions/workflow/status/SummaCristian/poliaule/fetch-occupancy.yml?label=Data+Fetch)](https://github.com/SummaCristian/poliaule/actions/workflows/fetch-occupancy.yml)
</div>

---

**PoliAule** is a web app designed to help students at **Politecnico di Milano** find available classrooms across all campuses quickly, without logging in, and without checking rooms one by one.

Built by students, for students. Because finding a place to study shouldn't be harder than it needs to be.

<br>

<div align="center">
  <table>
    <tr>
      <td align="center" width="240">
        <a href="https://poliaule.com">
          <img src="./favicons/main/icon-border.png" width="72"><br>
          <strong>PoliAule</strong><br>
          <sub>poliaule.com</sub>
        </a>
      </td>
      <td align="center" width="240">
        <a href="https://beta.poliaule.com">
          <img src="./favicons/beta/icon.png" width="72"><br>
          <strong>PoliAule Beta</strong><br>
          <sub>beta.poliaule.com</sub>
        </a>
      </td>
    </tr>
    <tr>
      <td align="center"><sub>Stable · daily use</sub></td>
      <td align="center"><sub>Beta · upcoming features</sub></td>
    </tr>
  </table>
</div>

<br>

## What it does

Pick a campus, a day and a time window, and let PoliAule show you every classroom that's free right now (or later today, or any day in the next 7 days). No account, no app to install, no digging through menus.

The results tell you not just whether a room is free, but also useful details like seat count, power outlets, and whether it's a lab or a lecture hall, so you can find the right spot for what you actually need to do.

A picture of the classroom will also help you avoid unwanted surprises (coff coff 6.0.1)

## How it works

Twice a day, a scheduled job pulls fresh occupancy data from the Politecnico di Milano API and uploads it to Cloudflare R2. When you open PoliAule, the app fetches that data through a small REST API backed by R2, not from Politecnico directly.

This keeps things fast for users and avoids hammering the upstream endpoint with every visit.

```
GitHub Action → Politecnico API → Cloudflare R2 → API Worker → your browser
```

## Features

- **Real-time availability** across all PoliMi campuses and buildings
- **7-day lookahead**: check today or plan ahead for the week
- **Flexible time picker**: set a custom time window, not just fixed slots
- **Room details**: seats, features, pictures, full week schedule and building info at a glance
- **No login required**: open and use, that's it
- **PWA-ready**: installable on mobile and desktop for quick and easy access
- **Dark mode** support
- **Bilingual**: 🇬🇧 English and 🇮🇹 Italian

## Open Source

PoliAule is fully open source under the MIT license. The code, data pipeline, and deployment setup are all in this repository.

Found a bug or have a feature idea? [Open an issue](https://github.com/SummaCristian/poliaule/issues). Want to contribute? Take a look at the open issues or dive into the [docs](./docs/) to get oriented.

## Disclaimer

This project is not affiliated with, endorsed by, or connected to Politecnico di Milano in any way. Use at your own risk.
