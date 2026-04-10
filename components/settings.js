// components/settings.js
// Settings button that morphs into a centered popup.
// Contains the language switcher and any future settings.

import { haptics, defaultPatterns } from './haptics.js';
import { t, getLocale, setLocale, onLanguageSwitch, animateI18nElement } from '../i18n.js';
import { classroomsData } from '../available-rooms-script.js';
import { selectCampusById } from './campus-picker.js';
import { STORAGE_KEY as TIME_FORMAT_KEY } from '../utils/time-format.js';

const TRANSITION_DURATION = 420;

const PREFERRED_CAMPUS_ENABLED_KEY = 'poliAule_preferredCampusEnabled';
const PREFERRED_CAMPUS_ID_KEY      = 'poliAule_preferredCampusId';
const REMEMBER_LAST_CAMPUS_KEY     = 'poliAule_rememberLastCampus';
const LAST_CAMPUS_ID_KEY           = 'poliAule_lastCampusId';

// ── State ─────────────────────────────────────────────────────────────────────

let isAnimating = false;
let isOpen = false;
let overlay = null;

// Module-level refs set by initSettings()
let triggerEl = null;
let popupEl = null;
let positionIndicatorFn = null;
let positionTimeFmtIndicatorFn = null;
let refreshCampusSelectFn = null; // set by buildCampusSection, called on every open

// ── Geometry helpers ──────────────────────────────────────────────────────────

function getPopupTarget() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(400, vw - 32);

  // Measure natural content height at the target width
  popupEl.style.width = w + 'px';
  popupEl.style.height = 'auto';
  const naturalH = popupEl.scrollHeight;
  popupEl.style.height = ''; // applyGeometry sets the final value immediately after

  const h = Math.min(naturalH, vh - 60);
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
  popupEl.style.display = 'flex'; // must be visible before getPopupTarget() measures scrollHeight

  const target = getPopupTarget(); // measures scrollHeight — needs display:flex

  // Place popup at its final position/size instantly — only transform animates
  applyGeometry(popupEl, target);
  popupEl.style.boxShadow = 'var(--shadow)';

  // Pin transform-origin to the button's center so the popup grows from there
  const originX = rect.left + rect.width  / 2 - target.left;
  const originY = rect.top  + rect.height / 2 - target.top;
  popupEl.style.transformOrigin = `${originX}px ${originY}px`;
  popupEl.style.transform       = `scale(${(rect.width / target.width).toFixed(4)})`;
  popupEl.style.borderRadius    = '50%';

  triggerEl.classList.add('settings-btn--morphing');

  popupEl.getBoundingClientRect(); // force reflow
  positionIndicatorFn?.(false);         // snap lang indicator before morph animation starts
  positionTimeFmtIndicatorFn?.(false);  // snap time format indicator before morph animation starts
  refreshCampusSelectFn?.();            // re-populate campus select now that data may be loaded
  popupEl.style.transition = '';

  requestAnimationFrame(() => {
    popupEl.style.transform    = 'scale(1)';
    popupEl.style.borderRadius = '22px';
    popupEl.style.boxShadow    = 'var(--tp-shadow-lg)';
    popupEl.classList.add('settings-popup--open');
    getOverlay().classList.add('settings-overlay--active');
  });

  onTransitionEnd(popupEl, () => {
    popupEl.style.transform       = '';
    popupEl.style.transformOrigin = '';
    isAnimating = false;
    isOpen = true;
  });
}

