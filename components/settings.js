// components/settings.js
// Settings button that morphs into a centered popup.
// Contains the language switcher and any future settings.

import { haptics, defaultPatterns } from './haptics.js';
import { t, getLocale, setLocale, onLanguageSwitch } from '../i18n.js';
import { classroomsData } from '../available-rooms-script.js';
import { selectCampusById } from './campus-picker.js';

const TRANSITION_DURATION = 420;

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function findNearestCampusId(lat, lon) {
  const available = classroomsData[0]?.campuses?.filter(c => c.buildings.length > 0) ?? [];
  let best = null;
  let bestDist = Infinity;
  for (const campus of available) {
    if (campus.lat == null || campus.lon == null) continue;
    const dist = haversineKm(lat, lon, campus.lat, campus.lon);
    if (dist < bestDist) { bestDist = dist; best = campus.id; }
  }
  return best;
}

const PREFERRED_CAMPUS_ENABLED_KEY = 'poliAule_preferredCampusEnabled';
const PREFERRED_CAMPUS_ID_KEY      = 'poliAule_preferredCampusId';
const AUTO_LOCATE_KEY              = 'poliAule_autoLocate';

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

// ── Auto-locate ───────────────────────────────────────────────────────────────

// Called from script.js after setupCampusPicker() to auto-select on startup.
export function autoSelectCampusByLocationIfEnabled() {
  if (localStorage.getItem(AUTO_LOCATE_KEY) !== 'true') return;
  if (!('geolocation' in navigator)) return;
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => {
      const id = findNearestCampusId(coords.latitude, coords.longitude);
      if (id) selectCampusById(id);
    },
    () => { /* silently ignore on startup */ },
    { maximumAge: 60000, timeout: 10000 }
  );
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
        group.insertBefore(pickerRow, autoLocateRow);
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
    if (preferredEnabled) populateCampusSelect();
    showPickerRow(preferredEnabled);
    haptics.trigger(defaultPatterns.success);
  });

  // ── Row 3: Auto-locate toggle
  const autoLocateRow = document.createElement('div');
  autoLocateRow.className = 'settings-row';

  const autoLocateIconTitle = document.createElement('div');
  autoLocateIconTitle.className = 'settings-row__icon-title-container';
  autoLocateIconTitle.innerHTML = `
    <div class="settings-row__icon-badge" style="--badge-color: #007AFF">
      <span class="material-symbols-outlined">my_location</span>
    </div>
    <div class="settings-row__label-group">
      <span class="settings-row__label" data-autolocate-label></span>
      <span class="settings-row__sublabel" data-autolocate-sublabel></span>
    </div>
  `;
  const autoLocateLabel = autoLocateIconTitle.querySelector('[data-autolocate-label]');
  const autoLocateSublabel = autoLocateIconTitle.querySelector('[data-autolocate-sublabel]');

  let autoLocateEnabled = localStorage.getItem(AUTO_LOCATE_KEY) === 'true';
  let autoLocateDenied = false;
  const autoLocateToggle = buildToggle(autoLocateEnabled);

  autoLocateRow.appendChild(autoLocateIconTitle);
  autoLocateRow.appendChild(autoLocateToggle);
  group.appendChild(autoLocateRow);

  const geoAvailable = 'geolocation' in navigator;
  if (!geoAvailable) {
    autoLocateToggle.disabled = true;
    autoLocateToggle.style.opacity = '0.4';
    autoLocateToggle.style.cursor = 'default';
  }

  autoLocateToggle.addEventListener('click', () => {
    if (!geoAvailable) return;

    if (autoLocateEnabled) {
      // Turn off
      autoLocateEnabled = false;
      autoLocateDenied = false;
      localStorage.setItem(AUTO_LOCATE_KEY, 'false');
      setToggleState(autoLocateToggle, false);
      autoLocateSublabel.textContent = t('settings.autoLocateDesc');
      haptics.trigger(defaultPatterns.success);
    } else {
      // Request permission — maximumAge:Infinity accepts any cached fix,
      // resolving immediately after the user grants access without waiting for GPS.
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          autoLocateEnabled = true;
          autoLocateDenied = false;
          localStorage.setItem(AUTO_LOCATE_KEY, 'true');
          setToggleState(autoLocateToggle, true);
          autoLocateSublabel.textContent = t('settings.autoLocateDesc');
          haptics.trigger(defaultPatterns.success);
          // Immediately auto-select the nearest campus
          const id = findNearestCampusId(coords.latitude, coords.longitude);
          if (id) selectCampusById(id);
        },
        (err) => {
          const denied = err.code === 1; // GeolocationPositionError.PERMISSION_DENIED
          autoLocateEnabled = false;
          autoLocateDenied = denied;
          localStorage.setItem(AUTO_LOCATE_KEY, 'false');
          setToggleState(autoLocateToggle, false);
          autoLocateSublabel.textContent = denied
            ? t('settings.locationDenied')
            : t('settings.autoLocateDesc');
          if (denied) haptics.trigger(defaultPatterns.error ?? defaultPatterns.success);
        },
        { maximumAge: Infinity, timeout: 30000 }
      );
    }
  });

  // Show picker row if already enabled
  if (preferredEnabled) {
    populateCampusSelect();
    showPickerRow(true);
  }

  // Retranslate all text nodes in this section
  function retranslate() {
    headerLabel.textContent       = t('settings.sectionCampus');
    preferredLabel.textContent    = t('settings.preferredCampus');
    autoLocateLabel.textContent   = t('settings.autoLocate');
    autoLocateSublabel.textContent = autoLocateDenied
      ? t('settings.locationDenied')
      : t('settings.autoLocateDesc');
    if (preferredEnabled && campusSelect.disabled && campusSelect.options[0]) {
      campusSelect.options[0].textContent = t('settings.noCampusData');
    }
  }

  retranslate();

  return { sectionEl: section, retranslate };
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

  // Append campus section
  const inner = popup.querySelector('.settings-popup__inner');
  const { sectionEl: campusSectionEl, retranslate: retranslateCampus } = buildCampusSection();
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
