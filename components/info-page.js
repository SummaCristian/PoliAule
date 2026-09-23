import { onLanguageSwitch, t } from '../i18n.js';
import { escapeHtml, safeUrl } from '../utils/html.js';
import { createSegmentedControl, createPopover } from 'vitrium';

const HASH = '#info';
const GITHUB_REPO = 'SummaCristian/poliaule';
const STATS_CACHE_KEY = 'poliaule_github_stats';
const STATS_CACHE_TTL =  60 * 60 * 1000; // 1 hour

const LANG_COLORS = {
  HTML: '#e34c26',
  CSS: '#563d7c',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  TypeScript: '#3178c6',
  Vue: '#41b883',
  Svelte: '#ff3e00',
  Shell: '#89e051',
  Dockerfile: '#384d54',
};

const APPLE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" class="info-platform-icon"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>';
const ANDROID_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" class="info-platform-icon"><path d="M6 18c0 .55.45 1 1 1h1v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h2v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h1c.55 0 1-.45 1-1V8H6v10zm-2.5-10C2.67 8 2 8.67 2 9.5v7c0 .83.67 1.5 1.5 1.5S5 17.33 5 16.5v-7C5 8.67 4.33 8 3.5 8zm17 0c-.83 0-1.5.67-1.5 1.5v7c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-7c0-.83-.67-1.5-1.5-1.5zm-4.97-5.84 1.3-1.3c.2-.2.2-.51 0-.71-.2-.2-.51-.2-.71 0l-1.48 1.48A6.934 6.934 0 0 0 12 1c-1.1 0-2.15.23-3.09.63L7.43.15c-.2-.2-.51-.2-.71 0-.2.2-.2.51 0 .71l1.3 1.3C6.01 3.07 4.86 5.19 4.86 7.5h14.29c0-2.31-1.15-4.43-3.12-5.84zM10 5H9V4h1v1zm5 0h-1V4h1v1z"/></svg>';
const GITHUB_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>';

// The app icon, right-sized: the 2048px icon.png masters are megabytes, and
// the page never shows the icon above 120 CSS px. `size` is the CSS width.
const ICON_WIDTHS = [128, 256, 384];
const iconSrcset = (variant) => ICON_WIDTHS.map(w => `/favicons/${variant}/icon-${w}.webp ${w}w`).join(', ');
const iconImg = (variant, size, attrs = '') =>
  `<img src="/favicons/${variant}/icon-256.webp" srcset="${iconSrcset(variant)}" sizes="${size}px" width="${size}" height="${size}" draggable="false" alt="" ${attrs}>`;

