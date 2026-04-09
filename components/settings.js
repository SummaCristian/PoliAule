// components/settings.js
// Settings button that morphs into a centered popup.
// Contains the language switcher and any future settings.

import { haptics, defaultPatterns } from './haptics.js';
import { t, getLocale, setLocale, onLanguageSwitch } from '../i18n.js';
import { classroomsData } from '../available-rooms-script.js';
import { selectCampusById } from './campus-picker.js';

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
let refreshCampusSelectFn = null; // set by buildCampusSection, called on every open

// ── Geometry helpers ──────────────────────────────────────────────────────────

function getPopupTarget() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(340, vw - 40);
  const h = Math.min(440, vh - 60);
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
  refreshCampusSelectFn?.();      // re-populate campus select now that data may be loaded
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
    </div>
  `;
  const preferredLabel = preferredIconTitle.querySelector('[data-preferred-label]');

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
    </div>
  `;
  const rememberLastLabel = rememberLastIconTitle.querySelector('[data-rememberlast-label]');

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
    preferredLabel.textContent     = t('settings.preferredCampus');
    rememberLastLabel.textContent  = t('settings.rememberLastCampus');
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

  return { popup, positionIndicator, retranslateCampus };
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

  const { popup, positionIndicator, retranslateCampus } = buildPopup();
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