function closeSettings() {
  if (isAnimating || !isOpen) return;
  isAnimating = true;

  const rect      = triggerEl.getBoundingClientRect();
  const popupRect = popupEl.getBoundingClientRect();

  // Pin transform-origin to the button's center relative to the popup's current position
  const originX = rect.left + rect.width  / 2 - popupRect.left;
  const originY = rect.top  + rect.height / 2 - popupRect.top;
  popupEl.style.transformOrigin = `${originX}px ${originY}px`;

  popupEl.classList.remove('settings-popup--open');
  getOverlay().classList.remove('settings-overlay--active');
  removeOverlay();

  requestAnimationFrame(() => {
    popupEl.style.transform    = `scale(${(rect.width / popupRect.width).toFixed(4)})`;
    popupEl.style.borderRadius = '50%';
    popupEl.style.boxShadow    = 'var(--shadow)';
  });

  onTransitionEnd(popupEl, () => {
    popupEl.style.display         = 'none';
    popupEl.style.transform       = '';
    popupEl.style.transformOrigin = '';
    popupEl.style.borderRadius    = '';
    triggerEl.classList.remove('settings-btn--morphing');
    isOpen = false;
    isAnimating = false;
    unlockScroll();
  });
}

// ── Startup campus restorers ──────────────────────────────────────────────────

// Called from script.js after setupCampusPicker() to apply the saved preferred campus.
export function applyPreferredCampusIfEnabled() {
  if (localStorage.getItem(PREFERRED_CAMPUS_ENABLED_KEY) !== 'true') return;
  const id = localStorage.getItem(PREFERRED_CAMPUS_ID_KEY);
  if (id) selectCampusById(id);
}

// Called from script.js after setupCampusPicker() to restore the last used campus.
export function applyRememberLastCampusIfEnabled() {
  if (localStorage.getItem(REMEMBER_LAST_CAMPUS_KEY) !== 'true') return;
  const id = localStorage.getItem(LAST_CAMPUS_ID_KEY);
  if (id) selectCampusById(id);
}

// ── Toggle helpers ────────────────────────────────────────────────────────────

function buildToggle(isOn) {
  const btn = document.createElement('button');
  btn.className = 'settings-toggle' + (isOn ? ' on' : '');
  btn.setAttribute('role', 'switch');
  btn.setAttribute('aria-checked', String(isOn));
  const thumb = document.createElement('span');
  thumb.className = 'settings-toggle__thumb';
  btn.appendChild(thumb);
  return btn;
}

function setToggleState(btn, isOn) {
  btn.classList.toggle('on', isOn);
  btn.setAttribute('aria-checked', String(isOn));
}

// ── Campus section ────────────────────────────────────────────────────────────

