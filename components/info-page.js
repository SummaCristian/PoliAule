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

    // classroom-detail's back-btn listener calls history.replaceState (no hashchange),
    // so we need our own listener to directly close when we're the active page.
    this._backBtn?.addEventListener('click', () => {
      if (!this._isOpen) return;
      history.replaceState(null, '', window.location.pathname + window.location.search);
      this._doClose();
    });

    window.addEventListener('hashchange', () => this._onHashChange());

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
      this._doClose();
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

    if (document.startViewTransition && this._tabbar) {
      this._tabbar.style.viewTransitionName = 'classroom-nav';
      if (logoEl) logoEl.style.viewTransitionName = 'info-logo';
      if (titleEl) titleEl.style.viewTransitionName = 'info-title';
      if (badgeEl) {
        badgeEl.style.lineHeight = '1'; // override line-height: 0 so VT has a non-zero bounding box
        badgeEl.style.viewTransitionName = 'info-badge';
      }

      const vt = document.startViewTransition(() => {
        this._tabbar.style.viewTransitionName = '';
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
          this._backBtn.style.viewTransitionName = 'classroom-nav';
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
    const badgeText = this._badgeEl?.textContent ?? '';
    this._overlay.innerHTML = `
      <div class="info-page">
        <div class="info-hero">
          <img src="/favicons/main/logo.png" class="info-hero-icon" draggable="false" alt="">
          <h1 class="info-hero-title">PoliAule</h1>
          ${showBadge ? `<h4 class="info-hero-badge secondary">${badgeText}</h4>` : ''}
        </div>
      </div>
    `;
  }
}

export const infoPage = new InfoPage();
