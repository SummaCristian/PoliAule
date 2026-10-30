import { createHash } from 'node:crypto';
import { readFile, appendFile } from 'node:fs/promises';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { changelogPlugin } from './scripts/vite-changelog.js';
import { iconSubset } from './scripts/vite-icon-subset.js';

// Cloudflare Pages sets CF_PAGES_BRANCH during the build. Only `dev` ships
// source maps; `main` and `beta` are user-facing and skip them.
const isDevBranch = !process.env.CF_PAGES_BRANCH || process.env.CF_PAGES_BRANCH === 'dev';

// The splash screen's critical CSS is inlined directly in index.html's <head>
// (see the <style> block there), so first paint no longer needs to wait on
// the app's full stylesheet — Vite bundles every component CSS file into one
// ~170KB/27KB-gzip asset, which on a throttled connection can take seconds
// to arrive. This swaps that bundled <link rel="stylesheet"> for the
// standard "loadCSS" async pattern (load as non-render-blocking via
// media="print", then flip to media="all" once it lands) so it stops being
// render-blocking, with a <noscript> fallback for JS-disabled clients.
//
// data-shell-css + window.__onShellCssLoad (index.html) is the other half of
// this: real content stays out of the layout tree until this tag has
// resolved, so the app doesn't paint unstyled and then reflow into place
// once this lands — that reflow was the single biggest Cumulative Layout
// Shift contributor before this existed. See markShellCssReadyInDev below
// for why index.html's own 19 component-CSS <link> tags don't get this same
// treatment (they stay plain/blocking, dev-only).
function deferMainStylesheet() {
  return {
    name: 'defer-main-stylesheet',
    apply: 'build',
    transformIndexHtml(html, ctx) {
      // 404.html has no __onShellCssLoad: its stylesheets stay as they are
      if (ctx.filename && !ctx.filename.endsWith('/index.html')) return html;
      return html.replace(
        /<link rel="stylesheet" crossorigin href="([^"]+)">/,
        (match, href) =>
          `<link rel="stylesheet" href="${href}" data-shell-css media="print" onload="window.__onShellCssLoad(this)" onerror="window.__onShellCssLoad(this)" crossorigin>` +
          `<noscript><link rel="stylesheet" href="${href}" crossorigin></noscript>`,
      );
    },
  };
}

// Dev-only counterpart to deferMainStylesheet. Real content stays hidden
// (index.html's `:root:not(.css-ready) body > *:not(#splash-overlay)`
// rule) until something adds `.css-ready` to <html> — in production that's
// window.__onShellCssLoad, fired by the deferred stylesheet's onload above.
// In `npm run dev`, index.html's 19 component CSS <link> tags stay plain
// and render-blocking on purpose (giving them the same media="print"
// treatment made Vite stop merging them into one bundle and ship 19
// separate files instead — a real regression, not a style choice). Without
// this, nothing would ever add .css-ready locally and the app would stay
// invisible behind the splash. A plain classic <script> (no type="module",
// no defer/async) placed after those <link> tags is guaranteed by spec to
// wait for them to finish loading before it runs, which — since they're
// still blocking here — means CSS is already fully applied by the time it
// does, so it's always safe to flip the switch immediately.
function markShellCssReadyInDev() {
  return {
    name: 'mark-shell-css-ready-in-dev',
    apply: 'serve',
    transformIndexHtml(html) {
      return html.replace(
        '<!-- JS -->',
        `<script>document.documentElement.classList.add('css-ready');</script>\n\n  <!-- JS -->`,
      );
    },
  };
}

// Content Security Policy for the deployed app, appended to dist/_headers.
//
// escapeHtml() (utils/html.js) is what keeps external data out of the markup;
// this is the second wall, so a missed escape can't run script or send data
// somewhere unexpected. The inline <script>s in index.html and its on*="" attributes
// are allowed by hash, computed here from the built file, so editing one needs
// no policy change and no 'unsafe-inline' for scripts. Styles keep
// 'unsafe-inline': the app sets inline style="" everywhere.
//
// Report-Only for now: violations show in the console and nothing is blocked.
// Switch CSP_HEADER to 'Content-Security-Policy' once a browse through the
// beta deploy (every tab, the Campus map, Info, Settings, a classroom page)
// is clean.
const CSP_HEADER = 'Content-Security-Policy-Report-Only';

// Both APIs are listed on every deployment: beta switches between them at runtime.
const API_HOSTS = 'https://api.poliaule.com https://api-beta.poliaule.com';

function sha256(text) {
  return `'sha256-${createHash('sha256').update(text).digest('base64')}'`;
}

