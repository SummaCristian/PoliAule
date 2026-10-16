// Ships only the Hugeicons glyphs the app uses. The free "stroke-rounded" set
// is 6,200+ icons: a 965 KB font and a 395 KB stylesheet, about half of the page's
// weight, when the app shows ~80 of them. `npm run dev` keeps serving the full
// set from public/fonts/hugeicons/ (add an icon and it just works); the build
// scans the source for `hgi-<name>` classes and replaces the copies in dist/
// with a font and a stylesheet holding only those.
//
// An icon's class must appear in the source as a whole name ("hgi-star"): one
// assembled at run time (`hgi-${x}`) can't be seen, and would render blank.
// The build warns about those, and about names the full set doesn't have.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { transform } from 'esbuild';
import subsetFont from 'subset-font';

const FONT_DIR = 'fonts/hugeicons';
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'graphify-out', 'photos', 'occupancy', 'logs', 'docs', 'fonts']);
const SOURCE_EXT = /\.(js|mjs|html|css|json)$/;
// The base class (which the stylesheet keeps whole) and the font file's name
const NOT_ICONS = new Set(['hgi-stroke', 'hgi-stroke-rounded']);

async function* sourceFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* sourceFiles(join(dir, entry.name));
    } else if (SOURCE_EXT.test(entry.name) && entry.name !== 'vite-icon-subset.js') {
      yield join(dir, entry.name);
    }
  }
}

async function usedIconNames(root) {
  const names = new Set();
  const dynamic = [];
  for await (const file of sourceFiles(root)) {
    const text = await readFile(file, 'utf8');
    for (const [name] of text.matchAll(/hgi-[a-z0-9]+(?:-[a-z0-9]+)*/g)) names.add(name);
    if (/hgi-\$\{|['"]hgi-['"]\s*\+/.test(text)) dynamic.push(file);
  }
  return { names, dynamic };
}

export function iconSubset() {
  let root;
  let outDir;
  return {
    name: 'icon-subset',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      outDir = config.build.outDir;
    },
    // Before vite-plugin-pwa's own closeBundle, which precaches (and hashes)
    // whatever is in dist/ by then
    closeBundle: {
      order: 'pre',
      sequential: true,
      async handler() {
        const css = await readFile(join(root, 'public', FONT_DIR, 'icons.css'), 'utf8');
        const font = await readFile(join(root, 'public', FONT_DIR, 'hgi-stroke-rounded.woff2'));

        const rules = new Map(); // name -> { rule, codepoint }
        const ruleRe = /\.hgi-stroke\.(hgi-[a-z0-9-]+)::before\s*\{\s*content:\s*"\\([0-9a-f]+)";\s*\}/g;
        let firstRule = -1;
        for (const m of css.matchAll(ruleRe)) {
          if (firstRule < 0) firstRule = m.index;
          rules.set(m[1], { rule: m[0], codepoint: parseInt(m[2], 16) });
        }
        if (!rules.size) throw new Error('icon-subset: no icon rules found in icons.css');

        const { names, dynamic } = await usedIconNames(root);
        for (const file of dynamic) console.warn(`icon-subset: ${file} builds an hgi- class at run time; that icon would be missing`);
        const used = [...names].filter(n => !NOT_ICONS.has(n));
        const missing = used.filter(n => !rules.has(n));
        if (missing.length) console.warn(`icon-subset: not in the icon set: ${missing.join(', ')}`);
        const kept = used.filter(n => rules.has(n)).sort();

        const text = String.fromCodePoint(...kept.map(n => rules.get(n).codepoint));
        const subset = await subsetFont(font, text, { targetFormat: 'woff2' });
        const subsetCss = css.slice(0, firstRule) + kept.map(n => rules.get(n).rule).join('\n\n') + '\n';
        const { code } = await transform(subsetCss, { loader: 'css', minify: true, legalComments: 'inline' });

        await writeFile(join(root, outDir, FONT_DIR, 'hgi-stroke-rounded.woff2'), subset);
        await writeFile(join(root, outDir, FONT_DIR, 'icons.css'), code);
        console.log(`icon-subset: ${kept.length} of ${rules.size} icons, font ${(font.length / 1024).toFixed(0)} KB -> ${(subset.length / 1024).toFixed(0)} KB, css ${(css.length / 1024).toFixed(0)} KB -> ${(code.length / 1024).toFixed(1)} KB`);
      },
    },
  };
}
