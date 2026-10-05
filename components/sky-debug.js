// TEMPORARY: a debug panel for the Campus map's sky (components/map-sky.js),
// to try every weather at any time of day. Shown under `npm run dev` or with
// `?skydebug` in the URL. Light and dark mode follow the system setting.
// To remove: delete this file, its import in campus-map.js, and the `debug`
// bits in map-sky.js.
import { setSkyDebug } from './map-sky.js';

const WEATHERS = [
  ['Live', null],
  ['Clear', { code: 0, cloudCover: 0 }],
  ['Partly cloudy', { code: 2, cloudCover: 60 }],
  ['Mostly cloudy', { code: 2, cloudCover: 85 }],
  ['Overcast', { code: 3, cloudCover: 100 }],
  ['Fog', { code: 45, cloudCover: 100 }],
  ['Drizzle', { code: 53, cloudCover: 100 }],
  ['Rain', { code: 63, cloudCover: 100 }],
  ['Heavy rain', { code: 65, cloudCover: 100 }],
  ['Thunderstorm', { code: 95, cloudCover: 100 }],
  ['Light snow', { code: 71, cloudCover: 100 }],
  ['Heavy snow', { code: 75, cloudCover: 100 }],
];

export function mountSkyDebug() {
  const root = document.createElement('div');
  root.style.cssText = `position: fixed; left: 12px; top: calc(env(safe-area-inset-top) + 76px); z-index: 10000;
    font: 13px/1.3 system-ui, sans-serif; color: #111; text-align: left;`;
  root.innerHTML = `
    <button type="button" data-toggle style="padding: 6px 10px; border-radius: 999px; border: 0;
      background: #ffd54a; color: #111; font: inherit; font-weight: 600; box-shadow: 0 2px 8px #0004;">☀︎ Sky</button>
    <div data-panel style="display: none; margin-top: 6px; padding: 10px; width: 220px; border-radius: 12px;
      background: #fffffff2; box-shadow: 0 4px 16px #0005; gap: 8px;">
      <label style="display: grid; gap: 3px;">Weather
        <select data-weather style="font: inherit;">
          ${WEATHERS.map(([label], i) => `<option value="${i}">${label}</option>`).join('')}
        </select>
      </label>
      <label style="display: flex; gap: 6px; align-items: center;">
        <input type="checkbox" data-live checked> Live time
      </label>
      <label style="display: grid; gap: 3px;">Time <span data-time-label>—</span>
        <input type="range" data-time min="0" max="1439" step="5" value="${new Date().getHours() * 60}" disabled>
      </label>
      <small style="color: #555;">Light/dark: switch the system theme. Rain and snow only fall on the Campus tab.</small>
    </div>`;
  document.body.appendChild(root);

  const $ = (sel) => root.querySelector(sel);
  const panel = $('[data-panel]');
  const weather = $('[data-weather]');
  const live = $('[data-live]');
  const time = $('[data-time]');
  const label = $('[data-time-label]');

  const apply = () => {
    time.disabled = live.checked;
    let at = null;
    if (!live.checked) {
      at = new Date();
      at.setHours(0, Number(time.value), 0, 0);
    }
    const shown = at ?? new Date();
    label.textContent = `${String(shown.getHours()).padStart(2, '0')}:${String(shown.getMinutes()).padStart(2, '0')}${at ? '' : ' (live)'}`;
    setSkyDebug({ weather: WEATHERS[weather.value][1], time: at });
  };

  $('[data-toggle]').addEventListener('click', () => {
    panel.style.display = panel.style.display === 'none' ? 'grid' : 'none';
  });
  weather.addEventListener('change', apply);
  live.addEventListener('change', apply);
  time.addEventListener('input', apply);
  apply();
}
