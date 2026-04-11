// components/time-picker.js
// Morph-card time picker component.
// Replaces each .time-picker wrapper with a card that morphs into a popup.

import { haptics, defaultPatterns } from './haptics.js';
import { t, onLanguageSwitch, animateI18nElement } from '../i18n.js';
import { createTimeFormatter } from '../utils/time-format.js';

const TRANSITION_DURATION = 420; // ms — must match CSS

// ── Breakpoint ────────────────────────────────────────────────────────────────

const DESKTOP_MQ = window.matchMedia('(min-width: 52rem)');

// ── State ────────────────────────────────────────────────────────────────────

let activeCard = null;
let isAnimating = false;

// ── Geometry helpers ─────────────────────────────────────────────────────────

function getPopupTarget() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(340, vw - 40);
  const h = 400;
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

// ── Time display formatter ────────────────────────────────────────────────────

// Track all active picker cards so they can be refreshed when the format changes.
const _allCards = new Set();

function formatTimeDisplay(val) {
  if (!val) return '--:--';
  const [h, m] = val.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return createTimeFormatter().format(d);
}

// Re-render all active card displays when the user changes the time format setting.
window.addEventListener('timeformatchange', () => {
  for (const card of _allCards) {
    const val = card._original?.value;
    if (card._timeDisplay) {
      card._timeDisplay.textContent = formatTimeDisplay(val);
      // Recalculate min-width for the new format (e.g. AM/PM may be wider).
      document.fonts.ready.then(() => {
        const sample = createTimeFormatter().format(new Date(2000, 0, 1, 12, 0));
        const w = measureTextWidth(sample, card._timeDisplay);
        card._timeDisplay.style.minWidth = `${Math.ceil(w)}px`;
      });
    }
    card._updateQuickLabel?.();
  }
});

// Measure the rendered pixel width of `text` as if styled like `referenceEl`.
function measureTextWidth(text, referenceEl) {
  const probe = document.createElement('span');
  const cs = getComputedStyle(referenceEl);
  probe.style.cssText = `
    position:absolute; visibility:hidden; white-space:nowrap; pointer-events:none;
    font-family:${cs.fontFamily}; font-size:${cs.fontSize};
    font-weight:${cs.fontWeight}; letter-spacing:${cs.letterSpacing};
  `;
  probe.textContent = text;
  document.body.appendChild(probe);
  const w = probe.getBoundingClientRect().width;
  probe.remove();
  return w;
}

// ── Overlay (created on open, removed on close) ──────────────────────────────

let overlay = null;

function getOverlay() {
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'tp-overlay';
    overlay.addEventListener('click', () => { haptics.trigger(defaultPatterns.success); closePicker(); });
    overlay.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
    overlay.addEventListener('wheel', e => e.preventDefault(), { passive: false });
    document.body.appendChild(overlay);
  }
  return overlay;
}

