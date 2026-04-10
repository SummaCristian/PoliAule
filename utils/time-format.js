// utils/time-format.js
// Shared time formatting utility that respects the user's 12H/24H preference.

export const STORAGE_KEY = 'poliAule_timeFormat'; // 'system' | '12' | '24'

// Returns the hour12 option for Intl.DateTimeFormat:
//   true  → force 12H
//   false → force 24H
//   undefined → let the browser decide (system default)
export function getHour12Option() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === '12') return true;
  if (saved === '24') return false;
  return undefined;
}

// Creates an Intl.DateTimeFormat instance with the user's time format preference applied.
// Pass extraOptions to override or extend the defaults (hour/minute are set by default).
export function createTimeFormatter(extraOptions = {}) {
  const hour12 = getHour12Option();
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    ...(hour12 !== undefined ? { hour12 } : {}),
    ...extraOptions,
  });
}
