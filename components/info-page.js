import { onLanguageSwitch, t } from '../i18n.js';
import { haptics, defaultPatterns } from './haptics.js';
import { escapeHtml, safeUrl } from '../utils/html.js';

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
  }

  init() {
    this._overlay = document.getElementById('info-page-overlay');
    this._tabbar = document.querySelector('.tabbar');
    this._backBtn = document.getElementById('detail-back-btn');
    this._logoEl = document.querySelector('.header-logo');
    this._titleEl = document.querySelector('.header-title');
    this._badgeEl = document.getElementById('env-badge');

    // Haptics for interactive GitHub elements
    this._overlay?.addEventListener('click', (e) => {
      if (e.target.closest('.github-stat-card') || e.target.closest('.contributor-item') || e.target.closest('.github-repo-chip') || e.target.closest('.create-issue-btn')) {
        haptics.trigger(defaultPatterns.light);
      }
    });

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

    // If the splash is still present, dismissSplash() will call checkHash() after
    // the VT completes. Only open immediately if splash is already gone.
    if (!document.getElementById('splash-overlay')) {
      this.checkHash();
    }
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
    if (this._backBtn) {
      this._backBtn.removeAttribute('hidden');
      this._backBtn.style.viewTransitionName = 'classroom-nav';
    }

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
    // When navigating from the detail page, the back button is already visible and
    // the tabbar is already hidden — skip the classroom-nav morph to avoid conflicting VTs.
    const fromDetail = this._backBtn != null && !this._backBtn.hidden;
    this._openedFromDetail = fromDetail;

    if (document.startViewTransition && this._tabbar) {
      if (!fromDetail) this._tabbar.style.viewTransitionName = 'classroom-nav';
      if (logoEl) logoEl.style.viewTransitionName = 'info-logo';
      if (titleEl) titleEl.style.viewTransitionName = 'info-title';
      if (badgeEl) {
        badgeEl.style.lineHeight = '1'; // override line-height: 0 so VT has a non-zero bounding box
        badgeEl.style.viewTransitionName = 'info-badge';
      }

      const vt = document.startViewTransition(() => {
        if (!fromDetail) this._tabbar.style.viewTransitionName = '';
        if (logoEl) logoEl.style.viewTransitionName = '';
        if (titleEl) titleEl.style.viewTransitionName = '';
        if (badgeEl) {
          badgeEl.style.lineHeight = '';
          badgeEl.style.viewTransitionName = '';
        }

        this._tabbar.classList.add('detail-open');
        document.body.classList.add('info-open');
        this._overlay.removeAttribute('hidden');
        this._renderContent(showBadge);
        this._overlay.classList.add('visible');
        if (this._backBtn) {
          this._backBtn.removeAttribute('hidden');
          if (!fromDetail) this._backBtn.style.viewTransitionName = 'classroom-nav';
        }

        // Reset scroll for the new view
        window.scrollTo(0, 0);

        const heroIcon = this._overlay.querySelector('.info-hero-icon');
        const heroTitle = this._overlay.querySelector('.info-hero-title');
        const heroBadge = this._overlay.querySelector('.info-hero-badge');
        if (heroIcon) heroIcon.style.viewTransitionName = 'info-logo';
        if (heroTitle) heroTitle.style.viewTransitionName = 'info-title';
        if (heroBadge) heroBadge.style.viewTransitionName = 'info-badge';
      });

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
      this._overlay.innerHTML = '';
      this._clearVtNames();
      if (logoEl) logoEl.style.viewTransitionName = '';
      if (titleEl) titleEl.style.viewTransitionName = '';
      if (badgeEl) {
        badgeEl.style.lineHeight = '';
        badgeEl.style.viewTransitionName = '';
      }
    };

    if (document.startViewTransition && this._tabbar) {
      if (this._backBtn) this._backBtn.style.viewTransitionName = 'classroom-nav';
      if (heroIcon) heroIcon.style.viewTransitionName = 'info-logo';
      if (heroTitle) heroTitle.style.viewTransitionName = 'info-title';
      if (heroBadge) heroBadge.style.viewTransitionName = 'info-badge';

      const vt = document.startViewTransition(() => {
        if (this._backBtn) this._backBtn.style.viewTransitionName = '';
        if (heroIcon) heroIcon.style.viewTransitionName = '';
        if (heroTitle) heroTitle.style.viewTransitionName = '';
        if (heroBadge) heroBadge.style.viewTransitionName = '';

        document.body.classList.remove('info-open');
        this._overlay.setAttribute('hidden', '');
        this._overlay.classList.remove('visible');
        if (this._backBtn) this._backBtn.setAttribute('hidden', '');

        this._tabbar.classList.remove('detail-open');
        this._tabbar.style.viewTransitionName = 'classroom-nav';

        if (logoEl) logoEl.style.viewTransitionName = 'info-logo';
        if (titleEl) titleEl.style.viewTransitionName = 'info-title';
        if (badgeEl) {
          badgeEl.style.lineHeight = '1'; // override line-height: 0 so VT has a non-zero bounding box
          badgeEl.style.viewTransitionName = 'info-badge';
        }

        // Restore scroll position so VT can morph back to the correct spot
        window.scrollTo(0, this._savedScrollPos);
      });

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
    if (this._tabbar) this._tabbar.style.viewTransitionName = '';
    if (this._backBtn) this._backBtn.style.viewTransitionName = '';
  }

  _renderContent(showBadge) {
    this._showBadge = showBadge;
    const badgeText = this._badgeEl?.textContent ?? '';
    this._overlay.innerHTML = `
      <div class="info-page">
        <!-- Hero section -->
        <div class="info-hero">
          <!-- Logo -->
          <img src="/favicons/${showBadge ? 'beta' : 'main'}/icon.png" class="info-hero-icon" draggable="false" alt="">
          <!-- Title -->
          <h1 class="info-hero-title">PoliAule</h1>
          <!-- 'Beta' or 'Local' badge if necessary -->
          ${showBadge ? `<h4 class="info-hero-badge secondary">${badgeText}</h4>` : ''}
        </div>

        <!-- Body content -->
        <div class="info-body">
          <div class="info-intro">
            <div class="info-section-text">
              <p>${t('info.body.intro')}</p>
              <p>${t('info.body.parag1')}</p>
            </div>

            <div class="info-meta">
              <a href="https://polinetwork.org/it/projects/" target="_blank" rel="noopener" class="polinetwork-chip">
                <img src="https://polinetwork.org/favicon.ico" alt="PoliNetwork" draggable="false">
                <span>${t('info.polinetwork')}</span>
              </a>
              <p class="info-disclaimer">${t('footer.disclaimer5')}</p>
            </div>

            <div class="badge-container">
            <a href="https://poliaule.com" target="_blank" rel="noopener" class="info-badge info-badge--stable">
              <img src="/favicons/main/icon.png" alt="" draggable="false">
              <div class="badge-text">
                <span class="top-text">poliaule.com</span>
                <span class="bottom-text">${t('info.aboutMe.website')}</span>
                <span class="badge-description">${t('info.badge.stableDesc') || 'The production version of PoliAule'}</span>
              </div>
            </a>

            <a href="https://beta.poliaule.com" target="_blank" rel="noopener" class="info-badge info-badge--beta">
              <img src="/favicons/beta/icon.png" alt="" draggable="false">
              <div class="badge-text">
                <span class="top-text">beta.poliaule.com</span>
                <span class="bottom-text">${t('info.aboutMe.beta')}</span>
                <span class="badge-description">${t('info.badge.betaDesc') || 'The beta version of PoliAule'}</span>
                <span class="badge-label">BETA</span>
              </div>
            </a>

          </div>
          </div>

          <!-- PWA Install Section -->
          <div class="info-pwa-section">
            <div class="info-pwa-header">
              <div class="info-pwa-title-row">
                <span class="material-symbols-outlined">install_mobile</span>
                <h2>${t('info.pwa.title')}</h2>
              </div>
              <p class="info-pwa-subtitle">${t('info.pwa.subtitle')}</p>
            </div>

            <!-- Tab switcher: visible only on mobile -->
            <div class="pwa-tabbar" style="--tabs:3" role="tablist">
              <div class="pwa-tab-indicator"></div>
              <button class="pwa-tab active" data-pwa-tab="ios" role="tab" aria-selected="true">
                <svg viewBox="0 0 24 24" aria-hidden="true" class="info-pwa-platform-icon"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
                <span>iPhone</span>
              </button>
              <button class="pwa-tab" data-pwa-tab="android" role="tab" aria-selected="false">
                <svg viewBox="0 0 24 24" aria-hidden="true" class="info-pwa-platform-icon"><path d="M6 18c0 .55.45 1 1 1h1v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h2v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h1c.55 0 1-.45 1-1V8H6v10zm-2.5-10C2.67 8 2 8.67 2 9.5v7c0 .83.67 1.5 1.5 1.5S5 17.33 5 16.5v-7C5 8.67 4.33 8 3.5 8zm17 0c-.83 0-1.5.67-1.5 1.5v7c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-7c0-.83-.67-1.5-1.5-1.5zm-4.97-5.84 1.3-1.3c.2-.2.2-.51 0-.71-.2-.2-.51-.2-.71 0l-1.48 1.48A6.934 6.934 0 0 0 12 1c-1.1 0-2.15.23-3.09.63L7.43.15c-.2-.2-.51-.2-.71 0-.2.2-.2.51 0 .71l1.3 1.3C6.01 3.07 4.86 5.19 4.86 7.5h14.29c0-2.31-1.15-4.43-3.12-5.84zM10 5H9V4h1v1zm5 0h-1V4h1v1z"/></svg>
                <span>Android</span>
              </button>
              <button class="pwa-tab" data-pwa-tab="desktop" role="tab" aria-selected="false">
                <span class="material-symbols-outlined">desktop_windows</span>
                <span>Desktop</span>
              </button>
            </div>

            <div class="info-pwa-cards">
              <div class="info-pwa-card active" data-pwa-platform="ios">
                <div class="info-pwa-card-title">
                  <svg viewBox="0 0 24 24" aria-hidden="true" class="info-pwa-platform-icon"><path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/></svg>
                  <span>${t('info.pwa.ios.title')}</span>
                </div>
                <ol class="info-pwa-steps">
                  <li>${t('info.pwa.ios.step1')}</li>
                  <li>${t('info.pwa.ios.step2')}</li>
                  <li>${t('info.pwa.ios.step3')}</li>
                  <li>${t('info.pwa.ios.step4')}</li>
                </ol>
              </div>
              <div class="info-pwa-card" data-pwa-platform="android">
                <div class="info-pwa-card-title">
                  <svg viewBox="0 0 24 24" aria-hidden="true" class="info-pwa-platform-icon"><path d="M6 18c0 .55.45 1 1 1h1v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h2v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h1c.55 0 1-.45 1-1V8H6v10zm-2.5-10C2.67 8 2 8.67 2 9.5v7c0 .83.67 1.5 1.5 1.5S5 17.33 5 16.5v-7C5 8.67 4.33 8 3.5 8zm17 0c-.83 0-1.5.67-1.5 1.5v7c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-7c0-.83-.67-1.5-1.5-1.5zm-4.97-5.84 1.3-1.3c.2-.2.2-.51 0-.71-.2-.2-.51-.2-.71 0l-1.48 1.48A6.934 6.934 0 0 0 12 1c-1.1 0-2.15.23-3.09.63L7.43.15c-.2-.2-.51-.2-.71 0-.2.2-.2.51 0 .71l1.3 1.3C6.01 3.07 4.86 5.19 4.86 7.5h14.29c0-2.31-1.15-4.43-3.12-5.84zM10 5H9V4h1v1zm5 0h-1V4h1v1z"/></svg>
                  <span>${t('info.pwa.android.title')}</span>
                </div>
                <ol class="info-pwa-steps">
                  <li>${t('info.pwa.android.step1')}</li>
                  <li>${t('info.pwa.android.step2')}</li>
                  <li>${t('info.pwa.android.step3')}</li>
                  <li>${t('info.pwa.android.step4')}</li>
                </ol>
              </div>
              <div class="info-pwa-card" data-pwa-platform="desktop">
                <div class="info-pwa-card-title">
                  <span class="material-symbols-outlined">desktop_windows</span>
                  <span>${t('info.pwa.desktop.title')}</span>
                </div>
                <ol class="info-pwa-steps">
                  <li>${t('info.pwa.desktop.step1')}</li>
                  <li>${t('info.pwa.desktop.step2')}</li>
                  <li>${t('info.pwa.desktop.step3')}</li>
                </ol>
              </div>
            </div>
          </div>

          <div class="info-two-col">
            <div class="about-me-section">
              <h2>${t('info.aboutMe.title')}</h2>
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
            </div>

            <div class="github-stats-section">
              <div class="github-section-head">
                <h2>${t('info.github.title')}</h2>
                <a href="https://github.com/SummaCristian/poliaule" target="_blank" rel="noopener" class="github-repo-chip">
                  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>
                  <span>GitHub</span>
                </a>
              </div>
              <div class="github-stats-grid">
                <a href="https://github.com/SummaCristian/poliaule/stargazers" target="_blank" rel="noopener" class="github-stat-card">
                  <span class="material-symbols-outlined github-stat-icon">star</span>
                  <span class="github-stat-number" data-stat="stars">—</span>
                  <span class="github-stat-label">${t('info.github.stars')}</span>
                </a>
                <a href="https://github.com/SummaCristian/poliaule/commits/main" target="_blank" rel="noopener" class="github-stat-card">
                  <span class="material-symbols-outlined github-stat-icon">commit</span>
                  <span class="github-stat-number" data-stat="commits">—</span>
                  <span class="github-stat-label">${t('info.github.commits')}</span>
                </a>
                <a href="https://github.com/SummaCristian/poliaule/issues" target="_blank" rel="noopener" class="github-stat-card">
                  <span class="material-symbols-outlined github-stat-icon">bug_report</span>
                  <span class="github-stat-number" data-stat="issues">—</span>
                  <span class="github-stat-label">${t('info.github.issues')}</span>
                </a>
                <a href="https://github.com/SummaCristian/poliaule/blob/main/LICENSE" target="_blank" rel="noopener" class="github-stat-card">
                  <span class="material-symbols-outlined github-stat-icon">balance</span>
                  <span class="github-stat-number" data-stat="license">—</span>
                  <span class="github-stat-label">${t('info.github.license')}</span>
                </a>
              </div>

              <a href="https://github.com/SummaCristian/poliaule/issues/new" target="_blank" rel="noopener" class="create-issue-btn">
                <span class="material-symbols-outlined">bug_report</span>
                <span>${t('info.github.createIssue')}</span>
              </a>
              <div class="github-extended">
                <div class="github-subsection">
                  <div class="github-subsection-header">
                    <span class="material-symbols-outlined">code</span>
                    <span>${t('info.github.languages')}</span>
                  </div>
                  <div data-github="lang-bar"><div class="github-skeleton" style="height:2rem"></div></div>
                </div>
                <div class="github-subsection">
                  <div class="github-subsection-header">
                    <span class="material-symbols-outlined">group</span>
                    <span>${t('info.github.contributors')}</span>
                  </div>
                  <div data-github="contributors"><div class="github-skeleton" style="height:3rem"></div></div>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    `;

    // Trigger animations when the about-me section becomes visible
    const aboutMeSection = this._overlay.querySelector('.about-me-section');
    const bubblesContainer = this._overlay.querySelector('.about-me-container');
    
    if (aboutMeSection && bubblesContainer) {
      // 1. Measure final height to reserve space
      // We temporarily "force" the final state to measure it
      const bubbles = bubblesContainer.querySelector('.about-me-bubbles');
      const allBubbles = bubbles.querySelectorAll('.message-bubble');
      
      // Save current styles
      const originalSectionStyle = aboutMeSection.style.cssText;
      
      // Apply final state styles for measurement
      allBubbles.forEach(b => {
        b.style.maxHeight = '500px';
        b.style.paddingTop = '0.8rem';
        b.style.paddingBottom = '0.8rem';
        b.style.opacity = '1';
      });
      
      const finalHeight = aboutMeSection.offsetHeight;
      
      // Restore initial state and set the reserved height
      allBubbles.forEach(b => b.style.cssText = '');
      aboutMeSection.style.minHeight = `${finalHeight}px`;

      // 2. Setup observer
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.1 });
      observer.observe(aboutMeSection);
    }

    const observe = (selector, threshold = 0.1) => {
      const el = this._overlay.querySelector(selector);
      if (!el) return;
      const obs = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) { entry.target.classList.add('is-visible'); obs.unobserve(entry.target); }
        });
      }, { threshold });
      obs.observe(el);
    };

    observe('.info-pwa-section', 0.05);

    // PWA tab switching (mobile only — CSS hides the tabbar on wider screens)
    const pwaTabbar = this._overlay.querySelector('.pwa-tabbar');
    const pwaIndicator = this._overlay.querySelector('.pwa-tab-indicator');
    if (pwaTabbar && pwaIndicator) {
      const tabs = [...pwaTabbar.querySelectorAll('.pwa-tab')];
      pwaTabbar.addEventListener('click', (e) => {
        const btn = e.target.closest('.pwa-tab');
        if (!btn || btn.classList.contains('active')) return;
        haptics.trigger(defaultPatterns.light);
        const idx = tabs.indexOf(btn);
        tabs.forEach((t, i) => {
          t.classList.toggle('active', i === idx);
          t.setAttribute('aria-selected', i === idx ? 'true' : 'false');
        });
        pwaIndicator.style.transform = `translateX(${idx * 100}%)`;
        const platform = btn.dataset.pwaTab;
        this._overlay.querySelectorAll('.info-pwa-card').forEach(card => {
          card.classList.toggle('active', card.dataset.pwaPlatform === platform);
        });
      });
    }

    observe('.github-stats-section');
    observe('.github-extended', 0.05);
    this._fetchGithubStats();
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

      const [repoRes, commitsRes, langsRes, contribRes] = await Promise.all([
        fetch(base, hdrs),
        fetch(`${base}/commits?per_page=1`, hdrs),
        fetch(`${base}/languages`, hdrs),
        fetch(`${base}/contributors?per_page=10`, hdrs),
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

      if (!this._cachedStats) this._cachedStats = {};
      this._cachedStats.repo = repo;
      this._cachedStats.commits = commits;
      if (langs) this._cachedStats.langs = langs;
      if (contributors?.length) this._cachedStats.contributors = contributors;

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

  _applyGithubStats({ repo, commits, langs, contributors }) {
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

_renderContributors(contributors) {
    const el = this._overlay?.querySelector('[data-github="contributors"]');
    if (!el) return;

    const items = contributors.slice(0, 8).map(c => {
      const login = escapeHtml(c.login);
      const href = safeUrl(c.html_url);
      const avatar = safeUrl(c.avatar_url);
      return `
        <a href="${href}" target="_blank" rel="noopener" class="contributor-item" title="${login}">
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