function removeOverlay() {
  if (!overlay) return;
  overlay.addEventListener('transitionend', () => {
    overlay.remove();
    overlay = null;
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

// ── transitionend with fallback ───────────────────────────────────────────────

function onTransitionEnd(el, cb) {
  const fallback = setTimeout(cb, TRANSITION_DURATION + 50);
  el.addEventListener('transitionend', () => {
    clearTimeout(fallback);
    cb();
  }, { once: true });
}

// ── Open / close / switch ─────────────────────────────────────────────────────

function switchPicker(nextCard) {
  if (isAnimating || !activeCard || nextCard === activeCard) return;
  isAnimating = true;

  const prevCard = activeCard;
  const prevPopup = prevCard._popup;
  const nextPopup = nextCard._popup;
  activeCard = nextCard;

  haptics.trigger(defaultPatterns.success);
  nextCard._updateQuickLabel?.();

  // ── Close outgoing: morph back to its card ───────────────────────────────
  prevCard._input.blur();
  prevPopup.classList.remove('tp-popup--open');
  prevCard.classList.remove('tp-card--morphing'); // card re-appears as the morph target

  const prevRect = prevCard.getBoundingClientRect();
  requestAnimationFrame(() => {
    applyGeometry(prevPopup, {
      left: prevRect.left,
      top: prevRect.top,
      width: prevRect.width,
      height: prevRect.height,
      borderRadius: '18px',
    });
    prevPopup.style.boxShadow = 'var(--shadow)';
  });

  onTransitionEnd(prevPopup, () => {
    prevPopup.style.display = 'none';
  });

  // ── Open incoming: morph from its card — simultaneously ──────────────────
  const nextRect = nextCard.getBoundingClientRect();

  nextPopup.style.transition = 'none';
  applyGeometry(nextPopup, {
    left: nextRect.left,
    top: nextRect.top,
    width: nextRect.width,
    height: nextRect.height,
    borderRadius: '18px',
  });
  nextPopup.style.boxShadow = 'var(--shadow)';
  nextPopup.style.zIndex = '1201'; // stay on top of the shrinking popup
  nextPopup.style.display = 'flex';
  nextCard.classList.add('tp-card--morphing');

  nextPopup.getBoundingClientRect(); // force reflow
  nextPopup.style.transition = '';

  requestAnimationFrame(() => {
    applyGeometry(nextPopup, getPopupTarget());
    nextPopup.style.boxShadow = 'var(--tp-shadow-lg)';
    nextPopup.classList.add('tp-popup--open');
  });

  onTransitionEnd(nextPopup, () => {
    nextPopup.style.zIndex = '';
    isAnimating = false;
    nextCard._input.focus();
  });
}

function openPicker(cardEl) {
  if (isAnimating) return;
  isAnimating = true;
  activeCard = cardEl;

  const popup = cardEl._popup;
  const rect = cardEl.getBoundingClientRect();

  lockScroll();

  // Snap popup over the card (no transition)
  popup.style.transition = 'none';
  applyGeometry(popup, {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
    borderRadius: '18px',
  });
  popup.style.boxShadow = 'var(--shadow)';
  popup.style.display = 'flex';

  cardEl.classList.add('tp-card--morphing');

  // Force reflow, then animate to centre
  popup.getBoundingClientRect();
  popup.style.transition = '';

  requestAnimationFrame(() => {
    applyGeometry(popup, getPopupTarget());
    popup.style.boxShadow = 'var(--tp-shadow-lg)';
    popup.classList.add('tp-popup--open');
    getOverlay().classList.add('tp-overlay--active');
  });

  onTransitionEnd(popup, () => {
    isAnimating = false;
    cardEl._input.focus();
  });
}

function closePicker() {
  if (isAnimating || !activeCard) return;
  isAnimating = true;

  const cardEl = activeCard;
  const popup = cardEl._popup;
  const rect = cardEl.getBoundingClientRect();

  cardEl._input.blur();
  popup.classList.remove('tp-popup--open');

  getOverlay().classList.remove('tp-overlay--active');
  removeOverlay();

  requestAnimationFrame(() => {
    applyGeometry(popup, {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      borderRadius: '18px',
    });
    popup.style.boxShadow = 'var(--shadow)';
  });

  onTransitionEnd(popup, () => {
    popup.style.display = 'none';
    cardEl.classList.remove('tp-card--morphing');
    activeCard = null;
    isAnimating = false;
    unlockScroll();
  });
}

// ── Build one time-picker instance ───────────────────────────────────────────

function buildTimePicker(wrapperEl) {
  // Grab existing label and input from the DOM
  const labelEl = wrapperEl.querySelector('label');
  const inputEl = wrapperEl.querySelector('input[type="time"]');
  if (!inputEl) return;

  // Use the input's id to determine which picker this is — locale-safe.
  const isFrom = inputEl.id === 'from-time-picker';
  const labelKey = isFrom ? 'form.fromTitle' : 'form.toTitle';
  const subtitleKey = isFrom ? 'form.fromSubtitle' : 'form.toSubtitle';

  // Hide original label + input (we still keep the input for form submission)
  if (labelEl) labelEl.hidden = true;
  inputEl.style.display = 'none';

  // ── Card ────────────────────────────────────────────────────────────────

  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'tp-card';
  card.innerHTML = `
    <div class="tp-card__icon-wrap">
      <span class="material-symbols-outlined">schedule</span>
    </div>
    <div class="tp-card__info">
      <span class="tp-card__label">${t(labelKey)}</span>
      <span class="tp-card__time">${formatTimeDisplay(inputEl.value)}</span>
    </div>
    <span class="material-symbols-outlined tp-card__chevron">chevron_right</span>
  `;

  wrapperEl.appendChild(card);

  // ── Popup ────────────────────────────────────────────────────────────────

  const popup = document.createElement('div');
  popup.className = 'tp-popup';
  popup.style.display = 'none';
  popup.innerHTML = `
    <div class="tp-popup__inner">
      <div class="tp-popup__header">
        <div class="tp-popup__header-text">
          <h4 class="subsection-header-title">${t(labelKey)}</h4>
          <p class="subsection-header-subtitle secondary">${t(subtitleKey)}</p>
        </div>
        <button type="button" class="tp-popup__switch">
          ${isFrom
            ? `<span class="tp-switch__label">${t('form.toTitle')}</span><span class="material-symbols-outlined">arrow_forward</span>`
            : `<span class="material-symbols-outlined">arrow_back</span><span class="tp-switch__label">${t('form.fromTitle')}</span>`}
        </button>
      </div>

      <div class="tp-popup__input-wrap">
        <span class="material-symbols-outlined tp-popup__clock">schedule</span>
      </div>

      <div class="tp-popup__step-btns">
        <button type="button" class="tp-popup__step button-primary button-secondary tp-step-minus">
          <span class="material-symbols-outlined">remove</span>
        </button>
        <button type="button" class="tp-popup__step button-primary button-secondary tp-step-plus">
          <span class="material-symbols-outlined">add</span>
        </button>
      </div>

      <div class="tp-popup__quick-btns">
        ${isFrom ? `
        <button type="button" class="tp-popup__quick button-primary tp-quick-now">
          <span class="material-symbols-outlined">near_me</span>
          <span class="tp-text-node">${t('timepicker.now')}</span>
        </button>` : ''}
        <button type="button" class="tp-popup__quick button-primary tp-quick-preset">
          <span class="material-symbols-outlined">schedule</span>
          <span class="tp-quick-label">${isFrom ? t('timepicker.currentSlot') : t('timepicker.fromPlusOne')}</span>
        </button>
      </div>

      <button type="button" class="tp-popup__done button-primary">
        <span class="material-symbols-outlined">check</span>
        <span class="tp-text-node">${t('timepicker.done')}</span>
      </button>
    </div>
  `;

  // Mount the native input inside the popup's input area
  const inputWrap = popup.querySelector('.tp-popup__input-wrap');
  const popupInput = inputEl.cloneNode(true);
  popupInput.style.display = '';
  popupInput.className = 'tp-popup__time-input';

  // Fix width to the widest possible time string for this locale (prevents layout shift)
  const widestSample = createTimeFormatter().format(new Date(2000, 0, 1, 12, 0)); // "12:00 PM" or "12:00"

  inputWrap.appendChild(popupInput);
  document.body.appendChild(popup);

  // ── // ── Cross-references ────────────────────────────────────────────────────

  card._popup = popup;
  card._input = popupInput;
  card._original = inputEl;
  card._timeDisplay = card.querySelector('.tp-card__time');
  card._isFrom = isFrom;
  card._switchBtn = popup.querySelector('.tp-popup__switch');
  _allCards.add(card);
  // Defer measurement until fonts are loaded so DS-Digital is available
  // Only fix the card display width (prevents layout shift as hours change 1→2 digits).
  // The popup input is left unsized so the browser can accommodate locale-specific
  // chrome (e.g. Firefox's AM/PM toggle) without clipping.
  document.fonts.ready.then(() => {
    const w = measureTextWidth(widestSample, card._timeDisplay);
    card._timeDisplay.style.minWidth = `${Math.ceil(w)}px`;
  });

  // ── Sync: popup input → original input + card display ──────────────────

  function syncValue(val) {
    inputEl.value = val;
    card._timeDisplay.textContent = formatTimeDisplay(val);
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  popupInput.addEventListener('input', () => syncValue(popupInput.value));

  const observer = new MutationObserver(() => {
    if (popupInput.value !== inputEl.value) popupInput.value = inputEl.value;
    card._timeDisplay.textContent = formatTimeDisplay(inputEl.value);
  });
  observer.observe(inputEl, { attributes: true, attributeFilter: ['value'] });

  const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  Object.defineProperty(inputEl, 'value', {
    get() { return originalDescriptor.get.call(this); },
    set(val) {
      originalDescriptor.set.call(this, val);
      popupInput.value = val;
      card._timeDisplay.textContent = formatTimeDisplay(val);
    },
    configurable: true,
  });

  const originalMinDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'min');
  Object.defineProperty(inputEl, 'min', {
    get() { return originalMinDescriptor.get.call(this); },
    set(val) {
      originalMinDescriptor.set.call(this, val);
      popupInput.min = val;
    },
    configurable: true,
  });

  // ── Preset buttons ────────────────────────────────────────────────────────

  function applyPreset(h, m) {
    const val = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    popupInput.value = val;
    syncValue(val);
    haptics.trigger(defaultPatterns.success);
  }

  popup.querySelector('.tp-quick-now')?.addEventListener('click', () => {
    const now = new Date();
    applyPreset(now.getHours(), now.getMinutes());
  });

  popup.querySelector('.tp-quick-preset').addEventListener('click', () => {
    const now = new Date();
    if (isFrom) {
      const h = now.getMinutes() >= 45
        ? (now.getHours() + 1) % 24
        : now.getHours();
      applyPreset(h, 15);
    } else {
      const fromInput = document.querySelector('.time-picker input[type="time"]');
      if (fromInput?.value) {
        const [fh, fm] = fromInput.value.split(':').map(Number);
        applyPreset((fh + 1) % 24, fm);
      } else {
        applyPreset((now.getHours() + 1) % 24, now.getMinutes());
      }
    }
  });

  // ── ±1h step buttons ──────────────────────────────────────────────────────

  function stepHour(delta) {
    const [h, m] = (popupInput.value || '00:00').split(':').map(Number);
    const next = ((h + delta) + 24) % 24;
    const val = `${String(next).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    popupInput.value = val;
    syncValue(val);
    haptics.trigger(defaultPatterns.success);
  }

  popup.querySelector('.tp-step-minus').addEventListener('click', () => stepHour(-1));
  popup.querySelector('.tp-step-plus').addEventListener('click', () => stepHour(+1));

  // ── Quick preset label ────────────────────────────────────────────────────

  const quickLabelEl = popup.querySelector('.tp-quick-label');

  function updateQuickLabel() {
    if (isFrom) {
      const now = new Date();
      const h = now.getMinutes() >= 45 ? (now.getHours() + 1) % 24 : now.getHours();
      quickLabelEl.textContent =
        formatTimeDisplay(`${String(h).padStart(2, '0')}:15`);
    } else {
      const fromInput = document.querySelector('.time-picker input[type="time"]');
      if (fromInput?.value) {
        const [fh, fm] = fromInput.value.split(':').map(Number);
        const h = (fh + 1) % 24;
        quickLabelEl.textContent =
          formatTimeDisplay(`${String(h).padStart(2, '0')}:${String(fm).padStart(2, '0')}`);
      } else {
        quickLabelEl.textContent = t('timepicker.fromPlusOne');
      }
    }
  }

  if (!isFrom) {
    const fromInput = document.querySelector('.time-picker input[type="time"]');
    if (fromInput) fromInput.addEventListener('input', updateQuickLabel);
  }
  updateQuickLabel();
  card._updateQuickLabel = updateQuickLabel;

  // ── Done button ───────────────────────────────────────────────────────────

  popup.querySelector('.tp-popup__done').addEventListener('click', () => {
    haptics.trigger(defaultPatterns.success);
    closePicker();
  });

  // ── Retranslate on language switch ────────────────────────────────────────

  const cardLabelEl = card.querySelector('.tp-card__label');
  const popupHeaderH4 = popup.querySelector('.tp-popup__header h4');
  const popupHeaderP = popup.querySelector('.tp-popup__header p');
  const nowBtnText = popup.querySelector('.tp-quick-now .tp-text-node');
  const doneBtnText = popup.querySelector('.tp-popup__done .tp-text-node');
  const switchLabelEl = popup.querySelector('.tp-switch__label');
  const switchLabelKey = isFrom ? 'form.toTitle' : 'form.fromTitle';

  onLanguageSwitch(() => {
    cardLabelEl.textContent = t(labelKey);
    animateI18nElement(cardLabelEl);
    popupHeaderH4.textContent = t(labelKey);
    animateI18nElement(popupHeaderH4);
    popupHeaderP.textContent = t(subtitleKey);
    animateI18nElement(popupHeaderP);
    if (nowBtnText) {
      nowBtnText.textContent = t('timepicker.now');
      animateI18nElement(nowBtnText);
    }
    doneBtnText.textContent = t('timepicker.done');
    animateI18nElement(doneBtnText);
    if (switchLabelEl) switchLabelEl.textContent = t(switchLabelKey);
    updateQuickLabel();
  });

  // ── Card click (mobile only) ──────────────────────────────────────────────

  card.addEventListener('click', () => {
    if (DESKTOP_MQ.matches) return; // inline on desktop — card is not a trigger
    haptics.trigger(defaultPatterns.success);
    updateQuickLabel();
    openPicker(card);
  });

  // ── Desktop inline mode ───────────────────────────────────────────────────

  function enterInlineMode() {
    // If a morph popup is open for this card, close it first
    if (activeCard === card) closePicker();

    popup.style.display = '';   // let CSS/flex take over
    popup.style.position = 'static';
    popup.style.width = '';
    popup.style.height = '';
    popup.style.top = '';
    popup.style.left = '';
    popup.style.boxShadow = 'none';
    popup.style.borderRadius = '';
    popup.style.transition = 'none';
    popup.classList.add('tp-popup--inline');
    popup.classList.add('tp-popup--open');  // keeps inner content visible

    card.classList.add('tp-card--inline');

    // Move popup into the wrapper so it participates in normal flow
    wrapperEl.appendChild(popup);
  }

  function exitInlineMode() {
    popup.classList.remove('tp-popup--inline');
    popup.classList.remove('tp-popup--open');
    popup.style.display = 'none';
    popup.style.position = '';
    popup.style.transition = '';
    card.classList.remove('tp-card--inline');

    // Return popup to body for morph positioning
    document.body.appendChild(popup);
  }

  function handleBreakpoint(e) {
    if (e.matches) {
      enterInlineMode();
    } else {
      exitInlineMode();
    }
  }

  DESKTOP_MQ.addEventListener('change', handleBreakpoint);

  // Set initial state
  if (DESKTOP_MQ.matches) enterInlineMode();
}

// ── Resize: keep open popup centred ─────────────────────────────────────────

window.addEventListener('resize', () => {
  if (!activeCard || isAnimating) return;
  const popup = activeCard._popup;
  popup.style.transition = 'none';
  applyGeometry(popup, getPopupTarget());
  popup.getBoundingClientRect();
  popup.style.transition = '';
});

// ── Escape → close ───────────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closePicker();
});

// ── Init ─────────────────────────────────────────────────────────────────────

export function initTimePickers() {
  document.querySelectorAll('.time-picker').forEach(buildTimePicker);

  // Wire up the switch buttons between From and To pickers
  const cards = [..._allCards];
  const fromCard = cards.find(c => c._isFrom);
  const toCard   = cards.find(c => !c._isFrom);
  if (fromCard && toCard) {
    fromCard._switchBtn?.addEventListener('click', () => switchPicker(toCard));
    toCard._switchBtn?.addEventListener('click',   () => switchPicker(fromCard));
  }
}