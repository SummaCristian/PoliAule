// Settings, as an in-app page like Info and the changelog (#settings).
//
// The header's gear morphs into the page's hero icon and back, and the data
// status button next to it slides over into the gear's place (the gear leaves
// the header while the page is open; settings.css). The page opens
// over whatever is showing and hands it back on close:
//   - a tab: hidden behind it (body.info-open), scroll kept
//   - Info or the changelog: covered (their cover() / uncover()), scroll kept
//   - a classroom page: closed silently; Back goes to its hash, and the
//     classroom page reopens itself (taking this one down in its own view
//     transition, through `classroomdetail:enter`)
//
// The controls themselves are built once by components/settings.js and live
// in the page for good: opening and closing only shows and hides it.
import { t, onLanguageSwitch, animateI18nElement } from '../i18n.js';
import { IS_PROD } from '../utils/env.js';
import { infoPage } from './info-page.js';
import { changelogPage } from './changelog-page.js';
import { classroomDetail } from './classroom-detail.js';

const HASH = '#settings';
const CLASSROOM_HASH_RE = /^#classroom\//;
// A classroom page that never shows up after Back (an unknown id): close normally
const HANDOFF_TIMEOUT = 1000;

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

class SettingsPage {
  constructor() {
    this._overlay = null;
    this._tabbar = null;
    this._backBtn = null;
    this._gearBtn = null;
    this._statusBtn = null;
    this._onShow = null;      // re-measures the controls once they're laid out
    this._isOpen = false;
    this._cameFromApp = false; // reached by navigating (so Back can history.back())
    this._under = null;       // 'tab' | 'info' | 'changelog' | 'detail'
    this._savedScroll = 0;    // the tab under it
    this._handoff = null;     // timer while a classroom page takes over
    this._detailListScroll = 0; // the list under a classroom page it closed
    this._named = [];
  }

