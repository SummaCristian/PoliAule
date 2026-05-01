import { onLanguageSwitch, t } from '../i18n.js';

const HASH = '#info';

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
  }

  init() {
    this._overlay = document.getElementById('info-page-overlay');
    this._tabbar = document.querySelector('.tabbar');
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
          <img src="/favicons/${showBadge ? 'beta' : 'main'}/apple-touch-icon.png" class="info-hero-icon" draggable="false" alt="">
          <!-- Title -->
          <h1 class="info-hero-title">PoliAule</h1>
          <!-- 'Beta' or 'Local' badge if necessary -->
          ${showBadge ? `<h4 class="info-hero-badge secondary">${badgeText}</h4>` : ''}
        </div>

        <!-- Body content -->
        <div class="info-body">
          <p>${t('info.body.intro')}</p>
          <p>${t('info.body.parag1')}</p>

          <div class="about-me-section">
            <h2>${t('info.aboutMe.title')}</h2>
            <div class="about-me-container">
              <img src="/assets/profile.jpg" alt="Profile picture of Cristian Summa" class="about-me-photo">
              <p>${t('info.aboutMe.parag1')}</p>
            </div>
            <p>${t('info.aboutMe.parag2')}</p>
            <p>${t('info.aboutMe.parag3')}</p>
          </div>
        </div>

      </div>
    `;
  }
}

export const infoPage = new InfoPage();
