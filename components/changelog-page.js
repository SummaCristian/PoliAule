// The changelog: every version of PoliAule, as an in-app page like Info.
//
//   #changelog            the list: stable releases as cards, the betas that
//                         led to each one under it (hidden by a toggle, which
//                         starts off on poliaule.com and on everywhere else)
//   #changelog/<version>  one version's page: its highlights, then the long
//                         read when the version has one
//
// The content is compiled from changelog/<version>/{en,it}.md at build time
// (scripts/vite-changelog.js) and fetched from /changelog/. Opened over the
// Info page, it covers it and hands it back on close, scroll and all.
import { getLocale, onLanguageSwitch, t } from '../i18n.js';
import { escapeHtml, safeUrl } from '../utils/html.js';
import { springEasing } from '../utils/spring-easing.js';
import { flipLayout } from '../utils/layout-flip.js';
import { IS_PROD, APP_VERSION } from '../utils/env.js';
import { createToggle } from 'vitrium';
import { infoPage } from './info-page.js';
import { markUpdateSeen } from './update-banner.js';

const HASH_RE = /^#changelog(?:\/([\w.-]+))?$/;
const SHOW_BETAS_KEY = 'poliAule_changelogShowBetas';
const GITHUB_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>';

// Expanding and collapsing a version: close to critically damped, no bounce
const PANEL_SPRING = springEasing({ stiffness: 420, damping: 40, mass: 1 });
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