function contentSecurityPolicy(html) {
  const inlineScripts = new Set([...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => sha256(m[1])));
  const handlers = new Set([...html.matchAll(/\son[a-z]+="([^"]*)"/g)].map(m => sha256(m[1])));
  return [
    "default-src 'self'",
    // api.mapbox.com: Mapbox GL JS, loaded on demand by the Campus map
    `script-src 'self' https://api.mapbox.com ${[...inlineScripts].join(' ')}`,
    `script-src-attr 'unsafe-hashes' ${[...handlers].join(' ')}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.mapbox.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    // Photos come from our API; avatars from GitHub; the map's tiles and sprites from Mapbox;
    // polinetwork.org: the favicon on the Info page
    `img-src 'self' data: blob: ${API_HOSTS} https://avatars.githubusercontent.com https://polinetwork.org https://*.mapbox.com`,
    `connect-src 'self' ${API_HOSTS} https://api.github.com https://api.open-meteo.com https://*.mapbox.com`,
    "media-src 'self' blob:",
    // Mapbox GL runs its workers from blob: URLs
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function securityHeaders() {
  let outDir;
  return {
    name: 'security-headers',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    async closeBundle() {
      const html = await readFile(`${outDir}/index.html`, 'utf8');
      await appendFile(`${outDir}/_headers`, `\n/*\n  ${CSP_HEADER}: ${contentSecurityPolicy(html)}\n`);
    },
  };
}

export default defineConfig({
  build: {
    sourcemap: isDevBranch,
    target: 'es2020',
    // Lightning CSS (Vite's default CSS minifier) collapses several
    // `backdrop-filter` / `-webkit-backdrop-filter` pairs down to just the
    // prefixed one, leaving blur working only in Safari. esbuild doesn't.
    cssMinify: 'esbuild',
    // 404.html: Cloudflare Pages serves it, with a 404 status, for any path that isn't a file
    rollupOptions: { input: { main: 'index.html', notFound: '404.html' } },
  },
  plugins: [
    iconSubset(),
    deferMainStylesheet(),
    markShellCssReadyInDev(),
    // changelog/<version>/*.md -> /changelog/*.json + media (see the file)
    changelogPlugin(),
    securityHeaders(),
    // Service worker for offline use (registered from utils/pwa.js). Precaches
    // what the app needs to open, about 2 MB; the big unused PNGs in
    // favicons/ stay out. Of favicons/beta only the info page's icon-*.webp
    // are needed: build-beta.sh copies the rest over main/ before a beta
    // build. Not active under `npm run dev`.
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: false, // index.html already links favicons/main/site.webmanifest
      workbox: {
        globPatterns: [
          'index.html',
          'assets/*.{js,css,png,jpg,svg,webp}',
          'fonts/**/*.{css,woff,woff2}',
          'locales/*.json',
          'favicons/main/{favicon.svg,favicon.ico,favicon-96x96.png,apple-touch-icon.png,logo.webp,icon-*.webp,site.webmanifest,web-app-manifest-*.png}',
          'favicons/beta/icon-*.webp',
          'changelog/index.*.json',
        ],
        // Cormorant Garamond: only the secret message uses it, fetched when
        // shown, then cached (below). The share-preview covers are only for crawlers
        globIgnores: ['fonts/cormorant-garamond/**', 'assets/cover-*.jpg'],
        // Only the app's own address (any query) opens offline; other paths
        // reach the server and its 404 page
        navigateFallback: 'index.html',
        navigateFallbackAllowlist: [/^\/(\?.*)?$/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // A version's long-form page, once opened: kept for offline, and
            // refreshed in the background in case its text was edited
            urlPattern: ({ url }) => /^\/changelog\/[^/]+\.json$/.test(url.pathname),
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'changelog-pages', cacheableResponse: { statuses: [200] } },
          },
          {
            // Its images (videos stream with range requests, so stay out)
            urlPattern: ({ url }) => /^\/changelog\/[^/]+\/media\/.+\.(webp|png|jpe?g|avif|gif|svg)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'changelog-media',
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 120 },
            },
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/fonts/cormorant-garamond/'),
            handler: 'CacheFirst',
            options: { cacheName: 'secret-font', cacheableResponse: { statuses: [200] } },
          },
          {
            // Nunito's stylesheet: show the cached one, refresh it in the background
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-css', cacheableResponse: { statuses: [0, 200] } },
          },
          {
            // The font files it points to are versioned by URL, so never refetched
            urlPattern: ({ url }) => url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-files',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 30, maxAgeSeconds: 365 * 24 * 60 * 60 },
            },
          },
        ],
      },
    }),
  ],
});
