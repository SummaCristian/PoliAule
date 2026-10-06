// Compiles changelog/<version>/{en,it}.md into the JSON the changelog page
// fetches (components/changelog-page.js), and copies each version's media/.
//
//   /changelog/index.<lang>.json     every version, newest first: its
//                                    frontmatter plus the highlights as HTML
//   /changelog/<version>.<lang>.json { bodyHtml } — only for versions with a
//                                    long-form part after <!-- more -->
//   /changelog/<version>/media/*     copied verbatim
//
// The newest version and the newest stable one are also handed to the app at
// build time (__CHANGELOG_LATEST__ / __CHANGELOG_STABLE__), so the Info page
// shows the version without waiting on a fetch.
//
// The Markdown is ours, but raw HTML in it is still printed as text: the only
// markup that reaches the page is what the renderer below writes.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { Marked } from 'marked';
import { imageSize } from 'image-size';

const ROOT = 'changelog';
const LANGS = ['en', 'it'];
const MORE = '<!-- more -->';
const CHANNELS = new Set(['stable', 'beta']);
const VIDEO_EXT = new Set(['.mp4', '.webm']);
const IMAGE_EXT = new Set(['.webp', '.png', '.jpg', '.jpeg', '.avif', '.gif', '.svg']);
// Callout -> its icon (Hugeicons)
const CALLOUTS = new Map([['NOTE', 'hgi-information-circle'], ['TIP', 'hgi-bulb'], ['WARNING', 'hgi-alert-02']]);
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)(\d+))?$/;

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Newest first. A pre-release sorts before its release (2.0.0-beta9 < 2.0.0)
export function compareVersions(a, b) {
  const pa = a.match(VERSION_RE), pb = b.match(VERSION_RE);
  for (let i = 1; i <= 3; i++) if (+pa[i] !== +pb[i]) return +pb[i] - +pa[i];
  if (!pa[4] !== !pb[4]) return pa[4] ? 1 : -1;
  if (pa[4] !== pb[4]) return pa[4] < pb[4] ? 1 : -1;
  return (+pb[5] || 0) - (+pa[5] || 0);
}

// Flat `key: value` pairs between two `---` lines; `#` starts a comment.
function parseFrontmatter(src, file) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) throw new Error(`${file}: missing frontmatter`);
  const data = {};
  for (const line of m[1].split('\n')) {
    const t = line.replace(/\s+#.*$/, '').trim();
    if (!t) continue;
    const i = t.indexOf(':');
    if (i < 1) throw new Error(`${file}: bad frontmatter line "${line}"`);
    data[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return { data, body: src.slice(m[0].length) };
}

function safeHref(href) {
  if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href) || href.startsWith('#')) return href;
  return null;
}

// Whether an image has transparency, from its header: PNG with an alpha
// colour type or a tRNS chunk, WebP with the alpha flag (extended or
// lossless), and always SVG. Those are shown bare, without the frame,
// rounded corners and shadow screenshots get.
function hasAlpha(buf, ext) {
  if (ext === '.svg') return true;
  if (ext === '.png') {
    if (buf[25] === 4 || buf[25] === 6) return true;
    for (let i = 8; i + 8 <= buf.length;) {
      const len = buf.readUInt32BE(i);
      const type = buf.toString('ascii', i + 4, i + 8);
      if (type === 'tRNS') return true;
      if (type === 'IDAT' || type === 'IEND') return false;
      i += 12 + len;
    }
    return false;
  }
  if (ext === '.webp' && buf.toString('ascii', 0, 4) === 'RIFF') {
    const chunk = buf.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return (buf[20] & 0x10) !== 0;
    if (chunk === 'VP8L') return ((buf.readUInt32LE(21) >>> 28) & 1) === 1;
  }
  return false;
}

