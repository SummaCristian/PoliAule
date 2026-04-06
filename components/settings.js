// components/settings.js
// Settings button that morphs into a centered popup.
// Contains the language switcher and any future settings.

import { haptics, defaultPatterns } from './haptics.js';
import { t, getLocale, setLocale, onLanguageSwitch } from '../i18n.js';

const TRANSITION_DURATION = 420;

// ── State ─────────────────────────────────────────────────────────────────────

let isAnimating = false;
let isOpen = false;
let overlay = null;

// Module-level refs set by initSettings()
let triggerEl = null;
let popupEl = null;
let positionIndicatorFn = null;

// ── Geometry helpers ──────────────────────────────────────────────────────────

function getPopupTarget() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(340, vw - 40);
  const h = 260;
  return {
    left: (vw - w) / 2,
    top: (vh - h) / 2,
    width: w,
    height: h,
    borderRadius: '22px',
  };
}

function applyGeometry(el, { left, top, width, height, borderRadius }) {
  el.style.left = left + 'px';
  el.style.top = top + 'px';
  el.style.width = width + 'px';
  el.style.height = height + 'px';
  el.style.borderRadius = borderRadius;
}

function onTransitionEnd(el, cb) {
  const fallback = setTimeout(cb, TRANSITION_DURATION + 50);
  el.addEventListener('transitionend', () => {
    clearTimeout(fallback);
    cb();
  }, { once: true });
}

// ── Scroll lock ───────────────────────────────────────────────────────────────

function preventScroll(e) { e.preventDefault(); }

function lockScroll() {
  window.addEventListener('wheel', preventScroll, { passive: false });
  window.addEventListener('touchmove', preventScroll, { passive: false });
}

function unlockScroll() {
  window.removeEventListener('wheel', preventScroll);
  window.removeEventListener('touchmove', preventScroll);
}

// ── Overlay ───────────────────────────────────────────────────────────────────

function getOverlay() {
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'settings-overlay';
    overlay.addEventListener('click', closeSettings);
    overlay.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
    overlay.addEventListener('wheel', e => e.preventDefault(), { passive: false });
    document.body.appendChild(overlay);
  }
  return overlay;
}

function removeOverlay() {
  if (!overlay) return;
  overlay.addEventListener('transitionend', () => {
    overlay?.remove();
    overlay = null;
  }, { once: true });
}

// ── Open / close ──────────────────────────────────────────────────────────────

function openSettings() {
  if (isAnimating || isOpen) return;
  isAnimating = true;

  lockScroll();

  const rect = triggerEl.getBoundingClientRect();

  popupEl.style.transition = 'none';
  applyGeometry(popupEl, {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    borderRadius: '50%',
  });
  popupEl.style.boxShadow = 'var(--shadow)';
  popupEl.style.display = 'flex';

  triggerEl.classList.add('settings-btn--morphing');

  popupEl.getBoundingClientRect(); // force reflow — buttons now have real dimensions
  positionIndicatorFn?.(false);   // snap indicator before morph animation starts
  popupEl.style.transition = '';

  requestAnimationFrame(() => {
    applyGeometry(popupEl, getPopupTarget());
    popupEl.style.boxShadow = 'var(--tp-shadow-lg)';
    popupEl.classList.add('settings-popup--open');
    getOverlay().classList.add('settings-overlay--active');
  });

  onTransitionEnd(popupEl, () => {
    isAnimating = false;
    isOpen = true;
  });
}

function closeSettings() {
  if (isAnimating || !isOpen) return;
  isAnimating = true;

  const rect = triggerEl.getBoundingClientRect();

  popupEl.classList.remove('settings-popup--open');
  getOverlay().classList.remove('settings-overlay--active');
  removeOverlay();

  requestAnimationFrame(() => {
    applyGeometry(popupEl, {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      borderRadius: '50%',
    });
    popupEl.style.boxShadow = 'var(--shadow)';
  });

  onTransitionEnd(popupEl, () => {
    popupEl.style.display = 'none';
    triggerEl.classList.remove('settings-btn--morphing');
    isOpen = false;
    isAnimating = false;
    unlockScroll();
  });
}

