// components/time-picker.js
// Morph-card time picker component.
// Replaces each .time-picker wrapper with a card that morphs into a popup.

import { haptics, defaultPatterns } from './haptics.js';

const TRANSITION_DURATION = 420; // ms — must match CSS

// ── State ────────────────────────────────────────────────────────────────────

let activeCard = null;
let isAnimating = false;

// ── Geometry helpers ─────────────────────────────────────────────────────────

function getPopupTarget() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(340, vw - 40);
  const h = 220; // fixed height — content is compact
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

// ── Open / close ─────────────────────────────────────────────────────────────

function openPicker(cardEl) {
  if (isAnimating) return;
  isAnimating = true;
  activeCard = cardEl;

  const popup = cardEl._popup;
  const rect = cardEl.getBoundingClientRect();

  // Block scrolling
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

  popup.addEventListener('transitionend', () => {
    isAnimating = false;
    // Focus the native input so mobile keyboard / spinner appears
    cardEl._input.focus();
  }, { once: true });
}

function closePicker() {
  if (isAnimating || !activeCard) return;
  isAnimating = true;

  const cardEl = activeCard;
  const popup = cardEl._popup;
  const rect = cardEl.getBoundingClientRect();

  cardEl._input.blur();
  popup.classList.remove('tp-popup--open');

  const ov = getOverlay();
  ov.classList.remove('tp-overlay--active');
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

  popup.addEventListener('transitionend', () => {
    popup.style.display = 'none';
    cardEl.classList.remove('tp-card--morphing');
    activeCard = null;
    isAnimating = false;

    // Re-enable scrolling
    unlockScroll();

  }, { once: true });
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
      <span class="tp-card__time">${inputEl.value || '--:--'}</span>
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
      <p class="tp-popup__title">${labelText}</p>
      <div class="tp-popup__input-wrap">
        <span class="material-symbols-outlined tp-popup__clock">schedule</span>
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

  // ── Cross-references ────────────────────────────────────────────────────

  card._popup = popup;
  card._input = popupInput;   // input inside popup
  card._original = inputEl;   // original hidden input (form reads this)
  card._timeDisplay = card.querySelector('.tp-card__time');

  // ── Sync: popup input → original input + card display ──────────────────

  function syncValue(val) {
    inputEl.value = val;
    card._timeDisplay.textContent = val || '--:--';
    // Dispatch 'input' on the original so setupTimePickers() constraints still fire
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  }

  popupInput.addEventListener('input', () => syncValue(popupInput.value));

  // Keep popup input in sync whenever the original is updated externally
  // (e.g. setupTimePickers adjusting the 'to' value)
  const observer = new MutationObserver(() => {
    if (popupInput.value !== inputEl.value) popupInput.value = inputEl.value;
    card._timeDisplay.textContent = inputEl.value || '--:--';
  });
  observer.observe(inputEl, { attributes: true, attributeFilter: ['value'] });

  // Also watch via a plain setter shim so programmatic .value = '...' is caught
  const originalDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  Object.defineProperty(inputEl, 'value', {
    get() { return originalDescriptor.get.call(this); },
    set(val) {
      originalDescriptor.set.call(this, val);
      popupInput.value = val;
      card._timeDisplay.textContent = val || '--:--';
    },
    configurable: true,
  });

  // ── Events ────────────────────────────────────────────────────────────

  card.addEventListener('click', () => {
    haptics.trigger(defaultPatterns.success);
    openPicker(card);
  });

  popup.querySelector('.tp-popup__done').addEventListener('click', () => {
    haptics.trigger(defaultPatterns.success);
    closePicker();
  });
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

// ── Overlay click → close ────────────────────────────────────────────────────

getOverlay().addEventListener('click', () => {
  haptics.trigger(defaultPatterns.success);
  closePicker();
});

// ── Escape → close ───────────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closePicker();
});

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


// ── Init ─────────────────────────────────────────────────────────────────────

export function initTimePickers() {
  document.querySelectorAll('.time-picker').forEach(buildTimePicker);
}