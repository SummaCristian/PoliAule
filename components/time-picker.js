// components/time-picker.js
// Morph-card time picker component.
// Replaces each .time-picker wrapper with a card that morphs into a popup.

import { haptics, defaultPatterns } from './haptics.js';

const TRANSITION_DURATION = 420; // ms — must match CSS

// ── Breakpoint ────────────────────────────────────────────────────────────────

const DESKTOP_MQ = window.matchMedia('(min-width: 768px)');

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

const TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
});

function formatTimeDisplay(val) {
  if (!val) return '--:--';
  const [h, m] = val.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return TIME_FORMATTER.format(d);
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

// ── Open / close ─────────────────────────────────────────────────────────────

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

  const labelText = labelEl?.querySelector('h4')?.textContent?.trim() ?? 'Time';
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
      <span class="tp-card__label">${labelText}</span>
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
        <h4 class="subsection-header-title">${labelEl?.querySelector('h4')?.textContent?.trim() ?? labelText}</h4>
        <p class="subsection-header-subtitle secondary">${labelEl?.querySelector('p')?.textContent?.trim() ?? ''}</p>
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
        ${labelText === 'From' ? `
        <button type="button" class="tp-popup__quick button-primary tp-quick-now">
          <span class="material-symbols-outlined">near_me</span>
          Now
        </button>` : ''}
        <button type="button" class="tp-popup__quick button-primary tp-quick-preset">
          <span class="material-symbols-outlined">schedule</span>
          <span class="tp-quick-label">${labelText === 'From' ? 'Current slot' : 'From +1h'}</span>
        </button>
      </div>

      <button type="button" class="tp-popup__done button-primary">
        <span class="material-symbols-outlined">check</span>
        Done
      </button>
    </div>
  `;

  // Mount the native input inside the popup's input area
  const inputWrap = popup.querySelector('.tp-popup__input-wrap');
  const popupInput = inputEl.cloneNode(true);
  popupInput.style.display = '';
  popupInput.className = 'tp-popup__time-input';
  inputWrap.appendChild(popupInput);
  document.body.appendChild(popup);

  // ── // ── Cross-references ────────────────────────────────────────────────────

  card._popup = popup;
  card._input = popupInput;
  card._original = inputEl;
  card._timeDisplay = card.querySelector('.tp-card__time');

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
    if (labelText === 'From') {
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

  // ── 'To' quick label ──────────────────────────────────────────────────────

  const quickLabelEl = popup.querySelector('.tp-quick-label');

  function updateQuickLabel() {
    if (labelText === 'From') return;
    const fromInput = document.querySelector('.time-picker input[type="time"]');
    if (fromInput?.value) {
      const [fh, fm] = fromInput.value.split(':').map(Number);
      const h = (fh + 1) % 24;
      quickLabelEl.textContent =
        `${String(h).padStart(2, '0')}:${String(fm).padStart(2, '0')}`;
    } else {
      quickLabelEl.textContent = 'From +1h';
    }
  }

  if (labelText !== 'From') {
    const fromInput = document.querySelector('.time-picker input[type="time"]');
    if (fromInput) fromInput.addEventListener('input', updateQuickLabel);
    updateQuickLabel();
  }

  // ── Done button ───────────────────────────────────────────────────────────

  popup.querySelector('.tp-popup__done').addEventListener('click', () => {
    haptics.trigger(defaultPatterns.success);
    closePicker();
  });

  // ── Card click (mobile only) ──────────────────────────────────────────────

  card.addEventListener('click', () => {
    if (DESKTOP_MQ.matches) return; // inline on desktop — card is not a trigger
    haptics.trigger(defaultPatterns.success);
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
}