function buildCampusSection() {
  // First-load default: enable "Remember last used" and pre-select Leonardo
  if (
    localStorage.getItem(PREFERRED_CAMPUS_ENABLED_KEY) === null &&
    localStorage.getItem(REMEMBER_LAST_CAMPUS_KEY) === null
  ) {
    localStorage.setItem(REMEMBER_LAST_CAMPUS_KEY, 'true');
    localStorage.setItem(LAST_CAMPUS_ID_KEY, 'MIA01');
  }

  const section = document.createElement('div');
  section.className = 'settings-section';

  // ── Section header
  section.innerHTML = `
    <div class="settings-section__header">
      <div class="settings-section__icon-badge">
        <span class="material-symbols-outlined">location_on</span>
      </div>
      <span class="settings-section__header-label" data-campus-label></span>
    </div>
  `;
  const headerLabel = section.querySelector('[data-campus-label]');

  const group = document.createElement('div');
  group.className = 'settings-group';
  section.appendChild(group);

  // ── Row 1: Preferred Campus toggle
  const preferredRow = document.createElement('div');
  preferredRow.className = 'settings-row';

  const preferredIconTitle = document.createElement('div');
  preferredIconTitle.className = 'settings-row__icon-title-container';
  preferredIconTitle.innerHTML = `
    <div class="settings-row__icon-badge" style="--badge-color: #FF9500">
      <span class="material-symbols-outlined">school</span>
    </div>
    <div class="settings-row__label-group">
      <span class="settings-row__label" data-preferred-label></span>
      <span class="settings-row__sublabel" data-preferred-sublabel></span>
    </div>
  `;
  const preferredLabel    = preferredIconTitle.querySelector('[data-preferred-label]');
  const preferredSublabel = preferredIconTitle.querySelector('[data-preferred-sublabel]');

  let preferredEnabled = localStorage.getItem(PREFERRED_CAMPUS_ENABLED_KEY) === 'true';
  const preferredToggle = buildToggle(preferredEnabled);
  preferredRow.appendChild(preferredIconTitle);
  preferredRow.appendChild(preferredToggle);
  group.appendChild(preferredRow);

  // ── Row 2: Campus select (conditionally shown)
  const pickerRow = document.createElement('div');
  pickerRow.className = 'settings-row settings-row--campus-picker';
  const campusSelect = document.createElement('select');
  campusSelect.className = 'settings-campus-select';

  function populateCampusSelect() {
    campusSelect.innerHTML = '';
    const campuses = classroomsData[0]?.campuses?.filter(c => c.buildings.length > 0) ?? [];
    if (campuses.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = t('settings.noCampusData');
      campusSelect.appendChild(opt);
      campusSelect.disabled = true;
    } else {
      campusSelect.disabled = false;
      campuses.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.name;
        campusSelect.appendChild(opt);
      });
      const saved = localStorage.getItem(PREFERRED_CAMPUS_ID_KEY);
      if (saved && campusSelect.querySelector(`option[value="${saved}"]`)) {
        campusSelect.value = saved;
      }
    }
  }

  pickerRow.appendChild(campusSelect);

  function showPickerRow(show) {
    if (show) {
      if (!pickerRow.parentElement) {
        group.insertBefore(pickerRow, rememberLastRow);
      }
    } else {
      pickerRow.remove();
    }
  }

  campusSelect.addEventListener('change', () => {
    localStorage.setItem(PREFERRED_CAMPUS_ID_KEY, campusSelect.value);
  });

  preferredToggle.addEventListener('click', () => {
    preferredEnabled = !preferredEnabled;
    localStorage.setItem(PREFERRED_CAMPUS_ENABLED_KEY, String(preferredEnabled));
    setToggleState(preferredToggle, preferredEnabled);
    if (preferredEnabled) {
      if (rememberLastEnabled) {
        rememberLastEnabled = false;
        localStorage.setItem(REMEMBER_LAST_CAMPUS_KEY, 'false');
        setToggleState(rememberLastToggle, false);
      }
      populateCampusSelect();
    }
    showPickerRow(preferredEnabled);
    haptics.trigger(defaultPatterns.success);
  });

  // ── Row 3: Remember Last Used toggle
  const rememberLastRow = document.createElement('div');
  rememberLastRow.className = 'settings-row';

  const rememberLastIconTitle = document.createElement('div');
  rememberLastIconTitle.className = 'settings-row__icon-title-container';
  rememberLastIconTitle.innerHTML = `
    <div class="settings-row__icon-badge" style="--badge-color: #34C759">
      <span class="material-symbols-outlined">history</span>
    </div>
    <div class="settings-row__label-group">
      <span class="settings-row__label" data-rememberlast-label></span>
      <span class="settings-row__sublabel" data-rememberlast-sublabel></span>
    </div>
  `;
  const rememberLastLabel    = rememberLastIconTitle.querySelector('[data-rememberlast-label]');
  const rememberLastSublabel = rememberLastIconTitle.querySelector('[data-rememberlast-sublabel]');

  let rememberLastEnabled = localStorage.getItem(REMEMBER_LAST_CAMPUS_KEY) === 'true';
  const rememberLastToggle = buildToggle(rememberLastEnabled);

  rememberLastRow.appendChild(rememberLastIconTitle);
  rememberLastRow.appendChild(rememberLastToggle);
  group.appendChild(rememberLastRow);

  rememberLastToggle.addEventListener('click', () => {
    rememberLastEnabled = !rememberLastEnabled;
    localStorage.setItem(REMEMBER_LAST_CAMPUS_KEY, String(rememberLastEnabled));
    setToggleState(rememberLastToggle, rememberLastEnabled);
    if (rememberLastEnabled && preferredEnabled) {
      preferredEnabled = false;
      localStorage.setItem(PREFERRED_CAMPUS_ENABLED_KEY, 'false');
      setToggleState(preferredToggle, false);
      showPickerRow(false);
    }
    haptics.trigger(defaultPatterns.success);
  });

  // Save last used campus whenever the campus selection changes
  document.addEventListener('campuschange', (e) => {
    if (rememberLastEnabled) {
      localStorage.setItem(LAST_CAMPUS_ID_KEY, e.detail.id);
    }
  });

  // Show picker row if already enabled
  if (preferredEnabled) {
    populateCampusSelect();
    showPickerRow(true);
  }

  // Retranslate all text nodes in this section
  function retranslate() {
    headerLabel.textContent        = t('settings.sectionCampus');
    animateI18nElement(headerLabel);
    preferredLabel.textContent     = t('settings.preferredCampus');
    animateI18nElement(preferredLabel);
    preferredSublabel.textContent  = t('settings.preferredCampusDesc');
    animateI18nElement(preferredSublabel);
    rememberLastLabel.textContent  = t('settings.rememberLastCampus');
    animateI18nElement(rememberLastLabel);
    rememberLastSublabel.textContent = t('settings.rememberLastCampusDesc');
    animateI18nElement(rememberLastSublabel);
    if (preferredEnabled && campusSelect.disabled && campusSelect.options[0]) {
      campusSelect.options[0].textContent = t('settings.noCampusData');
    }
  }

  retranslate();

  // Called each time the popup opens so the select is populated with live data
  function refreshIfNeeded() {
    if (preferredEnabled) populateCampusSelect();
  }

  return { sectionEl: section, retranslate, refreshIfNeeded };
}

