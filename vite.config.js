import { readFile, writeFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// Cloudflare Pages sets CF_PAGES_BRANCH during the build. Only `dev` ships
// source maps; `main` and `beta` are user-facing and skip them.
const isDevBranch = !process.env.CF_PAGES_BRANCH || process.env.CF_PAGES_BRANCH === 'dev';

// public/ is copied to dist/ verbatim by Vite (it's not part of the module
// graph), so anything referenced only by absolute path — like the
// self-hosted Hugeicons font CSS — ships unminified unless we minify it
// ourselves post-copy, same as the rest of the CSS.
function minifyPublicCss(paths) {
  let outDir;
  return {
    name: 'minify-public-css',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    async closeBundle() {
      for (const path of paths) {
        const outPath = `${outDir}/${path}`;
        const source = await readFile(outPath, 'utf8');
        const { code } = await transform(source, {
          loader: 'css',
          minify: true,
          legalComments: 'inline',
        });
        await writeFile(outPath, code);
      }
    },
  };
}

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
    transformIndexHtml(html) {
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

export default defineConfig({
  build: {
    sourcemap: isDevBranch,
    target: 'es2020',
    // Lightning CSS (Vite's default CSS minifier) collapses several
    // `backdrop-filter` / `-webkit-backdrop-filter` pairs down to just the
    // prefixed one, leaving blur working only in Safari. esbuild doesn't.
    cssMinify: 'esbuild',
  },
  plugins: [
    minifyPublicCss(['fonts/hugeicons/icons.css']),
    deferMainStylesheet(),
    markShellCssReadyInDev(),
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
        ],
        // Only the secret message uses it: fetched when shown, then cached (below)
        globIgnores: ['fonts/cormorant-garamond/**'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
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