// Which install instructions to open on: the device's own platform.
function detectPlatform() {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

class InfoPage {
  constructor() {
    this._overlay = null;
    this._tabbar = null;
    this._backBtn = null;
    this._logoEl = null;
    this._titleEl = null;
    this._badgeEl = null;
    this._isOpen = false;
    this._openedFromDetail = false;
    this._showBadge = false;
    this._cachedStats = null;
    this._savedScrollPos = 0;
    this._pwaControl = null;
    this._starPopover = null;
    this._revealObserver = null;
    this._reflowObserver = null;
  }

  init() {
    this._overlay = document.getElementById('info-page-overlay');
    this._tabbar = document.querySelector('.bn-wrapper');
    this._backBtn = document.getElementById('detail-back-btn');
    this._logoEl = document.querySelector('.header-logo');
    this._titleEl = document.querySelector('.header-title');
    this._badgeEl = document.getElementById('env-badge');

    document.getElementById('info-trigger')?.addEventListener('click', () => {
      location.hash = HASH;
    });

    // Use stopImmediatePropagation to prevent classroomDetail's listener (on the same button)
    // from also firing when info is open — that would trigger a second concurrent VT.
    this._backBtn?.addEventListener('click', (e) => {
      if (!this._isOpen) return;
      e.stopImmediatePropagation();
      if (this._openedFromDetail) {
        // Go back to the classroom hash; hashchange will trigger _silentClose() here
        // and classroomDetail._onHashChange() will run its own VT to reopen the detail.
        history.back();
      } else {
        history.replaceState(null, '', window.location.pathname + window.location.search);
        this._doClose();
      }
    });

    window.addEventListener('hashchange', () => this._onHashChange());

    onLanguageSwitch(() => {
      if (this._isOpen) this._renderContent(this._showBadge);
    });

    this._warmIcons();

    // If the splash is still present, dismissSplash() will call checkHash() after
    // the VT completes. Only open immediately if splash is already gone.
    if (!document.getElementById('splash-overlay')) {
      this.checkHash();
    }
  }

  // Fetches and decodes the icons in idle time after start-up, so opening the
  // page (usually well after) finds them in the image cache, ready to paint.
  _warmIcons() {
    // Both variants (hero and badges) at both sizes: the browser picks the
    // same srcset candidate here as it will on the page.
    const warm = () => {
      for (const variant of ['main', 'beta']) {
        for (const size of [120, 56]) {
          const img = new Image();
          img.sizes = `${size}px`;
          img.srcset = iconSrcset(variant);
          img.decode().catch(() => {});
        }
      }
    };
    if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 3000 });
    else setTimeout(warm, 1500);
  }

  // Resolves when the hero icon can paint, or after `cap` ms at most so a slow
  // network never holds the transition up.
  _heroReady(img, cap = 200) {
    if (!img || (img.complete && img.naturalWidth)) return Promise.resolve();
    return Promise.race([
      img.decode().catch(() => {}),
      new Promise(resolve => setTimeout(resolve, cap)),
    ]);
  }

  // Called by dismissSplash() after the splash VT finishes (normal case),
  // and also handles direct navigation after page load.
  checkHash() {
    if (location.hash === HASH && !this._isOpen) this._doOpen();
  }

  _onHashChange() {
    if (location.hash === HASH) {
      if (!this._isOpen) this._doOpen();
    } else if (this._isOpen) {
      if (/^#classroom\//.test(location.hash)) {
        // Just update state — classroomDetail._doOpen() will incorporate the info close
        // into its own VT (hero → header logo morph). Don't touch the DOM here.
        this._isOpen = false;
        this._openedFromDetail = false;
      } else {
        this._doClose();
      }
    }
  }

  // Apply the open state inside an already-running VT (called from dismissSplash).
  // iconVtName is the view-transition-name to assign to the hero icon so it
  // acts as the NEW-state destination for the splash logo morph.
  _applyOpenState(iconVtName) {
    if (!this._overlay) return;
    this._isOpen = true;
    const showBadge = this._badgeEl?.hidden === false;

    this._tabbar?.classList.add('detail-open');
    document.body.classList.add('info-open');
    this._overlay.removeAttribute('hidden');
    this._renderContent(showBadge);
    this._overlay.classList.add('visible');
    if (this._backBtn) this._backBtn.removeAttribute('hidden');

    const heroIcon  = this._overlay.querySelector('.info-hero-icon');
    const heroTitle = this._overlay.querySelector('.info-hero-title');
    const heroBadge = this._overlay.querySelector('.info-hero-badge');
    if (heroIcon)  heroIcon.style.viewTransitionName  = iconVtName;
    if (heroTitle) heroTitle.style.viewTransitionName = 'info-title';
    if (heroBadge) heroBadge.style.viewTransitionName = 'info-badge';
  }

  _doOpen() {
    if (!this._overlay) return;
    this._isOpen = true;

    // Save scroll position for when we return
    this._savedScrollPos = window.scrollY;

    const logoEl = this._logoEl;
    const titleEl = this._titleEl;
    const badgeEl = this._badgeEl?.hidden === false ? this._badgeEl : null;
    const showBadge = !!badgeEl;
    // When navigating from the detail page, the back button is already visible —
    // info's own hero elements still need to morph in, but the tabbar stays untouched.
    const fromDetail = this._backBtn != null && !this._backBtn.hidden;
    this._openedFromDetail = fromDetail;

    if (document.startViewTransition) {
      if (logoEl) logoEl.style.viewTransitionName = 'info-logo';
      if (titleEl) titleEl.style.viewTransitionName = 'info-title';
      if (badgeEl) {
        badgeEl.style.lineHeight = '1'; // override line-height: 0 so VT has a non-zero bounding box
        badgeEl.style.viewTransitionName = 'info-badge';
      }

      const vt = document.startViewTransition(() => {
        if (logoEl) logoEl.style.viewTransitionName = '';
        if (titleEl) titleEl.style.viewTransitionName = '';
        if (badgeEl) {
          badgeEl.style.lineHeight = '';
          badgeEl.style.viewTransitionName = '';
        }

        this._tabbar?.classList.add('detail-open');
        document.body.classList.add('info-open');
        this._overlay.removeAttribute('hidden');
        this._renderContent(showBadge);
        this._overlay.classList.add('visible');
        if (this._backBtn) this._backBtn.removeAttribute('hidden');

        // Reset scroll for the new view
        window.scrollTo(0, 0);

        const heroIcon = this._overlay.querySelector('.info-hero-icon');
        const heroTitle = this._overlay.querySelector('.info-hero-title');
        const heroBadge = this._overlay.querySelector('.info-hero-badge');
        if (heroIcon) heroIcon.style.viewTransitionName = 'info-logo';
        if (heroTitle) heroTitle.style.viewTransitionName = 'info-title';
        if (heroBadge) heroBadge.style.viewTransitionName = 'info-badge';

        // The new state is snapshotted once this resolves: give the icon a
        // moment to decode, so the logo morphs into it rather than into an
        // empty box.
        return this._heroReady(heroIcon);
      });

      // A second VT firing before this one settles rejects .ready/.finished with
      // InvalidStateError; .finished is handled below, but .ready isn't awaited
      // anywhere, so it was surfacing as an unhandled rejection on every abort.
      vt.ready.catch(() => {});
      vt.finished.then(() => this._clearVtNames()).catch(() => this._clearVtNames());
    } else {
      this._tabbar?.classList.add('detail-open');
      document.body.classList.add('info-open');
      this._overlay.removeAttribute('hidden');
      this._renderContent(showBadge);
      this._overlay.classList.add('visible');
      if (this._backBtn) this._backBtn.removeAttribute('hidden');

      // Reset scroll for the new view
      window.scrollTo(0, 0);
    }
  }

  _doClose() {
    if (!this._overlay || this._overlay.hidden) return;
    this._isOpen = false;

    const logoEl = this._logoEl;
    const titleEl = this._titleEl;
    const badgeEl = this._badgeEl?.hidden === false ? this._badgeEl : null;
    const heroIcon = this._overlay.querySelector('.info-hero-icon');
    const heroTitle = this._overlay.querySelector('.info-hero-title');
    const heroBadge = this._overlay.querySelector('.info-hero-badge');

    const cleanup = () => {
      this._teardown();
      this._overlay.innerHTML = '';
      this._clearVtNames();
      if (logoEl) logoEl.style.viewTransitionName = '';
      if (titleEl) titleEl.style.viewTransitionName = '';
      if (badgeEl) {
        badgeEl.style.lineHeight = '';
        badgeEl.style.viewTransitionName = '';
      }
    };

    if (document.startViewTransition) {
      if (heroIcon) heroIcon.style.viewTransitionName = 'info-logo';
      if (heroTitle) heroTitle.style.viewTransitionName = 'info-title';
      if (heroBadge) heroBadge.style.viewTransitionName = 'info-badge';

      const vt = document.startViewTransition(() => {
        if (heroIcon) heroIcon.style.viewTransitionName = '';
        if (heroTitle) heroTitle.style.viewTransitionName = '';
        if (heroBadge) heroBadge.style.viewTransitionName = '';

        document.body.classList.remove('info-open');
        this._overlay.setAttribute('hidden', '');
        this._overlay.classList.remove('visible');
        if (this._backBtn) this._backBtn.setAttribute('hidden', '');

        this._tabbar?.classList.remove('detail-open');

        if (logoEl) logoEl.style.viewTransitionName = 'info-logo';
        if (titleEl) titleEl.style.viewTransitionName = 'info-title';
        if (badgeEl) {
          badgeEl.style.lineHeight = '1'; // override line-height: 0 so VT has a non-zero bounding box
          badgeEl.style.viewTransitionName = 'info-badge';
        }

        // Restore scroll position so VT can morph back to the correct spot
        window.scrollTo(0, this._savedScrollPos);
      });

      vt.ready.catch(() => {});
      vt.finished.then(cleanup).catch(cleanup);
    } else {
      this._overlay.classList.remove('visible');
      this._tabbar?.classList.remove('detail-open');
      if (this._backBtn) this._backBtn.setAttribute('hidden', '');
      const hide = () => {
        document.body.classList.remove('info-open');
        this._overlay.setAttribute('hidden', '');
        cleanup();
      };
      this._overlay.addEventListener('transitionend', hide, { once: true });
      setTimeout(hide, 300);
    }
  }

  // Called by classroomDetail._doOpen() BEFORE the VT snapshot (OLD state):
  // names the info hero elements so they're captured for the morph.
  _prepareReturnVT() {
    const heroIcon  = this._overlay?.querySelector('.info-hero-icon');
    const heroTitle = this._overlay?.querySelector('.info-hero-title');
    const heroBadge = this._overlay?.querySelector('.info-hero-badge');
    if (heroIcon)  heroIcon.style.viewTransitionName  = 'info-logo';
    if (heroTitle) heroTitle.style.viewTransitionName = 'info-title';
    if (heroBadge) heroBadge.style.viewTransitionName = 'info-badge';
  }

  // Called by classroomDetail._doOpen() INSIDE the VT callback (NEW state):
  // closes the info overlay and names the header elements as morph targets.
  _applyReturnVT() {
    document.body.classList.remove('info-open');
    if (this._overlay) {
      this._overlay.setAttribute('hidden', '');
      this._overlay.classList.remove('visible');
      this._teardown();
      this._overlay.innerHTML = '';
    }
    if (this._logoEl)  this._logoEl.style.viewTransitionName  = 'info-logo';
    if (this._titleEl) this._titleEl.style.viewTransitionName = 'info-title';
    const badgeEl = this._badgeEl?.hidden === false ? this._badgeEl : null;
    if (badgeEl) {
      badgeEl.style.lineHeight = '1';
      badgeEl.style.viewTransitionName = 'info-badge';
    }
  }

  // Called by classroomDetail._doOpen() AFTER the VT finishes: clears header VT names.
  _cleanupReturnVT() {
    if (this._logoEl)  this._logoEl.style.viewTransitionName  = '';
    if (this._titleEl) this._titleEl.style.viewTransitionName = '';
    if (this._badgeEl) { this._badgeEl.style.lineHeight = ''; this._badgeEl.style.viewTransitionName = ''; }
  }

  _clearVtNames() {
    const heroIcon = this._overlay?.querySelector('.info-hero-icon');
    const heroTitle = this._overlay?.querySelector('.info-hero-title');
    const heroBadge = this._overlay?.querySelector('.info-hero-badge');
    if (heroIcon) heroIcon.style.viewTransitionName = '';
    if (heroTitle) heroTitle.style.viewTransitionName = '';
    if (heroBadge) heroBadge.style.viewTransitionName = '';
  }

  _renderContent(showBadge) {
    this._showBadge = showBadge;
    this._teardown();
    const badgeText = this._badgeEl?.textContent ?? '';
    const variant = showBadge ? 'beta' : 'main';
    const platform = detectPlatform();
    const steps = (key, n) => Array.from({ length: n }, (_, i) => `<li>${t(`info.pwa.${key}.step${i + 1}`)}</li>`).join('');

    this._overlay.innerHTML = `
      <div class="info-page ${showBadge ? 'info-page--beta' : ''}">
        <div class="info-backdrop" aria-hidden="true"></div>

        <!-- Hero section -->
        <div class="info-hero">
          <div class="info-hero-icon-wrap">
            ${iconImg(variant, 120, 'class="info-hero-glow" aria-hidden="true"')}
            ${iconImg(variant, 120, 'class="info-hero-icon" fetchpriority="high"')}
          </div>
          <h1 class="info-hero-title">PoliAule</h1>
          <!-- 'Beta' or 'Local' badge if necessary -->
          ${showBadge ? `<h4 class="info-hero-badge secondary">${badgeText}</h4>` : ''}
        </div>

        <!-- The two sites, as big glass badges -->
        <div class="badge-container">
          <a href="https://poliaule.com" target="_blank" rel="noopener" class="info-badge info-badge--stable liquid-glass">
            ${iconImg('main', 56)}
            <span class="badge-text">
              <span class="top-text">poliaule.com</span>
              <span class="bottom-text">${t('info.aboutMe.website')}</span>
              <span class="badge-description">${t('info.badge.stableDesc')}</span>
            </span>
          </a>
          <a href="https://beta.poliaule.com" target="_blank" rel="noopener" class="info-badge info-badge--beta liquid-glass">
            ${iconImg('beta', 56)}
            <span class="badge-text">
              <span class="top-text">beta.poliaule.com</span>
              <span class="bottom-text">${t('info.aboutMe.beta')}</span>
              <span class="badge-description">${t('info.badge.betaDesc')}</span>
            </span>
            <span class="badge-label">BETA</span>
          </a>
        </div>

        <!-- Body: glass cards, a masonry of two columns on desktop -->
        <div class="info-content">
          <section class="info-section info-intro">
            <h2 class="info-section-title">${t('info.about.title')}</h2>
            <div class="info-prose">
              <p>${t('info.body.intro')}</p>
              <p>${t('info.body.parag1')}</p>
            </div>
            <div class="info-meta">
              <a href="https://polinetwork.org/it/projects/" target="_blank" rel="noopener" class="info-pill info-pill--polinetwork lg-glass liquid-glass">
                <img src="https://polinetwork.org/favicon.ico" alt="" draggable="false">
                <span>${t('info.polinetwork')}</span>
              </a>
              <p class="info-disclaimer">${t('footer.disclaimer5')}</p>
            </div>
          </section>

          <section class="info-section info-pwa">
            <h2 class="info-section-title">${t('info.pwa.title')}</h2>
            <p class="info-section-subtitle">${t('info.pwa.subtitle')}</p>
            <div class="info-pwa-switch">
              <button type="button" class="lg-seg__item" data-value="ios">${APPLE_SVG}<span>iPhone</span></button>
              <button type="button" class="lg-seg__item" data-value="android">${ANDROID_SVG}<span>Android</span></button>
              <button type="button" class="lg-seg__item" data-value="desktop"><i class="hgi-stroke hgi-computer" aria-hidden="true"></i><span>Desktop</span></button>
            </div>
            <div class="info-pwa-panels">
              <div class="info-pwa-panel" data-pwa-platform="ios">
                <p class="info-pwa-panel-title">${t('info.pwa.ios.title')}</p>
                <ol class="info-steps">${steps('ios', 4)}</ol>
              </div>
              <div class="info-pwa-panel" data-pwa-platform="android">
                <p class="info-pwa-panel-title">${t('info.pwa.android.title')}</p>
                <ol class="info-steps">${steps('android', 4)}</ol>
              </div>
              <div class="info-pwa-panel" data-pwa-platform="desktop">
                <p class="info-pwa-panel-title">${t('info.pwa.desktop.title')}</p>
                <ol class="info-steps">${steps('desktop', 3)}</ol>
              </div>
            </div>
          </section>

          <section class="info-section about-me-section">
            <h2 class="info-section-title">${t('info.aboutMe.title')}</h2>
            <div class="about-me-container">
              <img src="/assets/profile.jpg" alt="Profile picture of Cristian Summa" class="about-me-photo" draggable="false">
              <div class="about-me-bubbles">
                <p class="message-bubble">${t('info.aboutMe.parag1')}</p>
                <p class="message-bubble">${t('info.aboutMe.parag2')}</p>
                <p class="message-bubble">${t('info.aboutMe.parag3')}</p>
                <div class="typing-indicator message-bubble">
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </div>
          </section>

          <section class="info-section github-stats-section">
            <div class="info-section-header">
              <h2 class="info-section-title">${t('info.github.title')}</h2>
              <a href="https://github.com/${GITHUB_REPO}" target="_blank" rel="noopener" class="info-pill lg-glass liquid-glass">
                ${GITHUB_SVG}
                <span>GitHub</span>
              </a>
            </div>
            <div class="github-stats-grid">
              <a href="https://github.com/${GITHUB_REPO}/stargazers" target="_blank" rel="noopener" class="github-stat-card lg-glass liquid-glass">
                <span class="star-avatars" data-github="stargazers">
                  <i class="hgi-stroke hgi-star github-stat-icon" aria-hidden="true"></i>
                </span>
                <span class="github-stat-number" data-stat="stars">—</span>
                <span class="github-stat-label">${t('info.github.stars')}</span>
              </a>
              <a href="https://github.com/${GITHUB_REPO}/commits/main" target="_blank" rel="noopener" class="github-stat-card lg-glass liquid-glass">
                <i class="hgi-stroke hgi-git-commit github-stat-icon" aria-hidden="true"></i>
                <span class="github-stat-number" data-stat="commits">—</span>
                <span class="github-stat-label">${t('info.github.commits')}</span>
              </a>
              <a href="https://github.com/${GITHUB_REPO}/issues" target="_blank" rel="noopener" class="github-stat-card lg-glass liquid-glass">
                <i class="hgi-stroke hgi-bug-01 github-stat-icon" aria-hidden="true"></i>
                <span class="github-stat-number" data-stat="issues">—</span>
                <span class="github-stat-label">${t('info.github.issues')}</span>
              </a>
              <a href="https://github.com/${GITHUB_REPO}/blob/main/LICENSE" target="_blank" rel="noopener" class="github-stat-card lg-glass liquid-glass">
                <i class="hgi-stroke hgi-balance-scale github-stat-icon" aria-hidden="true"></i>
                <span class="github-stat-number" data-stat="license">—</span>
                <span class="github-stat-label">${t('info.github.license')}</span>
              </a>
            </div>

            <div class="github-subsection">
              <h3 class="github-subsection-title">${t('info.github.languages')}</h3>
              <div data-github="lang-bar"><div class="github-skeleton" style="height:2rem"></div></div>
            </div>
            <div class="github-subsection">
              <h3 class="github-subsection-title">${t('info.github.contributors')}</h3>
              <div data-github="contributors"><div class="github-skeleton" style="height:2.75rem"></div></div>
            </div>

            <a href="https://github.com/${GITHUB_REPO}/issues/new" target="_blank" rel="noopener" class="info-pill info-pill--issue lg-glass liquid-glass">
              <i class="hgi-stroke hgi-bug-01" aria-hidden="true"></i>
              <span>${t('info.github.createIssue')}</span>
            </a>
          </section>
        </div>
      </div>
    `;

    // Normally the icon is already decoded (see _warmIcons / _heroReady). If it
    // isn't — a cold cache on a slow network — it fades in over its
    // placeholder instead of popping in.
    const heroIcon = this._overlay.querySelector('.info-hero-icon');
    if (!heroIcon.complete) {
      const wrap = heroIcon.parentElement;
      wrap.classList.add('is-loading');
      const done = () => wrap.classList.remove('is-loading');
      heroIcon.addEventListener('load', done, { once: true });
      heroIcon.addEventListener('error', done, { once: true });
    }

    // Install instructions: a Vitrium segmented control picks the platform,
    // starting on the one this device is. The panels share one grid cell, so
    // the card is always as tall as the longest and never jumps on a switch.
    const pwaSwitch = this._overlay.querySelector('.info-pwa-switch');
    const showPanel = (value) => {
      this._overlay.querySelectorAll('.info-pwa-panel').forEach(panel => {
        const active = panel.dataset.pwaPlatform === value;
        panel.classList.toggle('active', active);
        panel.inert = !active;
      });
    };
    this._pwaControl = createSegmentedControl(pwaSwitch, {
      value: platform,
      selectedColor: 'accent',
      onSelect: showPanel,
    });
    showPanel(platform);

    // The chat bubbles grow into place one at a time, so reserve their final
    // height up front — otherwise every card below would shift as they arrive.
    const aboutMeSection = this._overlay.querySelector('.about-me-section');
    const allBubbles = aboutMeSection.querySelectorAll('.message-bubble:not(.typing-indicator)');
    allBubbles.forEach(b => {
      b.style.maxHeight = '500px';
      b.style.paddingTop = '0.7rem';
      b.style.paddingBottom = '0.7rem';
    });
    aboutMeSection.style.minHeight = `${aboutMeSection.offsetHeight}px`;
    allBubbles.forEach(b => { b.style.cssText = ''; });

    // Each card rises in as it scrolls into view (the ones already on screen
    // right away, in order); the about-me card's chat plays from the same class.
    const sections = [...this._overlay.querySelectorAll('.info-section')];
    this._revealObserver = new IntersectionObserver((entries) => {
      let order = 0;
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.style.setProperty('--reveal-i', order++);
        entry.target.classList.add('is-visible');
        this._revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.05 });
    sections.forEach(s => this._revealObserver.observe(s));

    // Stargazer names: one glass tooltip, re-anchored to whichever avatar is hovered.
    this._starPopover = createPopover({ placement: 'top', role: 'tooltip', dismissable: false, deform: false });
    const statsGrid = this._overlay.querySelector('.github-stats-grid');
    statsGrid.addEventListener('pointerover', (e) => {
      if (e.pointerType !== 'mouse') return;
      const avatar = e.target.closest?.('.star-avatar');
      if (!avatar) return;
      this._starPopover.setContent(`<span class="info-star-tip">${escapeHtml(avatar.dataset.login)}</span>`);
      this._starPopover.show(avatar);
    });
    statsGrid.addEventListener('pointerout', (e) => {
      if (!e.target.closest?.('.star-avatar')) return;
      if (e.relatedTarget?.closest?.('.star-avatar') === e.target.closest('.star-avatar')) return;
      this._starPopover.hide();
    });

    this._animateMasonry(this._overlay.querySelector('.info-content'));
    this._fetchGithubStats();
  }

  // Drops everything the last render hooked up outside its own markup: the
  // tooltip lives on <body>, and the observers would otherwise keep the old
  // cards alive.
  _teardown() {
    this._pwaControl?.destroy();
    this._pwaControl = null;
    this._starPopover?.destroy();
    this._starPopover = null;
    this._revealObserver?.disconnect();
    this._revealObserver = null;
    this._reflowObserver?.disconnect();
    this._reflowObserver = null;
  }

  /**
   * FLIP-animates the masonry cards when a resize moves them to the other
   * column (same technique as classroom-detail.js _animateReflow): each
   * ResizeObserver tick slides every card from where it visually was to its
   * new spot.
   */
  _animateMasonry(container) {
    if (!container || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const items = [...container.querySelectorAll(':scope > .info-section')];
    const measure = () => new Map(items.map(el => {
      const r = el.getBoundingClientRect();
      const m = new DOMMatrix(getComputedStyle(el).transform);
      return [el, { x: r.left - m.e, y: r.top - m.f, tx: m.e, ty: m.f }];
    }));

    let prev = null;
    this._reflowObserver = new ResizeObserver(() => {
      const cur = measure();
      if (prev) {
        for (const el of items) {
          const a = prev.get(el), b = cur.get(el);
          const dx = a.x + b.tx - b.x;
          const dy = a.y + b.ty - b.y;
          if (Math.abs(dx - b.tx) < 1 && Math.abs(dy - b.ty) < 1) continue;
          el.getAnimations().filter(an => an.id === 'reflow').forEach(an => an.cancel());
          const anim = el.animate(
            [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
            { duration: 350, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
          );
          anim.id = 'reflow';
        }
      }
      prev = measure();
    });
    this._reflowObserver.observe(container);
  }

  async _fetchGithubStats() {
    // In-memory cache (complete) — instant return for language-switch re-renders.
    const c = this._cachedStats;
    if (c?.repo && c?.langs && c?.contributors) {
      this._applyGithubStats(c);
      return;
    }
    if (c) this._applyGithubStats(c);

    // Persistent cache — apply immediately and skip the network if still fresh.
    try {
      const stored = JSON.parse(localStorage.getItem(STATS_CACHE_KEY) ?? 'null');
      if (stored && Date.now() - stored.fetchedAt < STATS_CACHE_TTL) {
        this._cachedStats = stored.data;
        this._applyGithubStats(this._cachedStats);
        if (stored.data?.repo && stored.data?.langs && stored.data?.contributors) return;
      }
    } catch { /* malformed entry — proceed to network */ }

    try {
      const base = `https://api.github.com/repos/${GITHUB_REPO}`;
      const hdrs = { headers: { Accept: 'application/vnd.github+json' } };

      const [repoRes, commitsRes, langsRes, contribRes, stargazersRes] = await Promise.all([
        fetch(base, hdrs),
        fetch(`${base}/commits?per_page=1`, hdrs),
        fetch(`${base}/languages`, hdrs),
        fetch(`${base}/contributors?per_page=10`, hdrs),
        fetch(`${base}/stargazers?per_page=3`, hdrs),
      ]);

      if (!repoRes.ok) throw new Error(`GitHub API ${repoRes.status}`);
      const repo = await repoRes.json();

      let commits = null;
      if (commitsRes.ok) {
        const link = commitsRes.headers.get('Link') ?? '';
        const match = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
        commits = match ? parseInt(match[1], 10) : null;
      }

      const langs = langsRes.ok ? await langsRes.json() : null;
      const contributors = contribRes.ok ? await contribRes.json() : null;
      const stargazers = stargazersRes.ok ? await stargazersRes.json() : null;

      if (!this._cachedStats) this._cachedStats = {};
      this._cachedStats.repo = repo;
      this._cachedStats.commits = commits;
      if (langs) this._cachedStats.langs = langs;
      if (contributors?.length) this._cachedStats.contributors = contributors;
      if (stargazers?.length) this._cachedStats.stargazers = stargazers;

      this._applyGithubStats(this._cachedStats);
      this._persistStatsCache();
    } catch (err) {
      console.warn('[PoliAule] GitHub stats fetch failed:', err);
    }
  }

  _persistStatsCache() {
    try {
      localStorage.setItem(STATS_CACHE_KEY, JSON.stringify({ data: this._cachedStats, fetchedAt: Date.now() }));
    } catch { /* storage quota exceeded — not critical */ }
  }

  _applyGithubStats({ repo, commits, langs, contributors, stargazers }) {
    if (!this._overlay) return;

    const grid = this._overlay.querySelector('.github-stats-grid');
    if (grid) {
      const set = (stat, value) => {
        const el = grid.querySelector(`[data-stat="${stat}"]`);
        if (el) el.textContent = value;
      };
      set('stars', repo.stargazers_count.toLocaleString());
      set('commits', commits != null ? commits.toLocaleString() : '—');
      set('issues', repo.open_issues_count.toLocaleString());
      set('license', repo.license?.spdx_id ?? '—');
    }

    if (langs) this._renderLanguageBar(langs);
    if (contributors?.length) this._renderContributors(contributors);
    if (stargazers?.length) this._renderStargazers(stargazers);
  }

  _renderLanguageBar(langs) {
    const el = this._overlay?.querySelector('[data-github="lang-bar"]');
    if (!el) return;

    const total = Object.values(langs).reduce((a, b) => a + b, 0);
    const entries = Object.entries(langs).map(([lang, bytes]) => ({
      lang,
      pct: bytes / total * 100,
      color: LANG_COLORS[lang] ?? '#8b949e',
    }));

    el.innerHTML = `
      <div class="lang-bar">
        ${entries.map(e => `<div class="lang-segment" style="width:${e.pct.toFixed(2)}%;background:${e.color}" title="${escapeHtml(e.lang)} ${e.pct.toFixed(1)}%"></div>`).join('')}
      </div>
      <div class="lang-legend">
        ${entries.map(e => `
          <div class="lang-legend-item">
            <span class="lang-dot" style="background:${e.color}"></span>
            <span class="lang-name">${escapeHtml(e.lang)}</span>
            <span class="lang-pct">${e.pct.toFixed(1)}%</span>
          </div>`).join('')}
      </div>
    `;
  }

  _renderStargazers(stargazers) {
    const el = this._overlay?.querySelector('[data-github="stargazers"]');
    if (!el) return;

    const items = stargazers.slice(0, 3).map((u, i) => {
      const login = escapeHtml(u.login);
      const avatar = safeUrl(u.avatar_url);
      return `<span class="star-avatar" data-login="${login}" style="z-index:${3 - i}">
        <img src="${avatar}&s=48" alt="${login}" loading="lazy">
      </span>`;
    }).join('');

    el.innerHTML = `<div class="star-avatar-stack">${items}</div>`;
  }

  _renderContributors(contributors) {
    const el = this._overlay?.querySelector('[data-github="contributors"]');
    if (!el) return;

    const items = contributors.slice(0, 8).map(c => {
      const login = escapeHtml(c.login);
      const href = safeUrl(c.html_url);
      const avatar = safeUrl(c.avatar_url);
      return `
        <a href="${href}" target="_blank" rel="noopener" class="contributor-item lg-glass liquid-glass" title="${login}">
          <img src="${avatar}&s=64" alt="${login}" class="contributor-avatar" loading="lazy">
          <span class="contributor-info">
            <span class="contributor-login">${login}</span>
            <span class="contributor-count">${c.contributions.toLocaleString()}</span>
          </span>
        </a>
      `;
    }).join('');

    el.innerHTML = `<div class="contributors-list">${items}</div>`;
  }
}

export const infoPage = new InfoPage();
