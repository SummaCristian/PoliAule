// The weather right now at a campus, from Open-Meteo (open-meteo.com: free,
// no key, called straight from the browser). Only the campus's coordinates
// are sent, never the user's position. Kept for 15 minutes per place, about
// as often as Open-Meteo's current conditions change.

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const TTL = 15 * 60 * 1000;
const cache = new Map();   // "lat,lng" -> { at, weather } or { at, pending }

export function currentWeather(lat, lng) {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.pending ?? Promise.resolve(hit.weather);
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lng.toFixed(4),
    current: 'weather_code,cloud_cover,rain,showers,snowfall',
  });
  const pending = fetch(`${ENDPOINT}?${params}`)
    .then((res) => {
      if (!res.ok) throw new Error(`Open-Meteo: ${res.status}`);
      return res.json();
    })
    .then(({ current }) => {
      const weather = {
        code: current.weather_code,
        cloudCover: current.cloud_cover ?? 0,
        rain: (current.rain ?? 0) + (current.showers ?? 0),
        snowfall: current.snowfall ?? 0,
      };
      cache.set(key, { at: Date.now(), weather });
      return weather;
    })
    .catch((e) => {
      cache.delete(key);
      throw e;
    });
  cache.set(key, { at: Date.now(), pending });
  return pending;
}

// How hard it's raining or snowing, 0 to 1, from the WMO weather code; a code
// that isn't rain or snow but with some measured still counts as light.
const RAIN_BY_CODE = {
  51: 0.2, 53: 0.3, 55: 0.4,      // drizzle
  56: 0.25, 57: 0.4,              // freezing drizzle
  61: 0.45, 63: 0.65, 65: 0.9,    // rain
  66: 0.45, 67: 0.8,              // freezing rain
  80: 0.5, 81: 0.75, 82: 1,       // showers
  95: 0.9, 96: 1, 99: 1,          // thunderstorms
};
const SNOW_BY_CODE = {
  71: 0.3, 73: 0.55, 75: 0.85,    // snow
  77: 0.25,                       // snow grains
  85: 0.5, 86: 0.85,              // snow showers
};

// What the map shows for a weather: rain and snow (0 to 1) and how overcast
// it is (0 to 1, how much the clouds take from the sun). Below 40% cloud the
// sun's out; fog and anything falling mean a grey sky.
export function skyFromWeather(weather) {
  if (!weather) return { rain: 0, snow: 0, overcast: 0 };
  const { code, cloudCover = 0 } = weather;
  const rain = RAIN_BY_CODE[code] ?? (weather.rain > 0 && !SNOW_BY_CODE[code] ? 0.3 : 0);
  const snow = SNOW_BY_CODE[code] ?? (weather.snowfall > 0 && !RAIN_BY_CODE[code] ? 0.3 : 0);
  let overcast = Math.min(Math.max((cloudCover - 40) / 60, 0), 1) * 0.85;
  if (code === 3) overcast = Math.max(overcast, 0.85);
  if (code === 45 || code === 48) overcast = Math.max(overcast, 0.9);
  if (rain || snow) overcast = Math.max(overcast, 0.8 + 0.2 * Math.max(rain, snow));
  return { rain, snow, overcast };
}
