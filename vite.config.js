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

export default defineConfig({
  build: {
    sourcemap: isDevBranch,
    target: 'es2020',
    // Lightning CSS (Vite's default CSS minifier) collapses several
    // `backdrop-filter` / `-webkit-backdrop-filter` pairs down to just the
    // prefixed one, leaving blur working only in Safari. esbuild doesn't.
    cssMinify: 'esbuild',
  },
  plugins: [minifyPublicCss(['fonts/hugeicons/icons.css'])],
});