// ── Popup content ─────────────────────────────────────────────────────────────

function buildPopup() {
  const popup = document.createElement('div');
  popup.className = 'settings-popup';
  popup.style.display = 'none';
  popup.innerHTML = `
    <div class="settings-popup__inner">
      <div class="settings-popup__title-row">
        <h2 class="settings-popup__title">${t('settings.title')}</h2>
        <button class="settings-close-btn" aria-label="Close settings">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

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
              <div class="settings-row__label-group">
                <span class="settings-row__label" data-i18n="settings.language">${t('settings.language')}</span>
                <span class="settings-row__sublabel" data-i18n="settings.languageDesc">${t('settings.languageDesc')}</span>
              </div>
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

      <div class="settings-section">
        <div class="settings-section__header">
          <div class="settings-section__icon-badge">
            <span class="material-symbols-outlined">schedule</span>
          </div>
          <span class="settings-section__header-label" data-timefmt-section-header>${t('settings.timeFormat')}</span>
        </div>
        <div class="settings-group">
          <div class="settings-row">
            <div class="settings-row__icon-title-container">
              <div class="settings-row__icon-badge" style="--badge-color: var(--text-color-accent)">
                <span class="material-symbols-outlined">schedule</span>
              </div>
              <div class="settings-row__label-group">
                <span class="settings-row__label" data-i18n="settings.timeFormat">${t('settings.timeFormat')}</span>
                <span class="settings-row__sublabel" data-i18n="settings.timeFormatDesc">${t('settings.timeFormatDesc')}</span>
              </div>
            </div>
            <div class="settings-lang-toggle" data-timefmt-toggle>
              <div class="settings-lang-indicator"></div>
              <button class="settings-lang-btn" data-timefmt="system">
                <span class="settings-lang-btn__name" data-i18n="settings.timeFormat.system">${t('settings.timeFormat.system')}</span>
              </button>
              <button class="settings-lang-btn" data-timefmt="12">
                <span class="settings-lang-btn__name" data-i18n="settings.timeFormat.12h">${t('settings.timeFormat.12h')}</span>
              </button>
              <button class="settings-lang-btn" data-timefmt="24">
                <span class="settings-lang-btn__name" data-i18n="settings.timeFormat.24h">${t('settings.timeFormat.24h')}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>
  `;

  popup.querySelector('.settings-close-btn').addEventListener('click', () => closeSettings());

  // Append campus section
  const inner = popup.querySelector('.settings-popup__inner');
  const { sectionEl: campusSectionEl, retranslate: retranslateCampus, refreshIfNeeded } = buildCampusSection();
  refreshCampusSelectFn = refreshIfNeeded;
  inner.appendChild(campusSectionEl);

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

  popup.querySelectorAll('.settings-lang-btn[data-lang]').forEach(btn => {
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

  // Wire time format buttons and sliding indicator
  const timeFmtToggle = popup.querySelector('[data-timefmt-toggle]');
  const timeFmtIndicator = timeFmtToggle.querySelector('.settings-lang-indicator');
  const savedTimeFmt = localStorage.getItem(TIME_FORMAT_KEY) ?? 'system';
  timeFmtToggle.querySelector(`[data-timefmt="${savedTimeFmt}"]`)?.classList.add('active');

  function positionTimeFmtIndicator(animate) {
    const activeBtn = timeFmtToggle.querySelector('.settings-lang-btn.active');
    if (!activeBtn) return;
    if (!animate) timeFmtIndicator.style.transition = 'none';
    timeFmtIndicator.style.transform = `translateX(${activeBtn.offsetLeft}px)`;
    timeFmtIndicator.style.width = `${activeBtn.offsetWidth}px`;
    timeFmtIndicator.style.height = `${activeBtn.offsetHeight}px`;
    if (!animate) {
      timeFmtIndicator.getBoundingClientRect(); // force reflow
      timeFmtIndicator.style.transition = '';
    }
  }

  timeFmtToggle.querySelectorAll('.settings-lang-btn[data-timefmt]').forEach(btn => {
    btn.addEventListener('click', () => {
      const fmt = btn.dataset.timefmt;
      if (timeFmtToggle.querySelector('.settings-lang-btn.active') === btn) return;
      localStorage.setItem(TIME_FORMAT_KEY, fmt);
      timeFmtToggle.querySelectorAll('.settings-lang-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      positionTimeFmtIndicator(true);
      haptics.trigger(defaultPatterns.success);
      window.dispatchEvent(new CustomEvent('timeformatchange'));
    });
  });

  positionTimeFmtIndicatorFn = positionTimeFmtIndicator;

  return { popup, positionIndicator, positionTimeFmtIndicator, retranslateCampus };
}

function updateLangButtons(popup, positionIndicator) {
  popup.querySelectorAll('.settings-lang-btn[data-lang]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === getLocale());
  });
  positionIndicator?.(true);
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initSettings() {
  triggerEl = document.getElementById('settings-btn');
  if (!triggerEl) return;

  const { popup, positionIndicator, positionTimeFmtIndicator, retranslateCampus } = buildPopup();
  popupEl = popup;
  document.body.appendChild(popupEl);

  triggerEl.addEventListener('click', () => {
    haptics.trigger(defaultPatterns.success);
    openSettings();
  });

  // Keep title and section headers in sync when the language changes
  const titleEl = popupEl.querySelector('.settings-popup__title');
  const sectionHeaderLabelEl = popupEl.querySelector('.settings-section__header-label');
  const timeFmtHeaderLabelEl = popupEl.querySelector('[data-timefmt-section-header]');

  onLanguageSwitch(() => {
    titleEl.textContent = t('settings.title');
    animateI18nElement(titleEl);
    sectionHeaderLabelEl.textContent = t('settings.language');
    animateI18nElement(sectionHeaderLabelEl);
    if (timeFmtHeaderLabelEl) {
      timeFmtHeaderLabelEl.textContent = t('settings.timeFormat');
      animateI18nElement(timeFmtHeaderLabelEl);
    }
    popupEl.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });
    updateLangButtons(popupEl, positionIndicator);
    positionTimeFmtIndicator?.(false);
    retranslateCampus();
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
