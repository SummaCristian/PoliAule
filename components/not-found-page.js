// "Not found" as an in-app page: any hash the app doesn't own (#nope) shows
// the shared not-found view (components/not-found.js) over the tabs, on the
// same footing as Info and Settings (the tab bar is swapped for the back
// button). Plain swaps, no morph: it's an edge case, not a destination.
//
// A #changelog/ version that doesn't exist stays with the changelog page.
import { t, onLanguageSwitch } from '../i18n.js';
import { createNotFound } from './not-found.js';
import { classroomDetail } from './classroom-detail.js';

// Every hash that belongs to something: the pages, a transfer link, no hash.
// #classroom/ is known only if it names a room (classroomDetail.isUnknownHash).
const KNOWN_HASH_RE = /^(#info|#settings|#changelog(\/[\w.-]+)?|#import=.*)?$/;
const CLASSROOM_HASH_RE = /^#classroom\//;

class NotFoundPage {
  constructor() {
    this._overlay = null;
    this._tabbar = null;
    this._backBtn = null;
    this._isOpen = false;
    this._savedScroll = 0;
  }

  init() {
    this._overlay = document.getElementById('not-found-overlay');
    this._tabbar = document.querySelector('.bn-wrapper');
    this._backBtn = document.getElementById('detail-back-btn');
    if (!this._overlay) return;

    // Capture phase, so it runs before the other pages' handlers on the same button
    this._backBtn?.addEventListener('click', (e) => {
      if (!this._isOpen) return;
      e.stopImmediatePropagation();
      this._goHome();
    }, { capture: true });

    window.addEventListener('hashchange', () => this._onHashChange());

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this._isOpen || e.defaultPrevented) return;
      e.preventDefault();
      this._goHome();
    });

    onLanguageSwitch(() => { if (this._isOpen) this._render(); });

    // With no splash (it's gone already), an unknown hash shows right away;
    // otherwise dismissSplash() calls checkHash() once it's done
    if (!document.getElementById('splash-overlay')) this.checkHash();
  }

  get isOpen() {
    return this._isOpen;
  }

  get matchesHash() {
    const hash = location.hash;
    if (CLASSROOM_HASH_RE.test(hash)) return classroomDetail.isUnknownHash(hash);
    return !KNOWN_HASH_RE.test(hash);
  }

  checkHash() {
    if (this.matchesHash && !this._isOpen) this.show();
  }

  // Opened inside the splash's own view transition (script.js dismissSplash),
  // so the app under it never shows: revealed at once, not after that
  // transition like show()
  openInSplash() {
    if (this._isOpen || !this._overlay) return;
    this._isOpen = true;
    this._reveal();
  }

  show() {
    if (this._isOpen || !this._overlay) return;
    this._isOpen = true;
    // A page that was open is closing in its own view transition (it ran
    // first, on the same hashchange) and would undo what's set here
    const vt = document.activeViewTransition;
    if (vt) vt.finished.catch(() => {}).finally(() => this._isOpen && this._reveal());
    else this._reveal();
  }

  _reveal() {
    // A classroom page that was open goes (as Settings does when it opens over one)
    if (document.body.classList.contains('detail-open')) classroomDetail._silentClose();
    this._savedScroll = window.scrollY;
    this._render();
    this._tabbar?.classList.add('detail-open');
    this._backBtn?.removeAttribute('hidden');
    document.body.classList.add('info-open');
    this._overlay.removeAttribute('hidden');
    window.scrollTo(0, 0);
  }

  _render() {
    this._overlay.replaceChildren(createNotFound({
      icon: '<i class="hgi-stroke hgi-unlink-01" aria-hidden="true"></i>',
      title: t('notFound.title'),
      text: t(CLASSROOM_HASH_RE.test(location.hash) ? 'notFound.textClassroom' : 'notFound.textLink'),
      onAction: () => this._goHome(),
    }));
  }

  _onHashChange() {
    if (this.matchesHash) this.show();
    else if (this._isOpen) this._hide(location.hash === '');
  }

  // `toTab`: the hash left for the app itself. For another page's hash that
  // page is opening on the same footing (tab bar swapped, info-open), so only
  // this view goes.
  _hide(toTab) {
    this._isOpen = false;
    this._overlay.setAttribute('hidden', '');
    if (!toTab) return;
    document.body.classList.remove('info-open');
    this._tabbar?.classList.remove('detail-open');
    this._backBtn?.setAttribute('hidden', '');
    window.scrollTo(0, this._savedScroll);
  }

  _goHome() {
    history.replaceState(null, '', location.pathname + location.search);
    this._hide(true);
  }
}

export const notFoundPage = new NotFoundPage();
