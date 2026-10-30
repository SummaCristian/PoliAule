// The "not found" view, shared by the static 404 page (404.html, bundled as
// its own Vite entry) and, mounted in-app, by routes that point at nothing.
// It only builds the markup: where it goes and what its buttons do is up to
// the caller.
//
// The art is a glass classroom door of the room that isn't there: two taps
// knock, the third swings it open on an empty room, a tap on the open door
// shuts it again. The caption under it follows the knocks.
import { createButton } from 'vitrium';
import { t } from '../i18n.js';

const KNOCKS_TO_OPEN = 3;
const HOURS = ['08', '10', '12', '14', '16', '18', '20'];

// Line art of the empty room (a chair, a lamp on its cord), drawn in the
// door's 142x209 inner box
const ROOM_ART = `
  <svg class="nf-room-art" viewBox="0 0 142 209" fill="none" stroke="currentColor" stroke-width="2"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M71 0v30"/>
    <path d="M60 40a11 10 0 0 1 22 0z"/>
    <path d="M0 170h142" stroke-opacity=".5"/>
    <path d="M56 128v42M86 128v42M56 128h30M60 128V98a3 3 0 0 1 3-3h16a3 3 0 0 1 3 3v30"/>
    <path d="M100 163l7 7M104 159l2 11" stroke-opacity=".6"/>
  </svg>`;

// `onAction`: the home button (shown when given). `onSearch`: a second,
// plain button to the search, only when given. `icon` is ignored: the door is
// the art now.
export function createNotFound({
  title = t('notFound.title'),
  text = t('notFound.text'),
  actionLabel = t('notFound.home'),
  onAction,
  onSearch,
} = {}) {
  const el = document.createElement('div');
  el.className = 'not-found';
  el.innerHTML = `
    <div class="not-found-backdrop" aria-hidden="true"></div>
    <button type="button" class="nf-scene">
      <span class="nf-room">
        <span class="nf-lamp-glow"></span>
        ${ROOM_ART}
      </span>
      <span class="nf-door-wrap">
        <span class="nf-door">
          <span class="nf-plate"><span class="nf-plate-label">AULA</span><span class="nf-plate-number">404</span></span>
          <span class="nf-door-window"></span>
          <span class="nf-door-handle"></span>
        </span>
      </span>
      <span class="nf-ring"></span>
    </button>
    <div class="nf-floor" aria-hidden="true"></div>
    <p class="nf-caption" aria-live="polite"></p>
    <h1 class="not-found-title"></h1>
    <p class="not-found-text"></p>
    <section class="nf-room-card">
      <div class="nf-room-head">
        <h2 class="nf-room-name"></h2>
        <span class="nf-room-where"></span>
      </div>
      <div class="nf-daybar"></div>
      <div class="nf-hours" aria-hidden="true">${HOURS.map(h => `<span>${h}</span>`).join('')}</div>
    </section>
    <div class="not-found-actions"></div>
  `;
  el.querySelector('.not-found-title').textContent = title;
  el.querySelector('.not-found-text').textContent = text;
  el.querySelector('.nf-room-name').textContent = t('notFound.roomName');
  el.querySelector('.nf-room-where').textContent = t('notFound.roomWhere');
  el.querySelector('.nf-daybar').textContent = t('notFound.roomClosed');

  const scene = el.querySelector('.nf-scene');
  const caption = el.querySelector('.nf-caption');
  scene.setAttribute('aria-label', t('notFound.knockLabel'));
  caption.textContent = t('notFound.knock0');

  let knocks = 0;
  scene.addEventListener('click', () => {
    knocks = knocks >= KNOCKS_TO_OPEN ? 0 : knocks + 1;
    // Alternating names restart the rattle when knocks come faster than it ends
    scene.dataset.state = !knocks ? '' : knocks >= KNOCKS_TO_OPEN ? 'open' : knocks % 2 ? 'knock-a' : 'knock-b';
    caption.textContent = t(`notFound.knock${knocks}`);
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      caption.animate(
        [{ opacity: 0, transform: 'translateY(3px)' }, { opacity: 1, transform: 'none' }],
        { duration: 220, easing: 'ease-out' },
      );
    }
  });

  const actions = el.querySelector('.not-found-actions');
  if (onAction) {
    actions.appendChild(createButton({
      icon: '<i class="hgi-stroke hgi-home-01" aria-hidden="true"></i>',
      text: actionLabel,
      className: 'not-found-btn lg-glass--tinted',
      onClick: onAction,
    }));
  }
  if (onSearch) {
    actions.appendChild(createButton({
      icon: '<i class="hgi-stroke hgi-search-01" aria-hidden="true"></i>',
      text: t('notFound.search'),
      className: 'not-found-btn',
      onClick: onSearch,
    }));
  }
  return el;
}
