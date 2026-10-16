// The "not found" view, shared by the static 404 page (404.html, bundled as
// its own Vite entry) and, mounted in-app, by routes that point at nothing.
// It only builds the markup: where it goes and what its button does is up to
// the caller.
import { createButton } from 'vitrium';
import { t } from '../i18n.js';

// `icon` is an HTML string (a Hugeicons <i>, an <img>); defaults to the logo.
export function createNotFound({
  icon = '<img src="/favicons/main/logo.webp" alt="" width="96" height="96">',
  title = t('notFound.title'),
  text = t('notFound.text'),
  actionLabel = t('notFound.home'),
  onAction,
} = {}) {
  const el = document.createElement('div');
  el.className = 'not-found';
  el.innerHTML = `
    <div class="not-found-art" aria-hidden="true">${icon}</div>
    <h1 class="not-found-title"></h1>
    <p class="not-found-text"></p>
  `;
  el.querySelector('.not-found-title').textContent = title;
  el.querySelector('.not-found-text').textContent = text;
  if (onAction) {
    el.appendChild(createButton({
      icon: '<i class="hgi-stroke hgi-home-01" aria-hidden="true"></i>',
      text: actionLabel,
      className: 'not-found-btn lg-glass--tinted',
      onClick: onAction,
    }));
  }
  return el;
}
