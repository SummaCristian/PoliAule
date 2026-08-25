// Stable (poliaule.com) always talks to the stable API — no override possible.
// Every other origin (beta.poliaule.com, localhost, etc.) can toggle between
// the beta and stable API via the "Use Beta Backend" setting (default: on).

export const STABLE_API_BASE = 'https://api.poliaule.com';
export const BETA_API_BASE = 'https://api-beta.poliaule.com';

const STABLE_HOSTNAMES = new Set(['poliaule.com', 'www.poliaule.com']);

export const IS_STABLE_BUILD = STABLE_HOSTNAMES.has(location.hostname);

export const USE_BETA_BACKEND_KEY = 'poliAule_useBetaBackend';

export function getApiBase() {
  if (IS_STABLE_BUILD) return STABLE_API_BASE;
  const saved = localStorage.getItem(USE_BETA_BACKEND_KEY);
  const useBeta = saved === null ? true : saved === 'true';
  return useBeta ? BETA_API_BASE : STABLE_API_BASE;
}