  // `content`: the settings sections (components/settings.js); `onShow`: run
  // each time the page is laid out, to place pills and thumbs
  init(content, { onShow } = {}) {
    this._overlay = document.getElementById('settings-overlay');
    this._tabbar = document.querySelector('.bn-wrapper');
    this._backBtn = document.getElementById('detail-back-btn');
    this._gearBtn = document.getElementById('settings-btn');
    this._statusBtn = document.getElementById('data-fetch-btn');
    this._onShow = onShow;
    if (!this._overlay) return;

    this._overlay.innerHTML = `
      <div class="info-page st-page ${IS_PROD ? '' : 'info-page--beta'}">
        <div class="info-backdrop" aria-hidden="true"></div>
        <header class="st-hero">
          <div class="st-hero-icon" aria-hidden="true">
            <i class="hgi-stroke hgi-settings-01"></i>
          </div>
          <h1 class="st-hero-title">${t('settings.title')}</h1>
          <p class="st-hero-subtitle">${t('settings.subtitle')}</p>
        </header>
      </div>`;
    this._overlay.querySelector('.st-page').appendChild(content);

    this._gearBtn?.addEventListener('click', () => this.open());

    // Capture phase, so it runs before the Info, changelog and classroom
    // pages' own handlers on the same button and keeps them out of it (the
    // page it covers may still count itself as open)
    this._backBtn?.addEventListener('click', (e) => {
      if (!this._isOpen) return;
      e.stopImmediatePropagation();
      this._goBack();
    }, { capture: true });

    window.addEventListener('hashchange', () => this._onHashChange());

    // Back to a classroom page: it reopens in its own view transition, and
    // this page leaves as part of that transition's new state, the hero
    // morphing back into the gear in it (named for its old state in _close)
    document.addEventListener('classroomdetail:enter', () => {
      if (this._handoff === null) return;
      clearTimeout(this._handoff);
      this._handoff = null;
      // It reopened from here, so it took this page's scroll for the list's:
      // put back the one it had when this page closed it
      classroomDetail._savedScrollPos = this._detailListScroll;
      this._clearNames();
      this._hide();
      this._nameMorph(this._gearBtn);
      const done = () => this._endMorph();
      const vt = document.activeViewTransition;
      if (vt) vt.finished.catch(() => {}).finally(done);
      else setTimeout(done, 800);
    });

    // Esc steps back, unless a layer above it (the transfer dialog) took it
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !this._isOpen || e.defaultPrevented) return;
      e.preventDefault();
      this._goBack();
    });

    onLanguageSwitch(() => {
      for (const [sel, key] of [['.st-hero-title', 'settings.title'], ['.st-hero-subtitle', 'settings.subtitle']]) {
        const el = this._overlay.querySelector(sel);
        el.textContent = t(key);
        if (this._isOpen) animateI18nElement(el);
      }
    });

    // With no splash (it's gone already), a #settings link opens right away;
    // otherwise dismissSplash() calls checkHash() once it's done
    if (!document.getElementById('splash-overlay')) this.checkHash();
  }

  get isOpen() {
    return this._isOpen;
  }

  get matchesHash() {
    return location.hash === HASH;
  }

  open() {
    if (this._isOpen) return;
    location.hash = HASH;
  }

  toggle() {
    if (this._isOpen) this._goBack();
    else this.open();
  }

  checkHash() {
    if (location.hash === HASH && !this._isOpen) {
      this._cameFromApp = false;
      this._open();
    }
  }

  // A link straight to the settings: opened inside the splash's own view
  // transition (script.js dismissSplash), so the app under it never shows
  openInSplash() {
    this._cameFromApp = false;
    this._isOpen = true;
    this._under = 'tab';
    this._savedScroll = 0;
    this._show();
  }

  _onHashChange() {
    const hash = location.hash;
    if (hash === HASH) {
      if (!this._isOpen) {
        this._cameFromApp = true;
        this._open();
      }
    } else if (this._isOpen) {
      this._close(hash);
    }
  }

  // ── Open / close ───────────────────────────────────────────────────────

  _open() {
    this._isOpen = true;
    this._under = document.body.classList.contains('detail-open') ? 'detail'
      : changelogPage.isOpen ? 'changelog'
      : infoPage.isOpen ? 'info'
      : 'tab';
    if (this._under === 'tab') this._savedScroll = window.scrollY;
    if (this._under === 'detail') this._detailListScroll = classroomDetail._savedScrollPos ?? 0;

    this._nameMorph(this._gearBtn);
    this._transition(() => {
      this._clearNames();
      if (this._under === 'detail') classroomDetail._silentClose();
      else if (this._under === 'changelog') changelogPage.cover();
      else if (this._under === 'info') infoPage.cover();
      this._show();
      this._nameMorph(this._heroIcon());
    });
  }

  _show() {
    // Over Info, the changelog or a classroom page, the tab bar is already
    // swapped for the back button
    this._tabbar?.classList.add('detail-open');
    this._backBtn?.removeAttribute('hidden');
    document.body.classList.add('info-open', 'settings-open');
    this._overlay.removeAttribute('hidden');
    window.scrollTo(0, 0);
    this._onShow?.();
  }

  // `hash`: where the history went
  _close(hash) {
    this._isOpen = false;
    const under = this._under;
    const back = (under === 'info' && hash === '#info')
      || (under === 'changelog' && changelogPage.matchesHash);

    if (!back) {
      // What it covered is gone from the history too
      if (under === 'changelog') changelogPage.dismissCovered();
      else if (under === 'info') infoPage.dismissCovered();
    }

    // A classroom page reopens itself and takes this one down with it
    if (CLASSROOM_HASH_RE.test(hash)) {
      clearTimeout(this._handoff);
      this._nameMorph(this._heroIcon());
      document.documentElement.classList.add('st-vt');
      this._handoff = setTimeout(() => {
        this._handoff = null;
        this._transition(() => {
          this._clearNames();
          this._hide({ toTab: true });
          this._nameMorph(this._gearBtn);
        });
      }, HANDOFF_TIMEOUT);
      return;
    }

    this._nameMorph(this._heroIcon());
    this._transition(() => {
      this._clearNames();
      if (back) {
        this._hide();
        if (under === 'changelog') changelogPage.uncover();
        else infoPage.uncover();
      } else {
        this._hide({ toTab: true });
      }
      this._nameMorph(this._gearBtn);
    });
  }

  _hide({ toTab = false } = {}) {
    this._overlay.setAttribute('hidden', '');
    document.body.classList.remove('settings-open');
    if (!toTab) return;
    document.body.classList.remove('info-open');
    this._tabbar?.classList.remove('detail-open');
    this._backBtn?.setAttribute('hidden', '');
    window.scrollTo(0, this._under === 'tab' ? this._savedScroll : 0);
  }

  _goBack() {
    if (this._cameFromApp) {
      history.back();
      return;
    }
    // Opened straight from a link: there's nothing of ours to go back to
    history.replaceState(null, '', location.pathname + location.search);
    this._close('');
  }

  // ── Gear <-> hero morph ────────────────────────────────────────────────

  _heroIcon() {
    return this._overlay.querySelector('.st-hero-icon');
  }

  // One side of the morph: the gear or the hero icon (`gear`), and the status
  // button wherever it is in this state
  _nameMorph(gear) {
    this._name(gear, 'st-gear');
    this._name(this._statusBtn, 'st-status');
  }

  // Only what's on screen: the page may close scrolled past its hero, and the
  // gear is out of the layout while the page is open
  _name(el, name) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.height === 0 || r.bottom < 0 || r.top > innerHeight) return;
    el.style.viewTransitionName = name;
    this._named.push(el);
  }

  _clearNames() {
    for (const el of this._named) el.style.viewTransitionName = '';
    this._named = [];
  }

  _endMorph() {
    this._clearNames();
    document.documentElement.classList.remove('st-vt');
  }

  // The root cross-fade (classroom-detail.css sets its timing) plus the gear
  // morph, or a plain swap without View Transitions
  _transition(update) {
    if (!document.startViewTransition || reduceMotion.matches) {
      this._clearNames();
      update();
      this._endMorph();
      return;
    }
    document.documentElement.classList.add('st-vt');
    const vt = document.startViewTransition(update);
    vt.ready.catch(() => {});
    vt.finished.catch(() => {}).finally(() => this._endMorph());
  }
}

export const settingsPage = new SettingsPage();
