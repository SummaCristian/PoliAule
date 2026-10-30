// "Not found" as an in-app page: any hash the app doesn't own (#nope) shows
// the shared not-found view (components/not-found.js) over the tabs, on the
// same footing as Info and Settings (the tab bar is swapped for the back
// button). Plain swaps, no morph: it's an edge case, not a destination.
//
// A #changelog/ version that doesn't exist stays with the changelog page.
import { t, onLanguageSwitch } from '../i18n.js';
import { createNotFound } from './not-found.js';
import { createClassroomNotFound } from './not-found-classroom.js';
import { classroomDetail } from './classroom-detail.js';
import { openSearchOverlay } from './search-overlay.js';
import { decorateLive } from '../utils/season.js';

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
    const onHome = () => this._goHome();
    const onSearch = () => { this._goHome(); openSearchOverlay(); };
    const page = CLASSROOM_HASH_RE.test(location.hash)
      ? createClassroomNotFound({
        ...this._classroomHashParts(),
        classrooms: classroomDetail._staticData ?? [],
        onHome,
        onSearch,
      })
      : createNotFound({
        text: t('notFound.textLink'),
        onAction: onHome,
        onSearch,
      });
    this._overlay.replaceChildren(page);
    // Live: opened from a link, it draws before the season's module has loaded
    decorateLive('notFound', page);
  }

  // What the #classroom/ hash asked for: `campus` is the campus object its
  // slug names (null for an unknown slug or an old numeric #classroom/<id>),
  // `name` the room name as typed (null if there's none or it won't decode)
  _classroomHashParts() {
    const match = location.hash.match(/^#classroom\/([^/]+)\/(.+)$/);
    if (!match) return { campus: null, name: null };
    let name = null;
    try { name = decodeURIComponent(match[2]); } catch { /* malformed: no name */ }
    const slug = match[1].toLowerCase();
    const campus = (classroomDetail._staticData ?? []).find(c => c.slug === slug) ?? null;
    return { campus, name };
  }

  _onHashChange() {
    if (!this.matchesHash) {
      if (this._isOpen) this._hide(location.hash === '');
      return;
    }
    // Already open on another broken link: show() would do nothing, so draw
    // this one (it may not even be the same kind, classroom vs generic)
    if (this._isOpen) {
      this._render();
      window.scrollTo(0, 0);
    } else {
      this.show();
    }
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