// ── Popup content ─────────────────────────────────────────────────────────────

function buildPopup() {
  const popup = document.createElement('div');
  popup.className = 'settings-popup';
  popup.style.display = 'none';
  popup.innerHTML = `
    <div class="settings-popup__inner">
      <h2 class="settings-popup__title">${t('settings.title')}</h2>

      <div class="settings-section">
        <div class="settings-section__header">
          <div class="settings-section__icon-badge">
            <span class="material-symbols-outlined">translate</span>
          </div>
          <span class="settings-section__header-label">${t('settings.language')}</span>
        </div>
        <div class="settings-group">
          <div class="settings-row">
            <div class="settings-row__icon-title-container">
              <div class="settings-row__icon-badge" style="--badge-color: var(--text-color-accent)">
                <span class="material-symbols-outlined">language</span>
              </div>
              <span class="settings-row__label">Language</span>
            </div>
            <div class="settings-lang-toggle">
              <div class="settings-lang-indicator"></div>
              <button class="settings-lang-btn${getLocale() === 'en' ? ' active' : ''}" data-lang="en">
                <span class="settings-lang-btn__flag">🇬🇧</span>
                <span class="settings-lang-btn__name">English</span>
              </button>
              <button class="settings-lang-btn${getLocale() === 'it' ? ' active' : ''}" data-lang="it">
                <span class="settings-lang-btn__flag">🇮🇹</span>
                <span class="settings-lang-btn__name">Italiano</span>
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>
  `;

  // Wire language buttons and sliding indicator
  const toggle = popup.querySelector('.settings-lang-toggle');
  const indicator = toggle.querySelector('.settings-lang-indicator');

  function positionIndicator(animate) {
    const activeBtn = toggle.querySelector('.settings-lang-btn.active');
    if (!activeBtn) return;
    if (!animate) indicator.style.transition = 'none';
    indicator.style.transform = `translateX(${activeBtn.offsetLeft}px)`;
    indicator.style.width = `${activeBtn.offsetWidth}px`;
    indicator.style.height = `${activeBtn.offsetHeight}px`;
    if (!animate) {
      indicator.getBoundingClientRect(); // force reflow
      indicator.style.transition = '';
    }
  }

  popup.querySelectorAll('.settings-lang-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const lang = btn.dataset.lang;
      if (lang === getLocale()) return;
      await setLocale(lang);
      haptics.trigger(defaultPatterns.success);
      updateLangButtons(popup, positionIndicator);
    });
  });

  // Expose so openSettings() can snap after first display
  positionIndicatorFn = positionIndicator;

  return { popup, positionIndicator };
}

function updateLangButtons(popup, positionIndicator) {
  popup.querySelectorAll('.settings-lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === getLocale());
  });
  positionIndicator?.(true);
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initSettings() {
  triggerEl = document.getElementById('settings-btn');
  if (!triggerEl) return;

  const { popup, positionIndicator } = buildPopup();
  popupEl = popup;
  document.body.appendChild(popupEl);

  triggerEl.addEventListener('click', () => {
    haptics.trigger(defaultPatterns.success);
    openSettings();
  });

  // Keep title and section header in sync when the language changes
  const titleEl = popupEl.querySelector('.settings-popup__title');
  const sectionHeaderLabelEl = popupEl.querySelector('.settings-section__header-label');

  onLanguageSwitch(() => {
    titleEl.textContent = t('settings.title');
    sectionHeaderLabelEl.textContent = t('settings.language');
    updateLangButtons(popupEl, positionIndicator);
  });

  // Escape closes the popup
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeSettings();
  });

  // Keep popup centred on resize while open
  window.addEventListener('resize', () => {
    if (!isOpen || isAnimating) return;
    popupEl.style.transition = 'none';
    applyGeometry(popupEl, getPopupTarget());
    popupEl.getBoundingClientRect();
    popupEl.style.transition = '';
  });
}