function createRenderer(version, dir, file) {
  const mediaUrl = (href) => `/changelog/${version}/${href}`;
  const checkMedia = (href) => {
    if (!/^media\/[\w.-]+$/.test(href)) throw new Error(`${file}: media must live in media/ (got "${href}")`);
    const path = join(dir, href);
    if (!existsSync(path)) throw new Error(`${file}: missing ${href}`);
    return path;
  };

  const figure = ({ href, title, text }) => {
    const path = checkMedia(href);
    const ext = extname(href).toLowerCase();
    const caption = title ? `<figcaption>${esc(title)}</figcaption>` : '';
    if (VIDEO_EXT.has(ext)) {
      const poster = href.replace(/\.\w+$/, '.poster.webp');
      const posterAttr = existsSync(join(dir, poster)) ? ` poster="${mediaUrl(poster)}"` : '';
      return `<figure class="cl-figure cl-figure--video"><video src="${mediaUrl(href)}"${posterAttr} controls playsinline preload="none" aria-label="${esc(text)}"></video>${caption}</figure>`;
    }
    if (!IMAGE_EXT.has(ext)) throw new Error(`${file}: unsupported media type ${href}`);
    const buf = readFileSync(path);
    const { width, height } = imageSize(buf);
    const bare = hasAlpha(buf, ext) ? ' cl-figure--bare' : '';
    return `<figure class="cl-figure${bare}"><img src="${mediaUrl(href)}" alt="${esc(text)}" width="${width}" height="${height}" loading="lazy" decoding="async" draggable="false">${caption}</figure>`;
  };

  const isBlank = (tok) => (tok.type === 'text' && !tok.text.trim()) || tok.type === 'br';

  return {
    // Raw HTML is printed as text
    html: ({ text }) => esc(text),
    image: figure,
    // A paragraph made only of images is a figure, or a row of them
    paragraph({ tokens }) {
      const images = tokens.filter(t => t.type === 'image');
      if (!images.length) return `<p>${this.parser.parseInline(tokens)}</p>\n`;
      if (tokens.some(t => t.type !== 'image' && !isBlank(t))) {
        throw new Error(`${file}: images must be in a paragraph of their own`);
      }
      const figs = images.map(figure).join('');
      return images.length > 1 ? `<div class="cl-gallery">${figs}</div>\n` : `${figs}\n`;
    },
    link({ href, title, tokens }) {
      const url = safeHref(href);
      const inner = this.parser.parseInline(tokens);
      if (!url) throw new Error(`${file}: unsupported link "${href}"`);
      const external = !url.startsWith('#');
      return `<a href="${esc(url)}"${title ? ` title="${esc(title)}"` : ''}${external ? ' target="_blank" rel="noopener"' : ''}>${inner}</a>`;
    },
    // > [!NOTE] / [!TIP] / [!WARNING], as on GitHub
    blockquote({ tokens, callout }) {
      const inner = this.parser.parse(tokens);
      if (!callout) return `<blockquote>${inner}</blockquote>\n`;
      return `<aside class="cl-callout cl-callout--${callout.toLowerCase()} lg-glass lg-glass--tinted lg-glass--clear"><i class="hgi-stroke ${CALLOUTS.get(callout)}" aria-hidden="true"></i>${inner}</aside>\n`;
    },
  };
}

function markCallouts(token) {
  if (token.type !== 'blockquote') return;
  const first = token.tokens?.[0];
  const m = first?.type === 'paragraph' && first.text.match(/^\[!(\w+)\]\s*/);
  if (!m || !CALLOUTS.has(m[1])) return;
  token.callout = m[1];
  first.text = first.text.slice(m[0].length);
  first.tokens = first.tokens.slice();
  const lead = first.tokens[0];
  if (lead?.type === 'text') {
    const rest = lead.text.replace(/^\[!\w+\]\s*/, '');
    first.tokens[0] = { ...lead, raw: rest, text: rest, tokens: undefined };
    if (!rest) first.tokens.shift();
  }
  // The marker's own line leaves an empty paragraph behind when alone
  if (!first.tokens.length) token.tokens = token.tokens.slice(1);
}

function render(md, version, dir, file) {
  const marked = new Marked({ gfm: true, breaks: false });
  marked.use({ renderer: createRenderer(version, dir, file), walkTokens: markCallouts });
  return marked.parse(md).trim();
}

