// i18n.js — lightweight localization module

const SUPPORTED = ['en', 'it'];
const STORAGE_KEY = 'poliAule_locale';

let translations = {};
let currentLocale = 'en';
const switchCallbacks = [];
let _isLangSwitch = false;

export async function initI18n() {
  const saved = localStorage.getItem(STORAGE_KEY);
  const detected = navigator.language.slice(0, 2).toLowerCase();
  currentLocale = SUPPORTED.includes(saved) ? saved
               : SUPPORTED.includes(detected) ? detected
               : 'en';
  await loadLocale(currentLocale);
}

async function loadLocale(lang) {
  try {
    const res = await fetch(`/locales/${lang}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    translations = await res.json();
    currentLocale = lang;
    document.documentElement.lang = lang;
  } catch (e) {
    console.warn(`i18n: failed to load locale "${lang}"`, e);
    translations = {};
  }
}

// Synchronous key lookup — call only after initI18n() resolves.
// Falls back to the key name itself so missing strings are visible.
export function t(key) {
  return translations[key] ?? key;
}

export function animateI18nElement(el) {
  el.classList.remove('i18n-animate');
  el.offsetWidth; // force reflow — restarts animation on repeated switches
  el.classList.add('i18n-animate');
}

export function getLocale() {
  return currentLocale;
}

// Walk [data-i18n] and [data-i18n-attr] nodes and apply current translations.
export function applyTranslations(root = document) {
  root.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
    if (_isLangSwitch) animateI18nElement(el);
  });
  root.querySelectorAll('[data-i18n-attr]').forEach(el => {
    el.dataset.i18nAttr.split(',').forEach(pair => {
      const [attr, key] = pair.split(':');
      el.setAttribute(attr, t(key));
    });
  });
}

// Register a callback to be invoked after every locale switch.
// Components with JS-built DOM use this to retranslate in-place.
export function onLanguageSwitch(cb) {
  switchCallbacks.push(cb);
}

export async function setLocale(lang) {
  if (!SUPPORTED.includes(lang) || lang === currentLocale) return;
  await loadLocale(lang);
  localStorage.setItem(STORAGE_KEY, lang);
  _isLangSwitch = true;
  applyTranslations();
  _isLangSwitch = false;
  switchCallbacks.forEach(cb => cb(lang));
}
