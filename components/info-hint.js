// One-time discoverability hint under the header title ("Tap here to find out
// more"). Shows once, after a random delay, and never again once seen.
import { createPopover } from 'vitrium';
import { t } from '../i18n.js';

const SEEN_KEY = 'poliAule_infoHintSeen';
const MIN_DELAY_MS = 1000; //25_000;
const MAX_DELAY_MS = 6000; //60_000;

const store = {
  get: () => { try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return false; } },
  set: () => { try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private mode */ } },
};

export function initInfoHint() {
  if (store.get()) return;
  const trigger = document.getElementById('info-trigger');
  if (!trigger) return;

  let pop = null;
  let timer = null;

  const dismiss = () => {
    clearTimeout(timer);
    store.set();
    observer.disconnect();
    if (!pop) return;
    const p = pop;
    pop = null;
    p.hide();
    setTimeout(() => p.destroy(), 500);   // let the close animation finish
  };

  const show = () => {
    if (document.hidden) {
      timer = setTimeout(show, 10_000);
      return;
    }
    const content = document.createElement('div');
    content.className = 'info-hint';
    content.innerHTML =
      '<span class="info-hint-text"></span>' +
      '<button class="info-hint-close" type="button"><i class="hgi-stroke hgi-cancel-01" aria-hidden="true"></i></button>';
    content.querySelector('.info-hint-text').textContent = t('infoHint.text');
    const close = content.querySelector('.info-hint-close');
    close.setAttribute('aria-label', t('infoHint.dismiss'));
    close.addEventListener('click', dismiss);

    // Driven by hand (no `trigger`): the title button opens the info page, not
    // this. Not dismissable by a stray press, only by ✕ or opening the page.
    pop = createPopover({ content, placement: 'bottom-start', offset: -8, dismissable: false, role: 'status' });
    pop.show(trigger);
    store.set();
  };

  // Opening the info page by any route (tap, hash, shortcut) means the user
  // found it: dismiss the hint, or cancel it if it hasn't appeared yet.
  const observer = new MutationObserver(() => {
    if (document.body.classList.contains('info-open')) dismiss();
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  if (document.body.classList.contains('info-open')) return dismiss();

  timer = setTimeout(show, MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
}