export function buildChangelog(root = ROOT) {
  const versions = readdirSync(root).filter(v => statSync(join(root, v)).isDirectory());
  const entries = { en: [], it: [] };
  const bodies = []; // { version, lang, bodyHtml }
  const media = [];  // { version, name, path }

  for (const version of versions) {
    if (!VERSION_RE.test(version)) throw new Error(`${root}/${version}: not a version`);
    const dir = join(root, version);
    const parsed = {};
    for (const lang of LANGS) {
      const file = join(dir, `${lang}.md`);
      if (!existsSync(file)) throw new Error(`${file}: missing`);
      parsed[lang] = { file, ...parseFrontmatter(readFileSync(file, 'utf8'), file) };
    }

    const meta = parsed.en.data;
    if (meta.version !== version) throw new Error(`${parsed.en.file}: version is "${meta.version}"`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(meta.date ?? '')) throw new Error(`${parsed.en.file}: date must be YYYY-MM-DD`);
    if (!CHANNELS.has(meta.channel)) throw new Error(`${parsed.en.file}: channel must be stable or beta`);
    if (meta.github && !/^https:\/\/github\.com\//.test(meta.github)) throw new Error(`${parsed.en.file}: github must be a GitHub URL`);

    const hasMore = {};
    for (const lang of LANGS) {
      const { file, data, body } = parsed[lang];
      if (lang !== 'en' && data.version !== version) throw new Error(`${file}: version is "${data.version}"`);
      if (!data.title) throw new Error(`${file}: missing title`);
      const [highlights, more = ''] = body.split(MORE);
      if (!highlights.trim()) throw new Error(`${file}: no highlights before ${MORE}`);
      hasMore[lang] = !!more.trim();
      entries[lang].push({
        version,
        date: meta.date,
        channel: meta.channel,
        title: data.title,
        github: meta.github || null,
        highlightsHtml: render(highlights, version, dir, file),
        hasMore: hasMore[lang],
      });
      if (hasMore[lang]) bodies.push({ version, lang, bodyHtml: render(more, version, dir, file) });
    }
    if (hasMore.en !== hasMore.it) throw new Error(`${dir}: only one language has a ${MORE} part`);

    const mediaDir = join(dir, 'media');
    if (existsSync(mediaDir)) {
      for (const name of readdirSync(mediaDir)) media.push({ version, name, path: join(mediaDir, name) });
    }
  }

  for (const lang of LANGS) entries[lang].sort((a, b) => compareVersions(a.version, b.version));

  // With its title in every language, for what shows it without fetching
  // the index (the Info page's version, the update banner)
  const pick = (e) => e && ({
    version: e.version,
    date: e.date,
    channel: e.channel,
    title: Object.fromEntries(LANGS.map(l => [l, entries[l].find(x => x.version === e.version).title])),
  });
  const latest = pick(entries.en[0]);
  const stable = pick(entries.en.find(e => e.channel === 'stable'));
  return { entries, bodies, media, latest, stable };
}

const CONTENT_TYPES = {
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.avif': 'image/avif', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
};

export function changelogPlugin() {
  let built;
  return {
    name: 'poliaule-changelog',
    config() {
      built = buildChangelog();
      return {
        define: {
          __CHANGELOG_LATEST__: JSON.stringify(built.latest),
          __CHANGELOG_STABLE__: JSON.stringify(built.stable),
        },
      };
    },
    // Dev: compiled from source on every request, so edits show on reload
    configureServer(server) {
      server.watcher.add(ROOT);
      server.middlewares.use('/changelog/', (req, res, next) => {
        const path = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '');
        let data;
        try { data = buildChangelog(); } catch (err) { res.statusCode = 500; res.end(String(err.message)); return; }
        const index = path.match(/^index\.(\w+)\.json$/);
        const body = path.match(/^([\w.-]+)\.(\w+)\.json$/);
        const file = path.match(/^([\w.-]+)\/media\/([\w.-]+)$/);
        if (index && data.entries[index[1]]) {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(data.entries[index[1]]));
        } else if (body) {
          const hit = data.bodies.find(b => b.version === body[1] && b.lang === body[2]);
          if (!hit) return next();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ bodyHtml: hit.bodyHtml }));
        } else if (file) {
          const hit = data.media.find(m => m.version === file[1] && m.name === file[2]);
          if (!hit) return next();
          res.setHeader('Content-Type', CONTENT_TYPES[extname(hit.name).toLowerCase()] ?? 'application/octet-stream');
          res.end(readFileSync(hit.path));
        } else {
          next();
        }
      });
    },
    generateBundle() {
      for (const lang of LANGS) {
        this.emitFile({ type: 'asset', fileName: `changelog/index.${lang}.json`, source: JSON.stringify(built.entries[lang]) });
      }
      for (const { version, lang, bodyHtml } of built.bodies) {
        this.emitFile({ type: 'asset', fileName: `changelog/${version}.${lang}.json`, source: JSON.stringify({ bodyHtml }) });
      }
      for (const { version, name, path } of built.media) {
        this.emitFile({ type: 'asset', fileName: `changelog/${version}/media/${name}`, source: readFileSync(path) });
      }
    },
  };
}
