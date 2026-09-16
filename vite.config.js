import { defineConfig } from 'vite';

// Cloudflare Pages sets CF_PAGES_BRANCH during the build. Only `dev` ships
// source maps; `main` and `beta` are user-facing and skip them.
const isDevBranch = !process.env.CF_PAGES_BRANCH || process.env.CF_PAGES_BRANCH === 'dev';

export default defineConfig({
  build: {
    sourcemap: isDevBranch,
    target: 'es2020',
    // Lightning CSS (Vite's default CSS minifier) collapses several
    // `backdrop-filter` / `-webkit-backdrop-filter` pairs down to just the
    // prefixed one, leaving blur working only in Safari. esbuild doesn't.
    cssMinify: 'esbuild',
  },
});
