// Which deployment this is, from the hostname: the production site, the public
// beta, the dev branch, or anything else (localhost, previews). `ENV_LABEL` is
// the header badge's text, null on production.
const host = location.hostname;

export const ENV = host === 'poliaule.com' ? 'prod'
  : host === 'beta.poliaule.com' ? 'beta'
  : host === 'dev.poliaule.com' ? 'dev'
  : 'local';

export const IS_PROD = ENV === 'prod';

export const ENV_LABEL = { prod: null, beta: 'Beta', dev: 'Dev', local: 'Local' }[ENV];

// The version this deployment runs: production ships the newest stable
// release, every other deployment the newest version of all (see
// scripts/vite-changelog.js for where these come from)
export const APP_VERSION = (IS_PROD ? __CHANGELOG_STABLE__ : __CHANGELOG_LATEST__) ?? null;
