// components/settings.js
// The settings themselves: their storage keys, the start-up restorers, and the
// sections of controls, built once and handed to the settings page
// (components/settings-page.js), which owns the #settings route.

import { t, getLocale, setLocale, onLanguageSwitch, animateI18nElement, STORAGE_KEY as LOCALE_KEY } from '../i18n.js';
import { settingsPage } from './settings-page.js';
import { classroomsData } from '../available-rooms-script.js';
import { selectCampusById } from './campus-picker.js';
import { isSecondaryCampus } from '../utils/secondary.js';
import { STORAGE_KEY as TIME_FORMAT_KEY } from '../utils/time-format.js';
import { IS_STABLE_BUILD, USE_BETA_BACKEND_KEY } from '../config.js';
import { openTransferDialog } from './transfer-dialog.js';
import { seasonalEnabled, setSeasonalEnabled, SEASONAL_KEY } from '../utils/season.js';
import { presentWithBack } from '../utils/back-stack.js';
import { createToggle, createSegmentedControl, createStepper, createAlert, createButton, getBlurMode, setBlurMode, reevaluateBlurCapability, applyBlurState, BLUR_MODE_KEY } from 'vitrium';

export const PREFERRED_CAMPUS_ENABLED_KEY = 'poliAule_preferredCampusEnabled';
export const PREFERRED_CAMPUS_ID_KEY      = 'poliAule_preferredCampusId';
export const REMEMBER_LAST_CAMPUS_KEY     = 'poliAule_rememberLastCampus';
const LAST_CAMPUS_ID_KEY           = 'poliAule_lastCampusId';
export const HIDE_SUNDAYS_KEY             = 'poliAule_hideSundays';
export const SHOW_PARTIAL_KEY      = 'poliAule_showPartial';
export const INTERVAL_HOURS_KEY    = 'poliAule_intervalHours';
export const BLOCK_PAST_HOURS_KEY  = 'poliAule_blockPastHours';
export const DEFAULT_TAB_KEY       = 'poliAule_defaultTab';
export const LAST_TAB_KEY          = 'poliAule_lastTab';

// Returns the tab container ID to show on startup
export function getStartupTabId() {
  const mode = localStorage.getItem(DEFAULT_TAB_KEY) ?? 'available';
  if (mode === 'last') {
    return localStorage.getItem(LAST_TAB_KEY) ?? 'available-classrooms-container';
  }
  if (mode === 'search') return 'search-classrooms-container';
  return 'available-classrooms-container';
}

// ── State ─────────────────────────────────────────────────────────────────────

let langSegControl = null; // the language picker, re-synced when the locale changes elsewhere
let segControls = []; // segmented controls + toggles, re-measured whenever the page is shown
let refreshCampusSelectFn = null; // set by buildCampusSection, called on every open

// ── Reset ─────────────────────────────────────────────────────────────────────

// Every setting on the page, plus two left behind by the removed Auto-Search
// and Live Search toggles. Favourites, caches, the last tab / campus and the
// device's glass benchmark verdict are not settings, and stay.
const RESET_KEYS = [
  LOCALE_KEY, TIME_FORMAT_KEY, HIDE_SUNDAYS_KEY, INTERVAL_HOURS_KEY, BLOCK_PAST_HOURS_KEY,
  SHOW_PARTIAL_KEY, PREFERRED_CAMPUS_ENABLED_KEY, PREFERRED_CAMPUS_ID_KEY, REMEMBER_LAST_CAMPUS_KEY,
  DEFAULT_TAB_KEY, BLUR_MODE_KEY, SEASONAL_KEY, USE_BETA_BACKEND_KEY,
  'poliAule_autoSearch', 'poliAule_liveSearch',
];

