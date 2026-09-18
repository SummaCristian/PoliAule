import { readFile, writeFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { defineConfig } from 'vite';

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
function deferMainStylesheet() {
  return {
    name: 'defer-main-stylesheet',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        /<link rel="stylesheet" crossorigin href="([^"]+)">/,
        (match, href) =>
          `<link rel="stylesheet" href="${href}" media="print" onload="this.media='all'" crossorigin>` +
          `<noscript><link rel="stylesheet" href="${href}" crossorigin></noscript>`,
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
  plugins: [minifyPublicCss(['fonts/hugeicons/icons.css']), deferMainStylesheet()],
});