const isChangelogHash = (hash) => HASH_RE.test(hash);
const fmt = (key, vars) => t(key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

function readShowBetas() {
  try {
    const v = localStorage.getItem(SHOW_BETAS_KEY);
    if (v !== null) return v === 'true';
  } catch { /* storage unavailable */ }
  return !IS_PROD;
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat(getLocale(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

const iconFor = (channel, size) =>
  `<img class="cl-icon" src="/favicons/${channel === 'stable' ? 'main' : 'beta'}/icon-128.webp" width="${size}" height="${size}" alt="" draggable="false">`;

// Newest first, as the index comes: each stable release with the betas that
// came before it (back to the previous stable), and the betas newer than the
// latest stable on their own, still in development
function groupEntries(entries) {
  const blocks = [];
  let betas = [];
  for (const e of [...entries].reverse()) {
    if (e.channel === 'beta') { betas.unshift(e); continue; }
    blocks.unshift({ stable: e, betas });
    betas = [];
  }
  return { dev: betas, blocks };
}

class ChangelogPage {
  constructor() {
    this._overlay = null;
    this._tabbar = null;
    this._backBtn = null;
    this._isOpen = false;
    this._overInfo = false;  // opened on top of the Info page, which it covers
    this._cameFromApp = false; // reached by navigating (so Back can history.back())
    this._stack = [];        // changelog hashes visited since it opened
    this._savedScroll = 0;   // the page under it (when not Info)
    this._listScroll = 0;    // the list, while a version's page is open
    this._index = {};        // locale -> Promise<entries>
    this._bodies = {};       // `${version}.${locale}` -> Promise<bodyHtml>
    this._openVersion = null; // the one expanded row (only one at a time)
    this._heroNamed = [];     // elements named for the Info <-> changelog morph
    this._toggle = null;
    this._view = null;       // 'list' | version
  }

  init() {
    this._overlay = document.getElementById('changelog-overlay');
    this._tabbar = document.querySelector('.bn-wrapper');
    this._backBtn = document.getElementById('detail-back-btn');

    // Capture phase, so it runs before the Info and classroom pages' own
    // handlers on the same button and can keep them out of it
    this._backBtn?.addEventListener('click', (e) => {
      if (!this._isOpen) return;
      e.stopImmediatePropagation();
      this._goBack();
    }, { capture: true });

    window.addEventListener('hashchange', () => this._onHashChange());

    onLanguageSwitch(() => {
      if (this._isOpen) this._render({ keepScroll: true });
    });

    this._overlay.addEventListener('click', (e) => this._onClick(e));

    // With no splash (it's gone already), a #changelog link opens right away;
    // otherwise dismissSplash() calls checkHash() once it's done
    if (!document.getElementById('splash-overlay')) this.checkHash();
  }

  checkHash() {
    if (isChangelogHash(location.hash) && !this._isOpen) {
      this._cameFromApp = false;
      this._open();
    }
  }

  _onHashChange() {
    const hash = location.hash;
    if (isChangelogHash(hash)) {
      if (!this._isOpen) {
        this._cameFromApp = true;
        this._open();
      } else {
        this._navigate();
      }
    } else if (this._isOpen) {
      this._close();
    }
  }

  // ── Data ───────────────────────────────────────────────────────────────

  _loadIndex(locale = getLocale()) {
    this._index[locale] ??= fetch(`/changelog/index.${locale}.json`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .catch(err => { delete this._index[locale]; throw err; });
    return this._index[locale];
  }

  _loadBody(version, locale = getLocale()) {
    const key = `${version}.${locale}`;
    this._bodies[key] ??= fetch(`/changelog/${version}.${locale}.json`)
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(d => d.bodyHtml)
      .catch(err => { delete this._bodies[key]; throw err; });
    return this._bodies[key];
  }

  // Resolves with the data, or after `ms` if it's slow: a view transition
  // waits on this for its new state, and shouldn't wait long
  _soon(promise, ms = 250) {
    return Promise.race([promise.catch(() => {}), new Promise(r => setTimeout(r, ms))]);
  }

  _route() {
    const m = location.hash.match(HASH_RE);
    return m?.[1] ?? null;
  }

  // ── Open / close ───────────────────────────────────────────────────────

  _open() {
    const index = this._prepareOpen();
    // From Info, its hero's icon and title morph into the changelog's
    if (this._overInfo) this._nameHero(this._infoHero());
    this._transition(async () => {
      await this._soon(index);
      const info = this._infoHero();
      this._clearHero();
      await this._show();
      if (this._overInfo) this._nameHero(this._changelogHero(info.icon));
    }, () => this._clearHero());
  }

  // A link straight to the changelog: opened inside the splash's own view
  // transition (script.js dismissSplash), so the app under it never shows,
  // and the splash logo lands on the hero's icon (`vtName`)
  async openInSplash(vtName) {
    this._cameFromApp = false;
    await this._soon(this._prepareOpen());
    await this._show();
    // On the list, the front icon: the app you're in
    const icon = this._overlay.querySelector(`.cl-hero-icon--${IS_PROD ? 'main' : 'beta'}, .cl-version-hero .cl-icon`);
    if (icon) icon.style.viewTransitionName = vtName;
  }

  clearSplashName() {
    this._clearMorph();
  }

  get matchesHash() {
    return isChangelogHash(location.hash);
  }

  // State for opening, and the data fetches started; returns the index's
  _prepareOpen() {
    this._isOpen = true;
    this._overInfo = infoPage.isOpen;
    this._stack = [location.hash];
    this._openVersion = null;
    this._view = null;
    if (!this._overInfo) this._savedScroll = window.scrollY;

    const version = this._route();
    if (version) this._loadBody(version).catch(() => {});
    return this._loadIndex();
  }

  async _show() {
    if (this._overInfo) {
      infoPage.cover();
    } else {
      this._tabbar?.classList.add('detail-open');
      document.body.classList.add('info-open');
      this._backBtn?.removeAttribute('hidden');
    }
    this._overlay.removeAttribute('hidden');
    this._overlay.classList.add('visible');
    await this._render();
    window.scrollTo(0, 0);
  }

  _close() {
    this._isOpen = false;
    const overInfo = this._overInfo;
    const backToInfo = overInfo && location.hash === '#info';
    // Info was under it, but the history went somewhere else: Info goes too
    if (overInfo && !backToInfo) infoPage.dismissCovered();
    if (backToInfo) this._nameHero(this._changelogHero(this._infoHero().icon));

    this._transition(() => {
      this._clearHero();
      this._overlay.setAttribute('hidden', '');
      this._overlay.classList.remove('visible');
      this._teardown();
      if (backToInfo) {
        infoPage.uncover();
        this._nameHero(this._infoHero());
      } else {
        document.body.classList.remove('info-open');
        this._tabbar?.classList.remove('detail-open');
        this._backBtn?.setAttribute('hidden', '');
        window.scrollTo(0, overInfo ? 0 : this._savedScroll);
      }
    }, () => this._clearHero());
  }

  // ── Info <-> changelog morph ───────────────────────────────────────────

  _infoHero() {
    const info = document.getElementById('info-page-overlay');
    return { icon: info?.querySelector('.info-hero-icon'), title: info?.querySelector('.info-hero-title') };
  }

  // The changelog's counterparts: on the list, the fanned icon that's the
  // same app as Info's (beta or main), else the version page's icon
  _changelogHero(infoIcon) {
    const beta = /\/beta\//.test(infoIcon?.getAttribute('src') ?? '');
    return {
      icon: this._overlay.querySelector(beta ? '.cl-hero-icon--beta' : '.cl-hero-icon--main')
        ?? this._overlay.querySelector('.cl-version-hero .cl-icon'),
      title: this._overlay.querySelector('.cl-hero-title, .cl-version-title'),
    };
  }

  // Only what's on screen: Info may come back scrolled past its hero
  _nameHero({ icon, title }) {
    for (const [part, el] of [['icon', icon], ['title', title]]) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.height === 0 || r.bottom < 0 || r.top > innerHeight) continue;
      el.style.viewTransitionName = `cl-info-${part}`;
      this._heroNamed.push(el);
    }
  }

  _clearHero() {
    for (const el of this._heroNamed) el.style.viewTransitionName = '';
    this._heroNamed = [];
  }

  // Within the page: the list <-> a version's page. A row morphs into the
  // page it opens (icon, version, title, and its card into the highlights),
  // and those three fly back into it on the way back. The card stays out of
  // the return: Safari snapshots the just-rebuilt row's card cropped to its
  // bullet list, so there it fades with the rest of the page instead.
  _navigate() {
    const hash = location.hash;
    // Back to the previous changelog hash, or forward to a new one
    if (this._stack.at(-2) === hash) this._stack.pop();
    else this._stack.push(hash);

    const version = this._route();
    if (version) this._loadBody(version).catch(() => {});
    const from = this._view;
    if (from === 'list' && version) this._listScroll = window.scrollY;
    // Coming back to the list: the row we left from opens again, to land on
    const back = from && from !== 'list' && !version ? from : null;
    if (back) this._openVersion = back;

    if (from === 'list' && version) this._nameRow(version);
    else if (back) this._namePage({ card: false });

    this._transition(async () => {
      this._clearMorph();
      if (version) await this._soon(this._loadBody(version));
      await this._render();
      window.scrollTo(0, version ? 0 : this._listScroll);
      if (from === 'list' && version) this._namePage();
      else if (back) this._nameRow(back, { card: false });
    }, () => this._clearMorph());
  }

  // view-transition-names for the morph, on a row of the list (only when
  // it's on screen) or on the open version's page
  _nameRow(version, { card = true } = {}) {
    const row = this._overlay.querySelector(`.cl-entry[data-version="${CSS.escape(version)}"]`);
    if (!row) return;
    const r = row.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight) return;
    this._name({
      card: card && row,
      icon: row.querySelector('.cl-icon'),
      version: row.querySelector('.cl-entry-version'),
      title: row.querySelector('.cl-entry-title'),
    });
  }

  _namePage({ card = true } = {}) {
    const page = this._overlay.querySelector('.cl-version-hero')?.parentElement;
    if (!page) return;
    this._name({
      card: card && page.querySelector('.cl-card'),
      icon: page.querySelector('.cl-version-hero .cl-icon'),
      version: page.querySelector('.cl-version-number'),
      title: page.querySelector('.cl-version-title'),
    });
  }

  _name(parts) {
    for (const [part, el] of Object.entries(parts)) {
      if (el) el.style.viewTransitionName = `cl-morph-${part}`;
    }
  }

  _clearMorph() {
    this._overlay.querySelectorAll('[style*="view-transition-name"]').forEach(el => { el.style.viewTransitionName = ''; });
  }

  _goBack() {
    if (this._stack.length > 1 || this._cameFromApp) {
      history.back();
      return;
    }
    // Opened straight from a link: there's nothing of ours to go back to.
    // A version's page steps up to the list, the list closes.
    const base = location.pathname + location.search;
    if (this._route()) {
      history.replaceState(null, '', `${base}#changelog`);
      this._stack = ['#changelog'];
      this._transition(async () => { await this._render(); window.scrollTo(0, 0); });
    } else {
      history.replaceState(null, '', base);
      this._close();
    }
  }

  // The root cross-fade (classroom-detail.css sets its timing), plus any
  // named morph, or a plain swap without View Transitions
  _transition(update, done) {
    if (!document.startViewTransition || reduceMotion.matches) {
      Promise.resolve(update()).finally(() => done?.());
      return;
    }
    const vt = document.startViewTransition(update);
    vt.ready.catch(() => {});
    vt.finished.catch(() => {}).finally(() => done?.());
  }

  _teardown() {
    this._toggle?.destroy?.();
    this._toggle = null;
    this._overlay.innerHTML = '';
    this._view = null;
  }

  // ── Rendering ──────────────────────────────────────────────────────────

  _render({ keepScroll = false } = {}) {
    const y = window.scrollY;
    const version = this._route();
    this._toggle?.destroy?.();
    this._toggle = null;
    this._view = version ?? 'list';

    this._overlay.innerHTML = `
      <div class="info-page cl-page ${IS_PROD ? '' : 'info-page--beta'}">
        <div class="info-backdrop" aria-hidden="true"></div>
        <div class="cl-content" aria-busy="true"></div>
      </div>`;
    const content = this._overlay.querySelector('.cl-content');

    const locale = getLocale();
    return this._loadIndex(locale).then(entries => {
      if (this._view !== (version ?? 'list') || !content.isConnected) return;
      content.removeAttribute('aria-busy');
      if (version) this._renderVersion(content, entries, version, locale);
      else this._renderList(content, entries);
      if (keepScroll) window.scrollTo(0, y);
    }, () => {
      if (!content.isConnected) return;
      content.removeAttribute('aria-busy');
      content.innerHTML = `
        <div class="cl-error">
          <i class="hgi-stroke hgi-wifi-disconnected-01" aria-hidden="true"></i>
          <p>${escapeHtml(t('changelog.loadError'))}</p>
          <button type="button" class="info-pill lg-glass liquid-glass" data-cl-retry>${escapeHtml(t('changelog.retry'))}</button>
        </div>`;
    });
  }

  _renderList(content, entries) {
    const showBetas = readShowBetas();
    const { dev, blocks } = groupEntries(entries);
    const current = APP_VERSION?.version;

    // The newest version you can see starts open
    if (!this._openVersion) {
      const first = (showBetas && dev[0]) || blocks[0]?.stable;
      if (first) this._openVersion = first.version;
    }

    const entry = (e) => {
      const open = this._openVersion === e.version;
      const stable = e.channel === 'stable';
      const id = `cl-panel-${e.version.replace(/\./g, '-')}`;
      // The version this deployment runs
      const here = e.version === current
        ? `<span class="cl-tag">${escapeHtml(t('changelog.current'))}</span>` : '';
      return `
        <article class="cl-entry cl-entry--${stable ? 'stable lg-glass lg-glass--clear' : 'beta'}${open ? ' is-open' : ''}" data-version="${escapeHtml(e.version)}">
          <button type="button" class="cl-entry-head" aria-expanded="${open}" aria-controls="${id}">
            ${iconFor(e.channel, stable ? 44 : 30)}
            <span class="cl-entry-meta">
              <span class="cl-entry-line">
                <span class="cl-entry-version">${escapeHtml(e.version)}</span>
                <span class="cl-badge cl-badge--${e.channel}">${escapeHtml(t(stable ? 'changelog.stable' : 'changelog.beta'))}</span>
                ${here}
              </span>
              <span class="cl-entry-title">${escapeHtml(e.title)}</span>
              <time class="cl-entry-date" datetime="${e.date}">${escapeHtml(formatDate(e.date))}</time>
            </span>
            <i class="hgi-stroke hgi-arrow-down-01 cl-chevron" aria-hidden="true"></i>
          </button>
          <div class="cl-entry-panel" id="${id}" ${open ? '' : 'hidden'}>
            <div class="cl-entry-panel-inner">
            <div class="cl-prose cl-highlights">${e.highlightsHtml}</div>
            ${e.hasMore ? `
            <a class="cl-more info-pill lg-glass liquid-glass" href="#changelog/${escapeHtml(e.version)}">
              <span>${escapeHtml(t('changelog.readMore'))}</span>
              <i class="hgi-stroke hgi-arrow-right-01" aria-hidden="true"></i>
            </a>` : ''}
            </div>
          </div>
        </article>`;
    };

    const betaGroup = (betas, label, mod = '') => betas.length ? `
      <div class="cl-betas ${mod}" data-cl-betas>
        <p class="cl-betas-label">${mod ? '<i class="hgi-stroke hgi-test-tube" aria-hidden="true"></i>' : ''}<span>${escapeHtml(label)}</span></p>
        ${betas.map(entry).join('')}
      </div>` : '';

    const devLabel = dev[0] ? fmt('changelog.inDevelopment', { version: dev[0].version.replace(/^(\d+\.\d+).*/, '$1') }) : '';

    content.innerHTML = `
      <header class="cl-hero">
        <div class="cl-hero-icons${IS_PROD ? '' : ' cl-hero-icons--beta-front'}" aria-hidden="true">
          <img class="cl-hero-icon cl-hero-icon--beta" src="/favicons/beta/icon-128.webp" width="64" height="64" alt="" draggable="false">
          <img class="cl-hero-icon cl-hero-icon--main" src="/favicons/main/icon-128.webp" width="64" height="64" alt="" draggable="false">
        </div>
        <h1 class="cl-hero-title">${escapeHtml(t('changelog.title'))}</h1>
        <p class="cl-hero-subtitle">${escapeHtml(t('changelog.subtitle'))}</p>
      </header>
      <div class="cl-toggle-row lg-glass lg-glass--clear">
        <span class="cl-toggle-text">
          <span class="cl-toggle-title">${escapeHtml(t('changelog.showBetas'))}</span>
          <span class="cl-toggle-desc">${escapeHtml(t('changelog.showBetasDesc'))}</span>
        </span>
        <span class="cl-toggle-slot"></span>
      </div>
      <div class="cl-list${showBetas ? '' : ' cl-list--stable-only'}">
        ${betaGroup(dev, devLabel, 'cl-betas--dev')}
        ${blocks.map(({ stable, betas }) => entry(stable) + betaGroup(betas, fmt('changelog.betasBefore', { version: stable.version }))).join('')}
      </div>`;

    const list = content.querySelector('.cl-list');
    this._setBetasInert(list, showBetas);
    this._toggle = createToggle({
      value: showBetas,
      label: t('changelog.showBetas'),
      color: 'accent',
      onChange: (on) => {
        try { localStorage.setItem(SHOW_BETAS_KEY, String(on)); } catch { /* storage unavailable */ }
        flipLayout(list, '.cl-entry, .cl-betas-label', () => {
          list.classList.toggle('cl-list--stable-only', !on);
          this._setBetasInert(list, on);
        }, { isLeaving: (el) => !on && !!el.closest('[data-cl-betas]') });
      },
    });
    content.querySelector('.cl-toggle-slot').appendChild(this._toggle.el);
    // The whole row flips it; the switch handles its own taps
    content.querySelector('.cl-toggle-row').addEventListener('click', (e) => {
      if (e.target.closest('.lg-toggle')) return;
      e.preventDefault();
      this._toggle.el.click();
    });
  }

  _setBetasInert(list, showBetas) {
    list.querySelectorAll('[data-cl-betas]').forEach(g => { g.inert = !showBetas; });
  }

  _renderVersion(content, entries, version, locale) {
    const e = entries.find(x => x.version === version);
    if (!e) {
      content.innerHTML = `
        <div class="cl-error">
          <i class="hgi-stroke hgi-alert-circle" aria-hidden="true"></i>
          <p>${escapeHtml(fmt('changelog.notFound', { version }))}</p>
          <a class="info-pill lg-glass liquid-glass" href="#changelog">${escapeHtml(t('changelog.title'))}</a>
        </div>`;
      return;
    }
    // The update banner announcing this version has served its purpose
    markUpdateSeen(e.version);
    const stable = e.channel === 'stable';
    const github = e.github && safeUrl(e.github);
    content.innerHTML = `
      <header class="cl-version-hero">
        ${iconFor(e.channel, 72)}
        <p class="cl-version-line">
          <span class="cl-version-number">${escapeHtml(fmt('changelog.versionLabel', { version: e.version }))}</span>
          <span class="cl-badge cl-badge--${e.channel}">${escapeHtml(t(stable ? 'changelog.stable' : 'changelog.beta'))}</span>
        </p>
        <h1 class="cl-version-title">${escapeHtml(e.title)}</h1>
        <time class="cl-entry-date" datetime="${e.date}">${escapeHtml(formatDate(e.date))}</time>
      </header>
      <section class="cl-card lg-glass lg-glass--clear cl-prose cl-highlights">${e.highlightsHtml}</section>
      ${e.hasMore ? '<article class="cl-prose cl-longform" aria-busy="true"><div class="cl-skeleton"></div><div class="cl-skeleton"></div><div class="cl-skeleton cl-skeleton--short"></div></article>' : ''}
      ${github ? `
      <a class="info-pill lg-glass liquid-glass cl-github" href="${escapeHtml(github)}" target="_blank" rel="noopener">
        ${GITHUB_SVG}<span>${escapeHtml(t('changelog.viewOnGitHub'))}</span>
      </a>` : ''}`;

    if (!e.hasMore) return;
    const article = content.querySelector('.cl-longform');
    this._loadBody(version, locale).then(html => {
      if (!article.isConnected) return;
      article.removeAttribute('aria-busy');
      article.innerHTML = html;
    }, () => {
      if (!article.isConnected) return;
      article.removeAttribute('aria-busy');
      article.innerHTML = `
        <div class="cl-error cl-error--inline">
          <p>${escapeHtml(t('changelog.loadError'))}</p>
          <button type="button" class="info-pill lg-glass liquid-glass" data-cl-retry>${escapeHtml(t('changelog.retry'))}</button>
        </div>`;
    });
  }

  // ── Interaction ────────────────────────────────────────────────────────

  _onClick(e) {
    if (e.target.closest('[data-cl-retry]')) {
      this._render({ keepScroll: true });
      return;
    }
    const head = e.target.closest('.cl-entry-head');
    if (head) this._toggleEntry(head.closest('.cl-entry'));
  }

  // Opening a row closes the one that was open, and the row you tapped has
  // to stay in sight through both:
  //  - the closing row above it would pull it up, under the header: the part
  //    of it that would is removed at once, with the page scrolled up by as
  //    much in the same frame (nothing on screen moves), and only the rest
  //    animates closed
  //  - then, if it opens past the bottom of the screen, one smooth scroll
  //    brings it up, never taking its top past the header
  // The scroll is never corrected frame by frame: that jittered on iOS, where
  // scrolling and layout don't land in the same frame.
  _toggleEntry(entry) {
    const open = !entry.classList.contains('is-open');
    const other = open && this._openVersion !== entry.dataset.version
      ? this._overlay.querySelector('.cl-entry.is-open') : null;
    this._openVersion = open ? entry.dataset.version : null;

    const minTop = this._headerBottom() + 12;
    const head = entry.querySelector('.cl-entry-head');
    let headTop = head.getBoundingClientRect().top;

    if (other) {
      const above = !!(other.compareDocumentPosition(entry) & Node.DOCUMENT_POSITION_FOLLOWING);
      const panel = other.querySelector('.cl-entry-panel');
      let trim = 0;
      if (above && !panel.hidden) {
        const r = panel.getBoundingClientRect();
        const offTop = Math.max(0, minTop - r.top); // under the header or above it
        // What may still animate without pushing the tapped row under the header
        const room = Math.max(0, headTop - minTop);
        trim = Math.min(r.height, Math.max(offTop, r.height - room));
        headTop -= r.height - trim;
      }
      this._setEntry(other, false, { trim });
    }
    this._setEntry(entry, open);
    if (!open) return;

    // Where the row will end, once both are done
    const bottom = headTop + head.offsetHeight + entry.querySelector('.cl-entry-panel').scrollHeight;
    const overflow = bottom - (window.innerHeight - 16);
    const by = Math.min(overflow, headTop - minTop);
    if (by > 1) window.scrollTo({ top: window.scrollY + by, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  }

  _headerBottom() {
    const h = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-height'));
    return Number.isFinite(h) ? h : 84;
  }

  _setEntry(entry, open, { trim = 0 } = {}) {
    const panel = entry.querySelector('.cl-entry-panel');
    entry.classList.toggle('is-open', open);
    entry.querySelector('.cl-entry-head').setAttribute('aria-expanded', String(open));

    let from = panel.hidden ? 0 : panel.getBoundingClientRect().height;
    for (const a of panel.getAnimations()) a.cancel();
    panel.hidden = false;
    const to = open ? panel.scrollHeight : 0;

    // Removed at once from its top, with the page scrolled up by as much
    if (trim > 0) {
      from -= trim;
      window.scrollBy(0, -trim);
    }
    if (reduceMotion.matches || (!open && from <= 0)) {
      panel.style.overflow = '';
      panel.hidden = !open;
      return null;
    }
    panel.style.overflow = 'hidden';
    // Clipped from the top, so the part still on screen stays where it is
    panel.scrollTop = open ? 0 : trim;
    const anim = panel.animate(
      { height: [`${from}px`, `${to}px`], opacity: open ? [from ? 1 : 0, 1] : [1, 0] },
      PANEL_SPRING,
    );
    anim.finished.then(() => {
      panel.style.overflow = '';
      panel.scrollTop = 0;
      if (!open) panel.hidden = true;
    }, () => {});
    return anim;
  }
}

export const changelogPage = new ChangelogPage();