// Clears them and reloads, like an import (components/transfer-dialog.js):
// most settings are only read at start-up. The page reopens on #settings.
async function confirmReset(from) {
  const alert = createAlert({
    title: t('settings.resetTitle'),
    message: t('settings.resetMessage'),
    transition: 'morph',
    actions: [
      { id: 'cancel', label: t('import.cancel'), role: 'cancel' },
      { id: 'reset', label: t('settings.resetButton'), role: 'destructive' },
    ],
  });
  const choice = await presentWithBack(alert, { from }); // Back cancels it
  setTimeout(() => alert.destroy(), 600);
  if (choice !== 'reset') return;
  for (const key of RESET_KEYS) {
    try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
  }
  location.reload();
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

// A row's action: Vitrium's glass pill in clear glass, sized for the row
// (settings.css). Its label follows the language through `data-i18n`.
function buildRowButton({ icon, textKey, className = '', onClick }) {
  const btn = createButton({ icon, text: t(textKey), className: `settings-row-btn lg-glass--clear ${className}`, onClick });
  btn.querySelector('.lg-button-label').dataset.i18n = textKey;
  return btn;
}

// Returns a createToggle() handle; assign `.onChange = isOn => ...` afterwards
// (Vitrium takes onChange at creation, but the handlers here are wired up after
// the rows exist, so the handle forwards to whatever was assigned last).
// Registered so the page can snap its thumb into place before it's shown.
function buildToggle(isOn) {
  let handler = null;
  const toggle = createToggle({ value: isOn, onChange: (v) => handler?.(v) });
  Object.defineProperty(toggle, 'onChange', { get: () => handler, set: (fn) => { handler = fn; } });
  segControls.push(toggle);
  return toggle;
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
        <i class="hgi-stroke hgi-location-01" aria-hidden="true"></i>
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
    <div class="settings-row__icon">
      <i class="hgi-stroke hgi-school-01" aria-hidden="true"></i>
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
  preferredRow.appendChild(preferredToggle.el);
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

  preferredToggle.onChange = (isOn) => {
    preferredEnabled = isOn;
    localStorage.setItem(PREFERRED_CAMPUS_ENABLED_KEY, String(preferredEnabled));
    if (preferredEnabled) {
      if (rememberLastEnabled) {
        rememberLastEnabled = false;
        localStorage.setItem(REMEMBER_LAST_CAMPUS_KEY, 'false');
        rememberLastToggle.set(false);
      }
      populateCampusSelect();
    }
    showPickerRow(preferredEnabled);
  };

  // ── Row 3: Remember Last Used toggle
  const rememberLastRow = document.createElement('div');
  rememberLastRow.className = 'settings-row';

  const rememberLastIconTitle = document.createElement('div');
  rememberLastIconTitle.className = 'settings-row__icon-title-container';
  rememberLastIconTitle.innerHTML = `
    <div class="settings-row__icon">
      <i class="hgi-stroke hgi-history" aria-hidden="true"></i>
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
  rememberLastRow.appendChild(rememberLastToggle.el);
  group.appendChild(rememberLastRow);

  rememberLastToggle.onChange = (isOn) => {
    rememberLastEnabled = isOn;
    localStorage.setItem(REMEMBER_LAST_CAMPUS_KEY, String(rememberLastEnabled));
    if (rememberLastEnabled && preferredEnabled) {
      preferredEnabled = false;
      localStorage.setItem(PREFERRED_CAMPUS_ENABLED_KEY, 'false');
      preferredToggle.set(false);
      showPickerRow(false);
    }
  };

  // Save last used campus whenever the campus selection changes
  // Not a secondary campus: only the Campus tab lists those, and the Available
  // tab's picker couldn't restore one.
  document.addEventListener('campuschange', (e) => {
    if (rememberLastEnabled && !isSecondaryCampus(e.detail.id)) {
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

  // Called each time the page opens so the select is populated with live data
  function refreshIfNeeded() {
    if (preferredEnabled) populateCampusSelect();
  }

  return { sectionEl: section, retranslate, refreshIfNeeded };
}

// ── Page content ──────────────────────────────────────────────────────────────

// Two columns on wide screens (see .settings-column in settings.css): what
// shapes the search on the left, the app itself on the right.
function buildContent() {
  const content = document.createElement('div');
  content.className = 'settings-body';
  content.innerHTML = `
     <div class="settings-column" data-settings-column-search>
      <div class="settings-section">
        <div class="settings-section__header">
          <div class="settings-section__icon-badge">
            <i class="hgi-stroke hgi-translate" aria-hidden="true"></i>
          </div>
          <span class="settings-section__header-label">${t('settings.language')}</span>
        </div>
        <div class="settings-group">
          <div class="settings-row">
            <div class="settings-row__icon-title-container">
              <div class="settings-row__icon">
                <i class="hgi-stroke hgi-languages" aria-hidden="true"></i>
              </div>
              <div class="settings-row__label-group">
                <span class="settings-row__label" data-i18n="settings.language">${t('settings.language')}</span>
                <span class="settings-row__sublabel" data-i18n="settings.languageDesc">${t('settings.languageDesc')}</span>
              </div>
            </div>
            <div data-lang-toggle>
              <button class="lg-seg__item" data-value="en">
                <span class="settings-lang-btn__flag">🇬🇧</span>
                <span class="settings-lang-btn__name">English</span>
              </button>
              <button class="lg-seg__item" data-value="it">
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
            <i class="hgi-stroke hgi-calendar-03" aria-hidden="true"></i>
          </div>
          <span class="settings-section__header-label" data-timefmt-section-header>${t('settings.sectionDateTime')}</span>
        </div>
        <div class="settings-group">
          <div class="settings-row">
            <div class="settings-row__icon-title-container">
              <div class="settings-row__icon">
                <i class="hgi-stroke hgi-clock-01" aria-hidden="true"></i>
              </div>
              <div class="settings-row__label-group">
                <span class="settings-row__label" data-i18n="settings.timeFormat">${t('settings.timeFormat')}</span>
                <span class="settings-row__sublabel" data-i18n="settings.timeFormatDesc">${t('settings.timeFormatDesc')}</span>
              </div>
            </div>
            <div data-timefmt-toggle>
              <button class="lg-seg__item" data-value="system">
                <span class="settings-lang-btn__name" data-i18n="settings.timeFormat.system">${t('settings.timeFormat.system')}</span>
              </button>
              <button class="lg-seg__item" data-value="12">
                <span class="settings-lang-btn__name" data-i18n="settings.timeFormat.12h">${t('settings.timeFormat.12h')}</span>
              </button>
              <button class="lg-seg__item" data-value="24">
                <span class="settings-lang-btn__name" data-i18n="settings.timeFormat.24h">${t('settings.timeFormat.24h')}</span>
              </button>
            </div>
          </div>
          <div class="settings-row" data-hide-sundays-row>
            <div class="settings-row__icon-title-container">
              <div class="settings-row__icon">
                <i class="hgi-stroke hgi-calendar-remove-01" aria-hidden="true"></i>
              </div>
              <div class="settings-row__label-group">
                <span class="settings-row__label" data-i18n="settings.hideSundays">${t('settings.hideSundays')}</span>
                <span class="settings-row__sublabel" data-i18n="settings.hideSundaysDesc">${t('settings.hideSundaysDesc')}</span>
              </div>
            </div>
          </div>
          <div class="settings-row" data-interval-hours-row>
            <div class="settings-row__icon-title-container">
              <div class="settings-row__icon">
                <i class="hgi-stroke hgi-hourglass" aria-hidden="true"></i>
              </div>
              <div class="settings-row__label-group">
                <span class="settings-row__label" data-i18n="settings.intervalHours">${t('settings.intervalHours')}</span>
                <span class="settings-row__sublabel" data-i18n="settings.intervalHoursDesc">${t('settings.intervalHoursDesc')}</span>
              </div>
            </div>
          </div>
          <div class="settings-row" data-block-past-hours-row>
            <div class="settings-row__icon-title-container">
              <div class="settings-row__icon">
                <i class="hgi-stroke hgi-time-quarter-pass" aria-hidden="true"></i>
              </div>
              <div class="settings-row__label-group">
                <span class="settings-row__label" data-i18n="settings.blockPastHours">${t('settings.blockPastHours')}</span>
                <span class="settings-row__sublabel" data-i18n="settings.blockPastHoursDesc">${t('settings.blockPastHoursDesc')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section__header">
          <div class="settings-section__icon-badge">
            <i class="hgi-stroke hgi-search-01" aria-hidden="true"></i>
          </div>
          <span class="settings-section__header-label" data-i18n="settings.sectionResults">${t('settings.sectionResults')}</span>
        </div>
        <div class="settings-group">
          <div class="settings-row" data-show-partial-row>
            <div class="settings-row__icon-title-container">
              <div class="settings-row__icon">
                <i class="hgi-stroke hgi-filter" aria-hidden="true"></i>
              </div>
              <div class="settings-row__label-group">
                <span class="settings-row__label" data-i18n="settings.showPartial">${t('settings.showPartial')}</span>
                <span class="settings-row__sublabel" data-i18n="settings.showPartialDesc">${t('settings.showPartialDesc')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

     </div>
     <div class="settings-column">

      <div class="settings-section">
        <div class="settings-section__header">
          <div class="settings-section__icon-badge">
            <i class="hgi-stroke hgi-browser" aria-hidden="true"></i>
          </div>
          <span class="settings-section__header-label" data-defaulttab-section-header>${t('settings.sectionNavigation')}</span>
        </div>
        <div class="settings-group">
          <div class="settings-row">
            <div class="settings-row__icon-title-container">
              <div class="settings-row__icon">
                <i class="hgi-stroke hgi-browser" aria-hidden="true"></i>
              </div>
              <div class="settings-row__label-group">
                <span class="settings-row__label" data-i18n="settings.defaultTab">${t('settings.defaultTab')}</span>
                <span class="settings-row__sublabel" data-i18n="settings.defaultTab.desc">${t('settings.defaultTab.desc')}</span>
              </div>
            </div>
            <!-- The tab bar's own icons (TABS in components/bottom-nav.js) -->
            <div data-defaulttab-toggle>
              <button class="lg-seg__item" data-value="available">
                <i class="hgi-stroke hgi-calendar-03 settings-seg-icon" aria-hidden="true"></i>
                <span class="settings-lang-btn__name" data-i18n="settings.defaultTab.available">${t('settings.defaultTab.available')}</span>
              </button>
              <button class="lg-seg__item" data-value="search">
                <i class="hgi-stroke hgi-university settings-seg-icon" aria-hidden="true"></i>
                <span class="settings-lang-btn__name" data-i18n="settings.defaultTab.search">${t('settings.defaultTab.search')}</span>
              </button>
              <div class="lg-seg__separator"></div>
              <button class="lg-seg__item" data-value="last">
                <i class="hgi-stroke hgi-history settings-seg-icon" aria-hidden="true"></i>
                <span class="settings-lang-btn__name" data-i18n="settings.defaultTab.last">${t('settings.defaultTab.last')}</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section__header">
          <div class="settings-section__icon-badge">
            <i class="hgi-stroke hgi-blur" aria-hidden="true"></i>
          </div>
          <span class="settings-section__header-label" data-blurmode-section-header>${t('settings.sectionAppearance')}</span>
        </div>
        <div class="settings-group">
          <div class="settings-row">
            <div class="settings-row__icon-title-container">
              <div class="settings-row__icon">
                <i class="hgi-stroke hgi-layers-01" aria-hidden="true"></i>
              </div>
              <div class="settings-row__label-group">
                <span class="settings-row__label" data-i18n="settings.glassEffect">${t('settings.glassEffect')}</span>
                <span class="settings-row__sublabel" data-i18n="settings.glassEffectDesc">${t('settings.glassEffectDesc')}</span>
              </div>
            </div>
            <div data-blurmode-toggle>
              <button class="lg-seg__item" data-value="auto">
                <span class="settings-lang-btn__name" data-i18n="settings.glassEffect.auto">${t('settings.glassEffect.auto')}</span>
              </button>
              <button class="lg-seg__item" data-value="on">
                <span class="settings-lang-btn__name" data-i18n="settings.glassEffect.on">${t('settings.glassEffect.on')}</span>
              </button>
              <button class="lg-seg__item" data-value="off">
                <span class="settings-lang-btn__name" data-i18n="settings.glassEffect.off">${t('settings.glassEffect.off')}</span>
              </button>
            </div>
          </div>
          <div class="settings-row" data-seasonal-row>
            <div class="settings-row__icon-title-container">
              <div class="settings-row__icon">
                <i class="hgi-stroke hgi-fireworks" aria-hidden="true"></i>
              </div>
              <div class="settings-row__label-group">
                <span class="settings-row__label" data-i18n="settings.seasonal">${t('settings.seasonal')}</span>
                <span class="settings-row__sublabel" data-i18n="settings.seasonalDesc">${t('settings.seasonalDesc')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="settings-section">
        <div class="settings-section__header">
          <div class="settings-section__icon-badge">
            <i class="hgi-stroke hgi-arrow-data-transfer-horizontal" aria-hidden="true"></i>
          </div>
          <span class="settings-section__header-label" data-i18n="settings.sectionTransfer">${t('settings.sectionTransfer')}</span>
        </div>
        <div class="settings-group">
          <div class="settings-row" data-transfer-row>
            <div class="settings-row__icon-title-container">
              <div class="settings-row__icon">
                <i class="hgi-stroke hgi-smart-phone-01" aria-hidden="true"></i>
              </div>
              <div class="settings-row__label-group">
                <span class="settings-row__label" data-i18n="settings.transfer">${t('settings.transfer')}</span>
                <span class="settings-row__sublabel" data-i18n="settings.transferDesc">${t('settings.transferDesc')}</span>
              </div>
            </div>
            <span class="settings-row__action" data-transfer-slot></span>
          </div>
        </div>
      </div>

      ${IS_STABLE_BUILD ? '' : `
      <div class="settings-section">
        <div class="settings-section__header">
          <div class="settings-section__icon-badge">
            <i class="hgi-stroke hgi-server" aria-hidden="true"></i>
          </div>
          <span class="settings-section__header-label" data-i18n="settings.sectionBackend">${t('settings.sectionBackend')}</span>
        </div>
        <div class="settings-group">
          <div class="settings-row" data-use-beta-backend-row>
            <div class="settings-row__icon-title-container">
              <div class="settings-row__icon">
                <i class="hgi-stroke hgi-test-tube-01" aria-hidden="true"></i>
              </div>
              <div class="settings-row__label-group">
                <span class="settings-row__label" data-i18n="settings.useBetaBackend">${t('settings.useBetaBackend')}</span>
                <span class="settings-row__sublabel" data-i18n="settings.useBetaBackendDesc">${t('settings.useBetaBackendDesc')}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      `}

      <div class="settings-section">
        <div class="settings-section__header">
          <div class="settings-section__icon-badge">
            <i class="hgi-stroke hgi-arrow-turn-backward" aria-hidden="true"></i>
          </div>
          <span class="settings-section__header-label" data-i18n="settings.sectionReset">${t('settings.sectionReset')}</span>
        </div>
        <div class="settings-group">
          <div class="settings-row">
            <div class="settings-row__icon-title-container">
              <div class="settings-row__icon">
                <i class="hgi-stroke hgi-settings-error-01" aria-hidden="true"></i>
              </div>
              <div class="settings-row__label-group">
                <span class="settings-row__label" data-i18n="settings.reset">${t('settings.reset')}</span>
                <span class="settings-row__sublabel" data-i18n="settings.resetDesc">${t('settings.resetDesc')}</span>
              </div>
            </div>
            <span class="settings-row__action" data-reset-slot></span>
          </div>
        </div>
      </div>
     </div>
  `;

  // The campus section, right after the language
  const { sectionEl: campusSectionEl, retranslate: retranslateCampus, refreshIfNeeded } = buildCampusSection();
  refreshCampusSelectFn = refreshIfNeeded;
  content.querySelector('[data-settings-column-search] > .settings-section').after(campusSectionEl);

  // Segmented controls (glass pill w/ tabbar tap + drag, see segmented-control.js)
  const langSeg = createSegmentedControl(content.querySelector('[data-lang-toggle]'), {
    value: getLocale(),
    async onSelect(lang) {
      if (lang === getLocale()) return;
      await setLocale(lang);
    },
  });

  const timeFmtSeg = createSegmentedControl(content.querySelector('[data-timefmt-toggle]'), {
    value: localStorage.getItem(TIME_FORMAT_KEY) ?? 'system',
    onSelect(fmt, { silent }) {
      if (silent) return;
      localStorage.setItem(TIME_FORMAT_KEY, fmt);
      window.dispatchEvent(new CustomEvent('timeformatchange'));
    },
  });

  // Wire Hide Sundays toggle
  const hideSundaysRow = content.querySelector('[data-hide-sundays-row]');
  const hideSundaysToggle = buildToggle(localStorage.getItem(HIDE_SUNDAYS_KEY) === 'true');
  hideSundaysRow.appendChild(hideSundaysToggle.el);
  hideSundaysToggle.onChange = (isOn) => {
    localStorage.setItem(HIDE_SUNDAYS_KEY, String(isOn));
    window.dispatchEvent(new CustomEvent('hidesundayschange', { detail: { hidden: isOn } }));
  };

  // Wire Interval Hours stepper
  const intervalHoursRow = content.querySelector('[data-interval-hours-row]');
  // Vitrium's stepper, with the value in place of its separator, like the
  // time lens's duration (components/hour-lens.js)
  const savedHours = parseInt(localStorage.getItem(INTERVAL_HOURS_KEY), 10) || 2;
  const intervalLabel = document.createElement('span');
  intervalLabel.className = 'settings-stepper-value';
  const showHours = (v) => { intervalLabel.textContent = `${v}h`; };
  showHours(savedHours);
  const intervalStepper = createStepper({
    value: savedHours, min: 1, max: 12, step: 1,
    label: t('settings.intervalHours'),
    labels: [t('timepicker.shorter'), t('timepicker.longer')],
    format: (v) => `${v}h`,
    onChange: (v) => {
      showHours(v);
      localStorage.setItem(INTERVAL_HOURS_KEY, String(v));
    },
  });
  intervalStepper.el.querySelector('.lg-stepper__separator').replaceWith(intervalLabel);
  intervalHoursRow.appendChild(intervalStepper.el);

  // Wire Block Past Hours toggle (default: true)
  const blockPastRow = content.querySelector('[data-block-past-hours-row]');
  const blockPastToggle = buildToggle(localStorage.getItem(BLOCK_PAST_HOURS_KEY) !== 'false');
  blockPastRow.appendChild(blockPastToggle.el);
  blockPastToggle.onChange = (isOn) => {
    localStorage.setItem(BLOCK_PAST_HOURS_KEY, String(isOn));
    window.dispatchEvent(new CustomEvent('blockpasthourschange', { detail: { blocked: isOn } }));
  };

  // Wire Seasonal Decorations toggle (default: true)
  const seasonalRow = content.querySelector('[data-seasonal-row]');
  const seasonalToggle = buildToggle(seasonalEnabled());
  seasonalRow.appendChild(seasonalToggle.el);
  seasonalToggle.onChange = (isOn) => setSeasonalEnabled(isOn);
  // A season turned on or off from the search moves the toggle too
  window.addEventListener('seasonalchange', () => seasonalToggle.set(seasonalEnabled(), { animate: false }));

  // Wire Show Partially Free toggle (default: true)
  const showPartialRow = content.querySelector('[data-show-partial-row]');
  const showPartialSaved = localStorage.getItem(SHOW_PARTIAL_KEY);
  const showPartialToggle = buildToggle(showPartialSaved === null ? true : showPartialSaved === 'true');
  showPartialRow.appendChild(showPartialToggle.el);
  showPartialToggle.onChange = (isOn) => {
    localStorage.setItem(SHOW_PARTIAL_KEY, String(isOn));
  };

  const defaultTabSeg = createSegmentedControl(content.querySelector('[data-defaulttab-toggle]'), {
    value: localStorage.getItem(DEFAULT_TAB_KEY) ?? 'available',
    onSelect(val, { silent }) {
      if (silent) return;
      localStorage.setItem(DEFAULT_TAB_KEY, val);
    },
  });

  const blurModeSeg = createSegmentedControl(content.querySelector('[data-blurmode-toggle]'), {
    value: getBlurMode(),
    onSelect(mode, { silent }) {
      if (silent) return;
      setBlurMode(mode);
      // Apply right away instead of waiting for the next splash screen: "on"/"off"
      // are immediate, "auto" re-runs the benchmark since the cached verdict may
      // now be stale (e.g. the mode was forced off, then set back to auto).
      if (mode === 'off') applyBlurState(false);
      else if (mode === 'on') applyBlurState(true);
      else reevaluateBlurCapability();
    },
  });

  langSegControl = langSeg;
  segControls.push(langSeg, timeFmtSeg, defaultTabSeg, blurModeSeg);

  // Transfer to another device: QR dialog grows out of the button
  const transferBtn = buildRowButton({
    icon: '<i class="hgi-stroke hgi-qr-code" aria-hidden="true"></i>',
    textKey: 'settings.transferShow',
    onClick: () => openTransferDialog(transferBtn),
  });
  content.querySelector('[data-transfer-slot]').replaceWith(transferBtn);

  // Reset: asks first (the alert grows out of the button)
  const resetBtn = buildRowButton({
    textKey: 'settings.resetButton',
    className: 'lg-glass--tinted settings-row-btn--destructive',
    onClick: () => confirmReset(resetBtn),
  });
  content.querySelector('[data-reset-slot]').replaceWith(resetBtn);

  // Wire Use Beta Backend toggle (non-stable builds only, default: true)
  const useBetaBackendRow = content.querySelector('[data-use-beta-backend-row]');
  if (useBetaBackendRow) {
    const useBetaBackendSaved = localStorage.getItem(USE_BETA_BACKEND_KEY);
    const useBetaBackendOn = useBetaBackendSaved === null ? true : useBetaBackendSaved === 'true';
    const useBetaBackendToggle = buildToggle(useBetaBackendOn);
    useBetaBackendRow.appendChild(useBetaBackendToggle.el);
    useBetaBackendToggle.onChange = (isOn) => {
      localStorage.setItem(USE_BETA_BACKEND_KEY, String(isOn));
    };
  }

  return { content, retranslateCampus };
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initSettings() {
  const { content, retranslateCampus } = buildContent();

  settingsPage.init(content, {
    onShow() {
      segControls.forEach(c => c.refresh({ snap: true })); // place pills, now that they're laid out
      refreshCampusSelectFn?.();            // re-populate campus select now that data may be loaded
    },
  });

  // Keep the section headers in sync when the language changes
  const sectionHeaderLabelEl = content.querySelector('.settings-section__header-label');
  const timeFmtHeaderLabelEl = content.querySelector('[data-timefmt-section-header]');
  const defaultTabHeaderLabelEl = content.querySelector('[data-defaulttab-section-header]');
  const blurModeHeaderLabelEl = content.querySelector('[data-blurmode-section-header]');

  onLanguageSwitch(() => {
    sectionHeaderLabelEl.textContent = t('settings.language');
    animateI18nElement(sectionHeaderLabelEl);
    if (timeFmtHeaderLabelEl) {
      timeFmtHeaderLabelEl.textContent = t('settings.sectionDateTime');
      animateI18nElement(timeFmtHeaderLabelEl);
    }
    if (defaultTabHeaderLabelEl) {
      defaultTabHeaderLabelEl.textContent = t('settings.sectionNavigation');
      animateI18nElement(defaultTabHeaderLabelEl);
    }
    if (blurModeHeaderLabelEl) {
      blurModeHeaderLabelEl.textContent = t('settings.sectionAppearance');
      animateI18nElement(blurModeHeaderLabelEl);
    }
    content.querySelectorAll('[data-i18n]').forEach(el => {
      el.textContent = t(el.dataset.i18n);
    });
    // Labels just changed width; re-measure without animating.
    segControls.forEach(c => c.refresh({ snap: true }));
    langSegControl?.select(getLocale());   // language control, in case the switch came from elsewhere
    retranslateCampus();
  });
}
