import { classroomsData as occupancyData, SKIP_DAYS, getClassroomStatusNow, getBuildingOpening } from '../available-rooms-script.js';
import { t, getLocale, onLanguageSwitch } from '../i18n.js';
import { escapeHtml, decodeEntities } from '../utils/html.js';
import { flipLayout } from '../utils/layout-flip.js';
import { infoPage } from './info-page.js';
import { fetchPhotoUrl, fetchThumbUrl, thumbUrl, photoUrlCache, thumbUrlCache, extractPhotoColor, blurredBackdrop, markPhotoBroken, isPhotoBroken, getCachedPhotoColor, getCachedPhotoLuminance, getCachedPhotoAverageLuminance, getPhotoSmall } from '../utils/photo.js';
import { planHeaderText } from '../utils/text-contrast.js';
import { isFavourite, toggleFavourite, syncStarButton } from '../utils/favourites.js';
import { createPopover, createButton, createSegmentedControl } from 'vitrium';
import { setZoomOrigin, clearZoomOrigin, cardRadius } from '../utils/vt-motion.js';
import { startTrackedTransition, vtFlag } from '../utils/vt-debug.js';

// startViewTransition's shape without the transition: runs the update now.
function startInstantTransition(_label, update) {
  update();
  const done = Promise.resolve();
  return { ready: done, finished: done, updateCallbackDone: done, skipTransition() {} };
}
import { createPillSelector } from './pill-selector.js';
import { DAY_START, DAY_END, dayBarHtml, timeToMinutes, minutesToTimeDisplay } from './day-bar.js';
import { embedMap, parkMap, releaseMap, isMapTabShowing, getEmbedPov, setEmbedPov } from './campus-map.js';
import { refreshHeaderBlur } from '../utils/header-blur.js';
import { decorate } from '../utils/season.js';
import { graduationOn, milanDay } from '../utils/graduation.js';

// No zoom and no shared element when motion is unwelcome: the pair of them is
// the whole animation, so what is left is the browser's own cross-fade.
const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');

// Reading document.fonts.ready brings the page's style up to date on the spot
// (the browser has to know whether any font is still loading). Read in the
// open's update callback, that was a whole extra style pass in the middle of
// it, so it is read once here; faces that arrive later refit the title through
// 'loadingdone' (see init), which forces nothing.
const fontsReady = document.fonts?.ready ?? Promise.resolve();

// ---------- CONSTANTS ----------

const FEATURE_ICONS = {
  4: { icon: 'hgi-projector-01', key: 'features.videoProjector' },
  5: { icon: 'hgi-mic-01', key: 'features.radioMic' },
  6: { icon: 'hgi-blinds', key: 'features.dimmable' },
  7: { icon: 'hgi-cable', key: 'features.wiredDesk' },
  142: { icon: 'hgi-plug-socket', key: 'features.powerOutlets' },
  223: { icon: 'hgi-computer-video-call', key: 'features.videoconf' },
};


// Builds the popover body for a single occupancy slot. Course/exam slots carry
// structured fields (course, code, professors, section); anything the scrape
// couldn't parse only has `raw`; very old cached data may only have `name`.
function buildOccupationPopoverHtml(slot) {
  const timeRange = `${minutesToTimeDisplay(timeToMinutes(slot.inizio))} – ${minutesToTimeDisplay(timeToMinutes(slot.fine))}`;

  let titleText;
  const metaLines = [];

  if (slot.category === 'COURSE' || slot.category === 'EXAM') {
    titleText = decodeEntities(slot.course ?? slot.name ?? t('detail.occupied'));
    if (slot.category === 'EXAM') {
      metaLines.push(`<span class="timeline-popover-badge">${t('detail.examLabel')}</span>`);
    }
    if (slot.code != null) metaLines.push(`<span>${escapeHtml(String(slot.code))}</span>`);
    if (slot.section) metaLines.push(`<span>${escapeHtml(decodeEntities(slot.section))}</span>`);
    if (Array.isArray(slot.professors) && slot.professors.length) {
      metaLines.push(`<span>${escapeHtml(decodeEntities(slot.professors.join(', ')))}</span>`);
    }
  } else {
    titleText = decodeEntities(slot.raw ?? slot.name ?? t('detail.occupied'));
  }

  return `
    <div class="timeline-popover-time">${timeRange}</div>
    <div class="timeline-popover-title">${escapeHtml(titleText)}</div>
    ${metaLines.length ? `<div class="timeline-popover-meta">${metaLines.join('')}</div>` : ''}
  `;
}

const HASH_PATTERN    = /^#classroom\/([^\/]+)\/(.+)$/;
const HASH_PATTERN_V1 = /^#classroom\/(\d+)$/;

// ---------- CLASS ----------

class ClassroomDetail {
  constructor() {
    this._overlay = null;
    this._tabbar = null;
    this._backBtn = null;
    this._favBtn = null;
    this._staticData = null;       // classrooms.json hierarchy
    this._flatIndex = null;       // Map<id, { classroom, building, campus }>
    this._slugIndex = null;       // Map<"campus-slug\x00name", { classroom, building, campus }>
    this._pendingTrigger = null;   // { cardEl } stored by click handler before hashchange fires
    this._openTrigger = null;   // same, kept for reverse morph on close
    this._openedViaPushState = false;
    this._currentId = null;
    this._enteredId = null;
    this._savedScrollPos = 0;
    this._queryContext = null;  // { date, from, to } when opened from Available Tab, else null
    this._highlight = null;     // { date, from, to } when opened from a search result, else null
    this._highlightConsumed = false; // true once the highlight's scroll/popover has fired for this open
    this._nowTimer = null;
    this._timelinePopoverCleanup = null; // removes the previous _loadSchedule's document-level listener
    this._vtSettled = null;     // pending open/close transition, see _beginTransition
    this._vtResolve = null;
    this._mapObserver = null;   // waits for the map section to come into view
    this._mapTimer = 0;         // ...and then for the page to settle
  }

  // Called from script.js after all data is loaded.
  init(staticData) {
    this._staticData = staticData;
    this._overlay = document.getElementById('classroom-detail-overlay');
    this._tabbar = document.querySelector('.bn-wrapper');
    this._backBtn = document.getElementById('detail-back-btn');
    this._favBtn = document.getElementById('favourite-btn');

    // The dark-mode dimming and the title tone both depend on the theme, so
    // redo them for the open photo when the device theme flips at runtime.
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      const el = this._overlay.querySelector('.detail-photo-backdrop');
      const url = this._currentId !== null ? thumbUrl(this._currentId) : null;
      if (!el || !url) return;
      this._applyPhotoDim(url, el);
      this._applyTitleTone(url, el);
      this._applyTextContrast();
    });

    // Flags the overlay once the sticky title row reaches its stuck position
    // (see the title-stuck rules in classroom-detail.css), and measures how far
    // the title must slide to clear the back button: from where the row's
    // content starts to 0.5rem past the button's right edge, whatever the
    // width / scrollbar / centred column. Listens in the capture phase so it
    // works whichever element is the scroller.
    let stuckRaf = 0;
    const syncTitleStuck = () => {
      stuckRaf = 0;
      const row = this._overlay.querySelector('.detail-title-row');
      let stuck = false;
      if (row && !this._overlay.hidden && getComputedStyle(row).position === 'sticky') {
        const cs = getComputedStyle(row);
        const top = parseFloat(cs.top);
        const rect = row.getBoundingClientRect();
        const scrolled = window.scrollY > 0 || this._overlay.scrollTop > 0 || document.body.scrollTop > 0;
        stuck = scrolled && rect.top <= top + 0.5;
        // The stuck row keeps this height (see .title-stuck .detail-title-row).
        if (!this._overlay.classList.contains('title-stuck')) {
          this._overlay.style.setProperty('--title-row-h', `${rect.height}px`);
        }
        const back = document.getElementById('detail-back-btn');
        if (back && !back.hidden) {
          const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
          const shift = back.getBoundingClientRect().right + 0.5 * rem - (rect.left + parseFloat(cs.paddingLeft));
          this._overlay.style.setProperty('--title-shift', `${Math.round(shift)}px`);
        }
      }
      if (stuck !== this._overlay.classList.contains('title-stuck')) {
        this._overlay.classList.toggle('title-stuck', stuck);
        this._fitTitle(); // the stuck title has its own size and width
      }
    };
    const queueTitleStuck = () => {
      if (stuckRaf) return;
      // Opening scrolls to the top, which lands here on the zoom's first
      // frames — forced layouts of a page that is still under the snapshot.
      // Measure it once it has landed instead.
      if (this._vtSettled) {
        stuckRaf = -1;
        this._afterTransition(() => { stuckRaf = requestAnimationFrame(syncTitleStuck); });
        return;
      }
      stuckRaf = requestAnimationFrame(syncTitleStuck);
    };
    document.addEventListener('scroll', queueTitleStuck, { passive: true, capture: true });
    window.addEventListener('resize', queueTitleStuck);
    // A face that arrives after the page opened changes the title's width
    document.fonts?.addEventListener('loadingdone', () => this._fitTitle());

    this._favBtn?.addEventListener('click', () => {
      if (this._currentId === null) return;
      toggleFavourite(this._currentId);
      this._syncFavBtn();
    });
    window.addEventListener('favourites-changed', () => this._syncFavBtn());

    this._backBtn?.addEventListener('click', () => {
      if (this._openedViaPushState) {
        this._ownBack = true;
        history.back();
      } else {
        history.replaceState(null, '', window.location.pathname + window.location.search);
        this._doClose();
      }
    });

    window.addEventListener('hashchange', () => this._onHashChange());

    // Changed with the page open (settings over it): Sunday's row shrinks
    // away or rises in, and what's under it slides to make room
    window.addEventListener('hidesundayschange', (e) => {
      const container = document.getElementById('detail-schedule-container');
      if (!container) return;
      const apply = () => container.classList.toggle('detail-schedule--hide-sundays', e.detail.hidden);
      const content = container.closest('.detail-content');
      if (!content) { apply(); return; }
      flipLayout(content,
        '.detail-schedule-row, .detail-schedule-label-cell, .detail-schedule-day, .detail-section:has(#detail-schedule-container) ~ .detail-section',
        apply,
        { isLeaving: (el) => e.detail.hidden && /--sunday\b/.test(el.className) });
    });

    onLanguageSwitch(() => {
      if (this._currentId === null) return;
      const entry = this._flatIndex?.get(this._currentId);
      if (!entry) return;
      const scrollY = window.scrollY;
      this._renderContent(entry);
      this._loadSchedule(this._currentId);
      if (this._hasPhoto(entry.classroom)) this._loadPhoto(this._currentId);
      window.scrollTo(0, scrollY);
    });

    window.addEventListener('timeformatchange', () => {
      if (this._currentId === null) return;
      const scrollY = window.scrollY;
      this._loadSchedule(this._currentId);
      window.scrollTo(0, scrollY);
    });

    // Press feedback — the card scales down while the pointer is held (mouse or
    // touch), then springs into the open transition on release. The pressed
    // class is deliberately NOT cleared on pointerup: the click handler below
    // fires synchronously right after, starts the View Transition, and the VT
    // captures the card's "old" snapshot while it's still scaled down, so the
    // zoom animation is a continuous motion out of the pressed state rather than
    // a jump back to full size first. A deferred cleanup (rAF) removes it after
    // the click has had its turn; pointercancel/leave (drag-away, scroll) drop
    // it immediately since no click will follow.
    const clearPressed = () => {
      document.querySelectorAll('.classroom-card--pressed')
        .forEach((c) => c.classList.remove('classroom-card--pressed'));
    };
    document.addEventListener('pointerdown', (e) => {
      const trigger = e.target.closest('[data-open-classroom]');
      if (!trigger) return;
      const card = trigger.closest('.classroom-card') ?? trigger;
      card.classList.add('classroom-card--pressed');
    });
    document.addEventListener('pointerup', () => requestAnimationFrame(clearPressed));
    document.addEventListener('pointercancel', clearPressed);

    // A card's photo color and pre-blurred backdrop, made while the finger is
    // still down: the first open of a room otherwise loads its thumbnail again
    // and reads its pixels (~10ms on an older phone) before the transition can
    // start, and renders the backdrop inside it. Cached per photo, so a press
    // that turns into a scroll costs them only once.
    document.addEventListener('pointerdown', (e) => {
      const trigger = e.target.closest?.('[data-open-classroom]');
      if (!trigger) return;
      const id = parseInt(trigger.dataset.openClassroom);
      if (!thumbUrlCache.has(id)) return;
      const url = thumbUrl(id);
      extractPhotoColor(url).then(() => {
        if (this._backdropBox && !vtFlag('liveblur')) blurredBackdrop(url, this._backdropBox);
      });
    }, { passive: true });

    // Click delegation — handles classroom cards on both the available and campus tabs
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-open-classroom]');
      if (!trigger) return;
      e.stopPropagation();

      const id = parseInt(trigger.dataset.openClassroom);

      // The whole card morphs into the whole page (VT shared element).
      const card = trigger.closest('.classroom-card') ?? trigger;

      const queryDate = card.dataset.queryDate ?? null;
      const queryFrom = card.dataset.queryFrom ?? null;
      const queryTo   = card.dataset.queryTo   ?? null;
      const queryContext = queryDate && queryFrom && queryTo
        ? { date: queryDate, from: queryFrom, to: queryTo }
        : null;

      const highlightDate = card.dataset.highlightDate ?? null;
      const highlightFrom = card.dataset.highlightFrom ?? null;
      const highlightTo = card.dataset.highlightTo ?? null;
      const highlight = highlightDate && highlightFrom && highlightTo
        ? { date: highlightDate, from: highlightFrom, to: highlightTo }
        : null;

      this._pendingTrigger = { queryContext, highlight, cardEl: card };
      this._openedViaPushState = true;
      this._buildFlatIndex();
      const _entry = this._flatIndex?.get(id);
      location.hash = _entry
        ? '#classroom/' + _entry.campus.slug + '/' + encodeURIComponent(_entry.classroom.name)
        : '#classroom/' + id;
    });

    // Handle hash that's already in the URL on page load (hashchange doesn't fire on load)
    if (HASH_PATTERN.test(location.hash) || HASH_PATTERN_V1.test(location.hash)) {
      this._buildFlatIndex();
      const id = this._resolveHashToId(location.hash);
      if (id !== null) {
        this._openedViaPushState = false;
        this._doOpen(id, null);
      }
    }
  }

  // Reflects the current classroom's favourite state on the header star button.
  _syncFavBtn() {
    if (!this._favBtn || this._currentId === null) return;
    syncStarButton(this._favBtn, isFavourite(this._currentId));
  }

  // Called by script.js once occupancy data has finished loading in the
  // background, so a detail page opened before that (e.g. via a direct link)
  // fills in its status badge and timeline instead of staying stuck on
  // "no data".
  refreshOccupancy() {
    if (this._currentId === null) return;
    const entry = this._flatIndex?.get(this._currentId);
    if (!entry) return;
    const scrollY = window.scrollY;
    this._renderContent(entry);
    this._loadSchedule(this._currentId);
    if (this._hasPhoto(entry.classroom)) this._loadPhoto(this._currentId);
    window.scrollTo(0, scrollY);
  }

  // ---------- HASH ROUTING ----------

  _onHashChange() {
    const isClassroomHash = HASH_PATTERN.test(location.hash) || HASH_PATTERN_V1.test(location.hash);
    if (isClassroomHash) {
      this._buildFlatIndex();
      const id = this._resolveHashToId(location.hash);
      if (id !== null) {
        const pending = this._pendingTrigger;
        this._pendingTrigger = null;
        this._doOpen(id, pending);
      } else {
        this._pendingTrigger = null;
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    } else if (this._currentId !== null) {
      if (location.hash === '#info') {
        this._silentClose();
      } else {
        // Closed by the browser (Android Back key / gesture), not by our own
        // back button: Chrome for Android crashes the renderer (compositor
        // SIGTRAP) when a view transition with a root snapshot runs on those,
        // so the page closes without one.
        const instant = !this._ownBack;
        this._ownBack = false;
        this._doClose(instant);
      }
    }
  }

  _silentClose() {
    if (!this._overlay || this._overlay.hidden) return;
    this._currentId = null;
    this._enteredId = null;
    releaseMap();
    this._cancelMapEmbed();
    clearInterval(this._nowTimer);
    document.body.classList.remove('detail-open');
    // Leave tabbar.detail-open and backBtn visibility intact — info page takes over both
    this._overlay.setAttribute('hidden', '');
    this._overlay.classList.remove('visible');
    this._overlay.innerHTML = '';
    this._openTrigger = null;
    this._queryContext = null;
    this._highlight = null;
  }

  // ---------- TRANSITION PLUMBING ----------

  /* The page's end of the card morph: the hero photo. Null for a room with no
     photo, and deliberately so — there is nothing on that page for the card to
     become, and every stand-in is worse than none. The card's snapshot is
     `object-fit: cover`-ed into whatever box the morph lands on, so a stand-in
     the size of its box blows the card up by that box's scale: an empty,
     viewport-sized one (what this used to return) scaled a 152x193 card to
     390x844 and cross-faded a 4.4x blow-up of its own text across the screen.

     With no page-side element the card is alone in its group, the group stays
     at the card's own rect, and the `:only-child` rules in
     classroom-detail.css fade it out in place over the page growing out from
     under it. That is also what SwiftUI's `.zoom` does with nothing to pair up:
     the source view simply becomes the destination page. */
  _heroTarget() {
    return this._overlay?.querySelector('.detail-photo-container') ?? null;
  }

  /** Whether the page shows a photo: an idfoto whose image hasn't failed to load. */
  _hasPhoto(classroom) {
    return !!classroom.idfoto && !isPhotoBroken(classroom.id);
  }

  /* Anything that blocks the main thread while the snapshots are animating is
     a stutter in the animation, so work that can wait (the map's WebGL boot,
     mainly) waits on this. */
  _beginTransition() {
    if (this._vtSettled) return;
    this._vtSettled = new Promise((resolve) => { this._vtResolve = resolve; });
  }

  _settleTransition() {
    refreshHeaderBlur();
    const resolve = this._vtResolve;
    this._vtSettled = null;
    this._vtResolve = null;
    resolve?.();
  }

  _afterTransition(fn) {
    if (this._vtSettled) this._vtSettled.then(fn);
    else fn();
  }

  /* The snapshot of the page a transition animates is live, so anything that
     moves on the page underneath it — the entrance animations, a transition,
     a glass surface's backdrop-filter — repaints that whole page layer, blurred
     backdrop and all, on every frame of the zoom. .detail-vt-freeze (see
     classroom-detail.css) holds all of it still for the length of the
     transition; ?vtdebug=live turns that off, for comparison.

     It goes on the parts it holds still, not on <html>, and the container
     around the whole page gets a class of its own: Chrome restyles everything
     inside an element that gains a class with a rule ending in `*`, whichever
     element that rule was written for. On <html>, or on that container, it
     restyled all of the page (~20-30ms on an older phone), in the very frame
     the transition captures the old state in. */
  _freezeTargets() {
    return [
      [this._overlay, 'detail-vt-freeze'],
      [document.querySelector('.header'), 'detail-vt-freeze'],
      [document.querySelector('.body-container'), 'detail-vt-snap'],
    ].filter(([el]) => el);
  }

  _freezeForTransition({ page = true } = {}) {
    if (vtFlag('live')) return;
    for (const [el, cls] of this._freezeTargets()) {
      if (el === this._overlay && !page) continue;
      el.classList.add(cls);
    }
  }

  _unfreeze() {
    for (const [el, cls] of this._freezeTargets()) el.classList.remove(cls);
  }

  /* --header-height is normally kept live by a ResizeObserver (script.js),
     but that fires too late for a transition, which captures its new state
     synchronously right after its update callback: the photo's margin-top
     (which reads it) used the other mode's header height for the whole
     animation, and the "tucked behind the header" look only snapped in once
     it ended. So the callbacks set it themselves, in two steps: first what the
     header measured the last time the page was in this mode, before anything
     reads layout, then checked once layout is up to date. It's on <html>, so
     every change to it restyles the whole page; measuring first and writing
     after cost a second full pass. */
  _presetHeaderHeight(mode) {
    const h = this._headerHeights?.[mode];
    if (h) document.documentElement.style.setProperty('--header-height', h);
  }

  _checkHeaderHeight(mode, headerEl) {
    if (!headerEl) return;
    const h = `${headerEl.offsetHeight}px`;
    (this._headerHeights ??= {})[mode] = h;
    if (document.documentElement.style.getPropertyValue('--header-height') !== h) {
      document.documentElement.style.setProperty('--header-height', h);
    }
  }

  /* Holds the page at `y` on every frame until the returned function is
     called. Mobile Safari runs a flick's glide outside the page and reports
     where it stopped a moment later; tap a card as the glide ends and that
     report can land after the open's own scrollTo(0, 0), putting the page
     back at the list's offset (clamped: the page's bottom). The transition's
     live snapshot then showed the page's bottom for the whole zoom, and the
     jump to the top came when cleanup reset it. Held, a late report is undone
     on the next frame, while the box is still small. */
  _pinScroll(y) {
    let raf = 0;
    const hold = () => {
      if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
      raf = requestAnimationFrame(hold);
    };
    raf = requestAnimationFrame(hold);
    return () => cancelAnimationFrame(raf);
  }

  /* The entrance animations (feature chips, schedule blocks, the Today badge)
     were created paused under the freeze, and their delays count from the tap.
     Spend as much of them as the zoom already took — all by the same amount,
     so a stagger stays a stagger — and let them go: the first of them starts
     the moment the zoom lands instead of a delay after it. */
  _releaseFreeze(since) {
    if (!this._overlay?.classList.contains('detail-vt-freeze')) return;
    const anims = (this._overlay.getAnimations?.({ subtree: true }) ?? [])
      .filter(a => a.playState === 'paused' && typeof a.currentTime === 'number');
    const delays = anims.map(a => a.effect?.getTiming?.().delay ?? 0).filter(d => d > 0);
    const skip = delays.length ? Math.min(performance.now() - since, ...delays) : 0;
    if (skip > 0) for (const a of anims) a.currentTime += skip;
    this._unfreeze();
  }

  /* The header's progressive blur samples whatever is painted behind it, and
     on this page that is the hero photo. refreshHeaderBlur() runs when the
     transition settles and again 320ms later — which covers a photo that was
     already cached and stamped inside the transition, and misses one that was
     not: a cold room has to resolve /v1/photos/:id, fetch the bytes and decode
     them first, so its photo lands well after both nudges. Safari then keeps
     the blur it sampled over the empty skeleton until something else forces a
     repaint, which is why it came back on the first scroll. Whether a given
     room was cached is stable within a session — the list only warms the cache
     for cards it has scrolled near — so it showed up as "always these two
     classrooms" rather than as flakiness.

     So: refresh again when the photo is actually up. refreshHeaderBlur() does
     its own sweep from there, which covers the photo's 0.6s reveal and the
     page tint's transition behind it. */
  /* The open's zoom only needs the page's shell: the photo, the title and the
     lines under it are all it shows for most of its length. The sections below
     are built with the shell but kept out of layout (.detail-content--deferred)
     and come in here, once the zoom has landed, with the schedule: laying them
     out inside the transition's update callback, and the schedule's day picker
     measuring itself there, were most of what that callback still cost. */
  _revealContent(id) {
    const content = this._overlay.querySelector('.detail-content--deferred');
    if (!content) return;
    content.querySelectorAll(':scope > .detail-column > .detail-section')
      .forEach((section, i) => section.style.setProperty('--section-i', i));
    content.classList.replace('detail-content--deferred', 'detail-content--enter');
    this._loadSchedule(id);
  }

  _photoRevealed() {
    refreshHeaderBlur();
  }

  _cancelMapEmbed() {
    this._mapObserver?.disconnect();
    this._mapObserver = null;
    clearTimeout(this._mapTimer);
    this._mapTimer = 0;
  }

  /* Booting the map is the most expensive thing on this page by a distance:
     fetching the token, parsing mapbox-gl, building a WebGL context and its
     first tiles, all on the main thread. Doing that inside the view
     transition's update callback is what made the very first open of any
     detail page stutter.

     So it waits for three things: the map section coming close to the viewport
     (on a long page — features, schedule, opening hours — a reader who doesn't
     scroll down there never pays for it at all), the transition being over,
     and then a beat longer.

     That last wait is not politeness. A room with no photo has a short page,
     short enough that the map section is already in range when it opens, so
     "after the transition" meant a ~1.3s Mapbox boot starting the instant the
     zoom landed — on top of the page's own entrance animations (the feature
     chips, the section blocks), which are still running for another half
     second. That is what made photo-less rooms feel janky while rooms with a
     photo, whose maps are far below the fold, felt fine. */
  _scheduleMapEmbed(host, opts) {
    this._cancelMapEmbed();
    const start = () => {
      this._mapObserver?.disconnect();
      this._mapObserver = null;
      this._afterTransition(() => {
        const run = () => {
          if (!host.isConnected) return;
          embedMap(host, opts);
        };
        const idle = () => {
          if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 500 });
          else run();
        };
        // Long enough for the page's own entrance animations to be over.
        this._mapTimer = setTimeout(idle, 600);
      });
    };
    if (typeof IntersectionObserver !== 'function') { start(); return; }
    this._mapObserver = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) start();
    }, { rootMargin: '600px 0px' });
    this._mapObserver.observe(host);
  }

  // ---------- OPEN ----------

  async _doOpen(id, pending) {
    if (!this._overlay) return;
    this._buildFlatIndex();

    const entry = this._flatIndex?.get(id);
    if (!entry) return;

    // A different room's page tint is cleared once the page is being rendered
    // (clearTint below), not here: --detail-tint is on <html>, so changing it
    // restyles the whole page, and the scrollY read just below would pay for
    // that right away, before the transition has even started.
    const newRoom = this._currentId !== id;
    const clearTint = () => {
      if (newRoom) document.documentElement.style.removeProperty('--detail-tint');
    };
    this._currentId = id;
    this._openTrigger = pending ?? null;
    this._queryContext = pending?.queryContext ?? null;
    this._highlight = pending?.highlight ?? null;
    this._highlightConsumed = false;

    // Save scroll position for when we return
    this._savedScrollPos = window.scrollY;

    // When returning from info page, the back button is already visible and info's own
    // hero elements should morph into the header instead of touching the tabbar.
    const fromInfo = !!(this._backBtn && !this._backBtn.hidden);

    // Photo VT: if the room's photo is already cached, pre-decode it so the
    // detail photo is bitmap-ready when the VT snapshots the new state. The
    // thumbnail the card was showing, by preference: already decoded, and a
    // fraction of the full photo to upload and draw on every frame of the zoom.
    // _loadPhoto swaps the full photo in once the page has landed.
    let hasPhoto = this._hasPhoto(entry.classroom);
    let validPhotoUrl = hasPhoto ? (thumbUrlCache.get(id) ?? photoUrlCache.get(id) ?? null) : null;
    if (validPhotoUrl) {
      // The card being tapped usually shows this very thumbnail, already
      // decoded (it's marked loaded once its own decode() resolves): waiting
      // on another decode() of it still cost a frame (~15ms on an older phone)
      // before the transition could start.
      const shown = pending?.cardEl?.querySelector('.classroom-card-photo.loaded');
      let decoded = !!shown && shown.src === validPhotoUrl && shown.naturalWidth > 0;
      if (!decoded) {
        const tmp = new Image();
        tmp.src = validPhotoUrl;
        decoded = await tmp.decode().then(() => true).catch(() => false);
      }
      if (this._currentId !== id) return; // navigated away during decode
      // Decode failed (a 404 from a stale idfoto, mostly): the room opens as a
      // photo-less one. Opened as a room with a photo, it paired the card with
      // an empty photo box, and the photo's error handler then removed that box
      // mid-zoom: removing a named element ends the transition on the spot (the
      // snap), and everything below it jumped up by the photo's height.
      if (!decoded) {
        markPhotoBroken(id);
        hasPhoto = false;
        validPhotoUrl = null;
      }
      // Warm the tint cache too, so _setBackdrop can apply --detail-tint
      // synchronously inside the VT callback (the "new" snapshot is taken
      // right after it, before any async extraction could land).
      if (validPhotoUrl) await extractPhotoColor(thumbUrl(id));
      if (this._currentId !== id) return;
    }

    if (document.startViewTransition) {
      // -- SwiftUI .zoom-style open: the whole page grows out of the card's
      // rounded box (a transform + clip on the root snapshot, see
      // utils/vt-motion.js), while the card and the page's hero photo morph
      // into each other as one shared element on top of it. --
      const cardEl = pending?.cardEl ?? null;
      const cardInDom = !!(cardEl && document.body.contains(cardEl));
      // No card to zoom from (hash navigation, info -> detail): leave the root
      // cross-fade alone instead of inventing an origin for the page to fly
      // out of.
      const zooming = cardInDom && !reduceMotion?.matches
        && setZoomOrigin(cardEl.getBoundingClientRect(), cardRadius(cardEl));
      // The header is a constant translucent/blurred overlay, not content that
      // changes — it doesn't need to cross-fade with the rest of "root". But
      // a VT freezes everything (including backdrop-filter's live sampling)
      // into snapshots, so lumped into root it would show the frozen *old*
      // blur (behind the small card) for the whole animation. Naming it
      // separately, pinned with no animation, freezes its own snapshot at the
      // already-correct *new* blur (behind the full-size photo) from frame one.
      const headerEl = document.querySelector('.header');
      if (headerEl) headerEl.style.viewTransitionName = 'app-header';
      if (fromInfo) infoPage._prepareReturnVT();
      // Only when the page has a hero for it to become. A room with no photo
      // has none, and naming the card anyway put its snapshot on top of the
      // growing page at its own unscaled size — so for the length of the fade
      // you saw the card's title over the page's title, same words at two
      // sizes. Unnamed, the card stays in the list's snapshot, which does not
      // move, and the page's box covers it from frame one: nothing to ghost.
      const pairHero = zooming && hasPhoto && !vtFlag('nohero');
      if (pairHero) cardEl.style.viewTransitionName = 'detail-hero';
      // The page's end of the morph, resolved inside the callback.
      let heroTargetEl = null;
      // When the page's animations were created, for _releaseFreeze.
      let frozenAt = performance.now();
      let unpinScroll = null;

      this._beginTransition();
      // Strip the glass blur off the scaling header controls for the transition
      // (see .header-ctl-vt in classroom-detail.css).
      document.documentElement.classList.add('header-ctl-vt');
      this._freezeForTransition();
      // Direction of the zoom (see .detail-vt-open in classroom-detail.css).
      if (zooming) document.documentElement.classList.add('detail-vt-open');

      const vt = startTrackedTransition('open', () => {
        frozenAt = performance.now();
        // Lets whatever the page is opening from leave as part of this
        // transition's new state (the search overlay hands off this way).
        document.dispatchEvent(new Event('classroomdetail:enter'));
        if (fromInfo) {
          infoPage._applyReturnVT();
        } else if (this._tabbar) {
          this._tabbar.classList.add('detail-open');
        }
        if (zooming) cardEl.style.viewTransitionName = '';

        // The list's header height, for the close to preset (the page has only
        // ever been in list mode before the first open).
        (this._headerHeights ??= {}).list ??= document.documentElement.style.getPropertyValue('--header-height') || undefined;

        // Everything this changes first, then everything it measures: a read of
        // layout after a change restyles and lays out the page again, and
        // .detail-open and the tint restyle all of it. Only the page's shell
        // goes in here; its sections, and the schedule with its self-measuring
        // day picker, come in once the zoom has landed (_revealContent).
        document.body.classList.add('detail-open');
        this._presetHeaderHeight('detail');
        this._overlay.removeAttribute('hidden');
        this._renderContent(entry, { deferContent: true });
        this._overlay.classList.add('visible');
        if (this._backBtn) this._backBtn.removeAttribute('hidden');
        if (this._favBtn) { this._favBtn.removeAttribute('hidden'); this._syncFavBtn(); }
        clearTint();
        if (validPhotoUrl) {
          const detailImg = this._overlay.querySelector('.detail-photo');
          const detailContainer = this._overlay.querySelector('.detail-photo-container');
          if (detailImg) {
            detailImg.src = validPhotoUrl;
            this._setBackdrop(thumbUrl(id));
            detailImg.classList.add('loaded');
            detailContainer?.classList.add('loaded');
          }
        }

        this._checkHeaderHeight('detail', headerEl);
        window.scrollTo(0, 0);
        unpinScroll = this._pinScroll(0);

        // The card's counterpart: the hero photo, which the page's zoom lands
        // exactly on top of. Named after the layout flush below so it is
        // captured at its settled size (siblings hidden via .detail-open
        // above), and only when there is a card to morph out of.
        void this._overlay.offsetHeight;
        if (pairHero) {
          heroTargetEl = this._heroTarget();
          if (heroTargetEl) {
            heroTargetEl.style.viewTransitionName = 'detail-hero';
            document.documentElement.classList.add('detail-vt-hero');
          }
        }

        if (hasPhoto) this._loadPhoto(id);
      }, () => ({ zoom: zooming, hero: !!heroTargetEl }));

      const cleanup = () => {
        unpinScroll?.();
        if (heroTargetEl) heroTargetEl.style.viewTransitionName = '';
        if (cardEl) cardEl.style.viewTransitionName = '';
        if (headerEl) headerEl.style.viewTransitionName = '';
        this._releaseFreeze(frozenAt);
        this._measureBackdrop();
        document.documentElement.classList.remove('header-ctl-vt', 'detail-vt-open', 'detail-vt-hero');
        clearZoomOrigin();
        if (fromInfo) infoPage._cleanupReturnVT();
        // Before the settle: what waits for it (the masonry's observers) takes
        // its first measurements of the sections, which have to be laid out.
        if (this._currentId === id) this._revealContent(id);
        this._settleTransition();
        // Nothing scrolls while the snapshots are up, so a non-zero offset here
        // is one the page kept from before (Safari restoring one as the
        // document's height changes, mostly) rather than the reader's doing.
        if (this._currentId === id && window.scrollY !== 0) window.scrollTo(0, 0);
      };
      // A second VT firing before this one settles rejects .ready/.finished with
      // InvalidStateError; .finished is handled above, but .ready isn't awaited
      // anywhere, so it was surfacing as an unhandled rejection on every abort.
      vt.ready.catch(() => {});
      vt.finished.then(cleanup).catch(cleanup);
    } else {
      // Fallback: show overlay, swap tabbar for back button without animation
      document.dispatchEvent(new Event('classroomdetail:enter'));
      if (fromInfo) {
        infoPage._applyReturnVT();
      } else {
        if (this._tabbar) this._tabbar.classList.add('detail-open');
      }
      document.body.classList.add('detail-open');
      this._overlay.removeAttribute('hidden');
      this._renderContent(entry);
      clearTint();
      // Stamp cached photo immediately in the fallback path too
      if (validPhotoUrl) {
        const detailImg = this._overlay.querySelector('.detail-photo');
        const detailContainer = this._overlay.querySelector('.detail-photo-container');
        if (detailImg) {
          detailImg.src = validPhotoUrl;
          this._setBackdrop(thumbUrl(id));
          detailImg.classList.add('loaded');
          detailContainer?.classList.add('loaded');
        }
      }
      if (this._backBtn) this._backBtn.removeAttribute('hidden');
      if (this._favBtn) { this._favBtn.removeAttribute('hidden'); this._syncFavBtn(); }
      requestAnimationFrame(() => {
        this._overlay.classList.add('visible');
        window.scrollTo(0, 0);
      });

      // Load data immediately after rendering in the fallback branch
      this._loadSchedule(id);
      if (hasPhoto) this._loadPhoto(id);
    }
  }

  // ---------- CLOSE ----------

  _doClose(instant = false) {
    if (!this._overlay || this._overlay.hidden) return;

    this._currentId = null;
    this._enteredId = null;

    const cardEl = this._openTrigger?.cardEl ?? null;
    const cardInDom = !!(cardEl && document.body.contains(cardEl));
    const headerEl = document.querySelector('.header');

    const cleanup = () => {
      releaseMap();
      this._cancelMapEmbed();
      this._overlay.innerHTML = '';
      this._openTrigger = null;
      this._queryContext = null;
      this._highlight = null;
      if (headerEl) headerEl.style.viewTransitionName = '';
      document.documentElement.classList.remove(
        'header-vt-fixed', 'header-ctl-vt', 'detail-vt-close', 'detail-vt-hero');
      this._unfreeze();
      clearZoomOrigin();
      if (cardEl) {
        cardEl.style.viewTransitionName = '';
        cardEl.style.removeProperty('content-visibility');
      }
      this._settleTransition();
      // The list's own position: restored inside the callback, but the document
      // is still growing back to its full height at that point, so the browser
      // may have clamped it short. Now that it has settled, put it where it
      // belongs.
      if (this._currentId === null && Math.abs(window.scrollY - this._savedScrollPos) > 1) {
        window.scrollTo(0, this._savedScrollPos);
      }
    };

    if (document.startViewTransition) {
      // content-visibility: auto skips rendering off-screen cards, which would make
      // the VT new-state snapshot blank. Force it visible here so the card's
      // subtree is rendered when the VT captures it after scrollTo().
      if (cardInDom) cardEl.style.contentVisibility = 'visible';

      // See _doOpen: the header is pinned as its own group so its frozen
      // snapshot always shows the already-correct blur, instead of being
      // lumped into root and frozen mid-way through the wrong state.
      if (headerEl) headerEl.style.viewTransitionName = 'app-header';

      // The hero the page shrinks into the card around. Only worth pulling out
      // of the page when there is a card waiting for it on the other side.
      const heroEl = cardInDom && !reduceMotion?.matches && !vtFlag('nohero') ? this._heroTarget() : null;
      if (heroEl) heroEl.style.viewTransitionName = 'detail-hero';
      let zoomed = false;

      this._beginTransition();
      // Strip the glass blur off the scaling header controls for the transition
      // (see .header-ctl-vt in classroom-detail.css).
      document.documentElement.classList.add('header-ctl-vt');
      // Set before the old state is captured, which is the page here. The page
      // itself only needs it in Safari, which keeps compositing a
      // backdrop-filter live even inside an old snapshot; elsewhere that
      // snapshot is a still image, and freezing the page would only restyle
      // all of it in the frame the snapshot is taken in.
      this._freezeForTransition({ page: !document.documentElement.classList.contains('no-safari') });

      const vt = (instant ? startInstantTransition : startTrackedTransition)('close', () => {
        // -- DOM changes (defines NEW state) --

        // Fully hide the overlay and back button. Changes first, reads after,
        // as in the open: the scrollTo below is the one full layout pass.
        document.body.classList.remove('detail-open');
        this._presetHeaderHeight('list');
        this._overlay.setAttribute('hidden', '');
        this._overlay.classList.remove('visible');
        if (this._backBtn) this._backBtn.setAttribute('hidden', '');
        if (this._favBtn) this._favBtn.setAttribute('hidden', '');
        if (headerEl) {
          // Safari captures a position:sticky element's ::view-transition-group at
          // its unstuck flow position, so this new-state snapshot of the header
          // would land off-screen whenever the list was scrolled. Pin it with
          // position:fixed (viewport-relative, captured correctly) for the
          // duration of this transition; the matching CSS gives .body-container a
          // compensating padding-top so nothing shifts. Cleared in cleanup().
          document.documentElement.classList.add('header-vt-fixed');
        }

        // Restore the tabbar (plain fade, no shared element — it no longer sits in the header)
        if (this._tabbar) this._tabbar.classList.remove('detail-open');

        // Restore scroll position so VT can morph back to the correct spot
        window.scrollTo(0, this._savedScrollPos);
        this._checkHeaderHeight('list', headerEl);

        // Hand the shared map back to the Campus tab now, so this transition's
        // new-state snapshot already shows it (releasing in cleanup() left the
        // tab map-less until the animation ended). The tab's container just
        // regained its size above; flush layout so the map resizes into it.
        // Only when that is the tab we are going back to, though: releasing
        // resizes the WebGL canvas, jumps the camera and pulls in fresh tiles,
        // which then renders on every frame of the close — into a tab nobody
        // can see, whenever the page was opened from any other. cleanup()
        // releases it in that case.
        if (isMapTabShowing()) {
          void document.body.offsetHeight;
          releaseMap();
        }

        // Force a synchronous layout flush before naming the card, so its
        // resolved position/size (list re-scrolled above) is fully settled at
        // the exact moment the VT captures the "new" state geometry — and so
        // the rect the page shrinks into is the one the card really lands on.
        if (cardInDom && !reduceMotion?.matches) {
          void cardEl.offsetHeight;
          if (setZoomOrigin(cardEl.getBoundingClientRect(), cardRadius(cardEl))) {
            zoomed = true;
            document.documentElement.classList.add('detail-vt-close');
            // Named only against a real hero, the same way the open is: with
            // nothing to pair with, the card's snapshot would fade in at its
            // own small size on top of a page that is still full-screen, which
            // is the opening ghost played backwards. Unnamed, the page simply
            // shrinks into the card's rect and uncovers it.
            if (heroEl) {
              document.documentElement.classList.add('detail-vt-hero');
              cardEl.style.viewTransitionName = 'detail-hero';
            }
          }
        }
      }, () => ({ zoom: zoomed, hero: zoomed && !!heroEl }));

      vt.ready.catch(() => {});
      vt.finished.then(cleanup).catch(cleanup);
    } else {
      // Fallback: fade out overlay, swap back button for tabbar without animation
      this._overlay.classList.remove('visible');
      if (this._tabbar) this._tabbar.classList.remove('detail-open');
      if (this._backBtn) this._backBtn.setAttribute('hidden', '');
      if (this._favBtn) this._favBtn.setAttribute('hidden', '');
      const hide = () => {
        document.body.classList.remove('detail-open');
        this._overlay.setAttribute('hidden', '');
        window.scrollTo(0, this._savedScrollPos);
        cleanup();
      };
      this._overlay.addEventListener('transitionend', hide, { once: true });
      setTimeout(hide, 400);
    }
  }

  // ---------- FLAT INDEX ----------

  _buildFlatIndex() {
    if (this._flatIndex) return;
    this._flatIndex = new Map();
    this._slugIndex = new Map();
    for (const campus of (this._staticData ?? [])) {
      for (const building of campus.buildings) {
        for (const classroom of building.classrooms) {
          const entry = { classroom, building, campus };
          this._flatIndex.set(classroom.id, entry);
          this._slugIndex.set(campus.slug + '\x00' + classroom.name.toLowerCase(), entry);
        }
      }
    }
  }

  _resolveHashToId(hash) {
    let match = hash.match(HASH_PATTERN);
    if (match) {
      const slug = match[1];
      let name;
      try { name = decodeURIComponent(match[2]); }
      catch { return null; }
      const entry = this._slugIndex?.get(slug.toLowerCase() + '\x00' + name.toLowerCase());
      return entry ? entry.classroom.id : null;
    }
    match = hash.match(HASH_PATTERN_V1);
    if (match) {
      const id = parseInt(match[1], 10);
      return this._flatIndex?.has(id) ? id : null;
    }
    return null;
  }

  // ---------- RENDER: STATIC CONTENT ----------

  _renderContent({ classroom, building, campus }, { deferContent = false } = {}) {
    // Chips only stagger in when opening a classroom, not on re-renders
    // (occupancy refresh) of the one already showing.
    const enter = this._enteredId !== classroom.id;
    this._enteredId = classroom.id;
    const featuresHtml = (classroom.features ?? [])
      .filter(f => FEATURE_ICONS[f.id])
      .map(({ id }, i) => {
        const { icon, key } = FEATURE_ICONS[id];
        return `
          <div class="detail-feature-chip liquid-glass${enter ? ' detail-feature-chip--enter' : ''}" data-feature-id="${id}" style="--i:${i}">
            <i class="hgi-stroke ${icon}" aria-hidden="true"></i>
            <span>${t(key)}</span>
          </div>`;
      })
      .join('');

    // building.hours is resolved upstream (building > campus default > global
    // default); opening hours are only defined per building, never per room.
    let hoursHtml = '';
    const hours = building.hours
      ?? occupancyData.flatMap(d => d.campuses ?? [])
        .find(c => c.id === campus.id)?.buildings
        ?.find(b => b.name === building.name)?.hours;
    if (hours) {
      const dow = new Date().getDay(); // 0 = Sunday
      const rows = [
        ['mon_fri', 'detail.monFri', dow >= 1 && dow <= 5],
        ['sat', 'detail.saturday', dow === 6],
        ['sun', 'detail.sunday', dow === 0],
      ].map(([key, label, isToday]) => {
        const range = hours[key];
        const value = range ? `${escapeHtml(range[0])} – ${escapeHtml(range[1])}` : t('detail.closed');
        return `<div class="detail-hours-row${isToday ? ' detail-hours-row--today' : ''}${range ? '' : ' detail-hours-row--closed'}">
          <span class="detail-hours-day">${t(label)}</span>
          <span class="detail-hours-time">${value}</span>
        </div>`;
      }).join('');
      hoursHtml = `<div class="detail-hours">${rows}</div>`;
    }

    const hasMap = typeof building.lat === 'number' && typeof building.long === 'number';
    const mapLabel = building.altName?.trim() || `${t('building.prefix')} ${building.name}`;
    const mapLinks = hasMap ? {
      google: `https://www.google.com/maps/search/?api=1&query=${building.lat},${building.long}`,
      apple: `https://maps.apple.com/?ll=${building.lat},${building.long}&q=${encodeURIComponent(mapLabel)}`,
    } : null;
    const status = getClassroomStatusNow(classroom.id);
    let statusHtml = '';
    if (status) {
      const statusKeys = {
        'free': 'status.free',
        'occupied': 'status.occupied',
        'free-soon': 'status.freeSoon',
        'occupied-soon': 'status.occupiedSoon',
        'closed': 'status.closed'
      };
      statusHtml = `
        <div class="detail-status-wrapper">
          <span class="detail-status-label">${t('detail.currentStatus')}</span>
          <h4 class="classroom-status-txt ${status}">${t(statusKeys[status])}</h4>
        </div>`;
    }

    // Graduation days at this campus among the days the schedule shows (or
    // the next week, before the occupancy is in): the ceremonies may take
    // the room even where it shows as free
    const today = milanDay();
    const scheduleDays = occupancyData.length
      ? occupancyData.map(d => `${d.date.slice(0, 4)}-${d.date.slice(4, 6)}-${d.date.slice(6, 8)}`)
      : Array.from({ length: 7 }, (_, i) => {
        const d = new Date(`${today}T12:00:00`);
        d.setDate(d.getDate() + i);
        return d.toISOString().slice(0, 10);
      });
    const graduationDays = scheduleDays.filter(d => d >= today && graduationOn(d, campus.id));
    let graduationHtml = '';
    if (graduationDays.length) {
      const fmt = new Intl.DateTimeFormat(getLocale(), { weekday: 'short', day: 'numeric', month: 'short' });
      const days = graduationDays.map(d => fmt.format(new Date(`${d}T12:00:00`))).join(', ');
      const [one, many] = t('detail.graduationText').split('|');
      graduationHtml = `
          <div class="detail-events-only detail-graduation" role="note">
            <i class="hgi-stroke hgi-laurel-wreath-01" aria-hidden="true"></i>
            <div>
              <strong>${escapeHtml(t('detail.graduationTitle').replace('{days}', days))}</strong>
              <p>${graduationDays.length > 1 ? (many ?? one) : one}</p>
            </div>
          </div>`;
    }

    this._overlay.removeAttribute('data-title-tone');
    // The shared campus Map() may be sitting inside the old card — step it
    // out before the markup is replaced, or it would be destroyed with it.
    parkMap();
    this._overlay.classList.remove('title-stuck');
    this._overlay.innerHTML = `
      ${this._hasPhoto(classroom) ? `
        <div class="detail-photo-backdrop"></div>
        <div class="detail-photo-container">
          <img class="detail-photo" alt="">
          <div class="detail-photo-gradient"></div>
        </div>`
      : ''}
        <div class="detail-header">
        <div class="detail-title-row">
          <h1 class="detail-title" role="button" tabindex="0">${escapeHtml(classroom.name)}</h1>
          ${statusHtml}
        </div>
        <p class="detail-subtitle secondary">
          ${t('building.prefix')} ${building.altName ? `${escapeHtml(building.altName)} (${escapeHtml(building.name)})` : escapeHtml(building.name)} &middot; ${escapeHtml(campus.name)}
        </p>
        <div class="detail-stats">
          <div class="detail-stat">
            <i class="hgi-stroke hgi-user-multiple" aria-hidden="true"></i>
            <span>${classroom.seats} ${t('detail.seats')}</span>
          </div>
          ${classroom.accessible_seats ? `
            <div class="detail-stat">
              <i class="hgi-stroke hgi-wheelchair" aria-hidden="true"></i>
              <span>${classroom.accessible_seats} ${t('detail.disabledSeats')}</span>
            </div>
          ` : ''}
        </div>
        ${classroom.eventsOnly ? `
          <div class="detail-events-only" role="note">
            <i class="hgi-stroke hgi-alert-02" aria-hidden="true"></i>
            <div>
              <strong>${t('detail.eventsOnlyTitle')}</strong>
              <p>${t('detail.eventsOnlyText')}</p>
            </div>
          </div>
        ` : ''}
        ${graduationHtml}
      </div>
      <div class="detail-content${deferContent ? ' detail-content--deferred' : ''}">
        <div class="detail-column">
        <section class="detail-section">
          <h2 class="detail-section-title">${t('detail.features')}</h2>
          ${featuresHtml
        ? `<div class="detail-features">${featuresHtml}</div>`
        : `<p class="secondary detail-no-features">${t('detail.noFeatures')}</p>`
      }
        </section>

        <section class="detail-section">
          <div class="detail-section-header">
            <h2 class="detail-section-title">${t('detail.weeklySchedule')}</h2>
            <div class="detail-schedule-legend">
              <div class="detail-schedule-legend-item">
                <span class="detail-schedule-legend-box lg-glass lg-glass--tinted"></span>
                <span class="detail-schedule-legend-label">${t('detail.occupied')}</span>
              </div>
            </div>
          </div>
          <div id="detail-schedule-container">
            <div class="detail-schedule-loading">
              ${Array.from({ length: 7 }, () => '<div class="detail-schedule-skeleton"></div>').join('')}
            </div>
          </div>
        </section>
        </div>

        <div class="detail-column">
        ${hoursHtml ? `
        <section class="detail-section">
          <h2 class="detail-section-title">${t('detail.openingHours')}</h2>
          ${hoursHtml}
        </section>` : ''}

        ${hasMap ? `
        <section class="detail-section detail-map-section">
          <h2 class="detail-section-title">${t('detail.location')}</h2>
          <div class="detail-map"></div>
          <div class="detail-map-links"></div>
        </section>` : ''}
        </div>
      </div>
    `;
    // Refit whenever the row's width changes (the overlay being shown, a resize, the
    // badge's text) and once the web font is in. Height changes are the fit itself.
    decorate('detail', this._overlay, { classroom, building, campus });

    this._titleRowObserver?.disconnect();
    const titleRow = this._overlay.querySelector('.detail-title-row');
    if (titleRow) {
      let rowWidth = -1;
      this._titleRowObserver = new ResizeObserver(([entry]) => {
        if (entry.contentRect.width === rowWidth) return;
        rowWidth = entry.contentRect.width;
        this._fitTitle();
      });
      this._titleRowObserver.observe(titleRow);
    }
    fontsReady.then(() => this._fitTitle());

    // Title click -> manual refresh of photo and schedule
    this._overlay.querySelector('.detail-title')?.addEventListener('click', () => {
      this._loadSchedule(classroom.id);
      if (this._hasPhoto(classroom)) this._loadPhoto(classroom.id);
    });

    if (hasMap) {
      const links = this._overlay.querySelector('.detail-map-links');
      for (const [href, icon, key] of [
        [mapLinks.google, 'google-maps', 'detail.openGoogleMaps'],
        [mapLinks.apple, 'apple-maps', 'detail.openAppleMaps'],
      ]) {
        const img = new Image();
        img.className = 'detail-map-link-icon';
        img.src = `/assets/${icon}.png`;
        img.alt = '';
        links.appendChild(createButton({
          icon: img,
          text: t(key),
          className: 'detail-map-link',
          onClick: () => window.open(href, '_blank', 'noopener,noreferrer'),
        }));
      }
      const mapHost = this._overlay.querySelector('.detail-map');
      const pov = document.createElement('div');
      pov.className = 'detail-map-pov';
      mapHost.appendChild(pov);
      createSegmentedControl(pov, {
        items: [{ value: '2d', label: '2D' }, { value: '3d', label: '3D' }],
        value: getEmbedPov(),
        orientation: 'vertical',
        blur: true,
        onSelect: setEmbedPov,
      });
      this._scheduleMapEmbed(mapHost, {
        lat: building.lat,
        long: building.long,
        building: { name: building.name, alt: building.altName?.trim() },
        // Every building on the campus, for the 2D overview.
        siblings: (campus.buildings ?? [])
          .filter(b => typeof b.lat === 'number' && typeof b.long === 'number')
          .map(b => ({ lat: b.lat, long: b.long })),
      });
    } else {
      releaseMap();
    }

    this._animateMasonry(this._overlay.querySelector('.detail-content'));
  }

  /**
   * FLIP-animates layout reflows on resize that CSS can't transition on its
   * own: the masonry cards, and the wrapping feature chips. Each
   * ResizeObserver tick measures where an item landed, then slides it from
   * where it visually was (including any in-flight slide) to its new spot.
   * Uses the Web Animations API so it never fights the elements' own
   * transform/translate/transition styles.
   */
  _animateReflow(container, itemSelector, observers) {
    if (!container || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const items = [...container.querySelectorAll(itemSelector)];
    const measure = () => new Map(items.map(el => {
      const r = el.getBoundingClientRect();
      const m = new DOMMatrix(getComputedStyle(el).transform);
      return [el, { x: r.left - m.e, y: r.top - m.f, tx: m.e, ty: m.f }];
    }));

    let prev = null;
    const ro = new ResizeObserver(() => {
      const cur = measure();
      if (prev) {
        for (const el of items) {
          const a = prev.get(el), b = cur.get(el);
          // Old visual spot = old layout spot + the slide still in flight now
          const dx = a.x + b.tx - b.x;
          const dy = a.y + b.ty - b.y;
          if (Math.abs(dx - b.tx) < 1 && Math.abs(dy - b.ty) < 1) continue;
          el.getAnimations().filter(an => an.id === 'reflow').forEach(an => an.cancel());
          const anim = el.animate(
            [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
            { duration: 350, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
          );
          anim.id = 'reflow';
        }
      }
      prev = measure();
    });
    // Its first callback only takes the starting measurements, but it runs
    // on the open transition's first frames, as forced layouts. Nothing can
    // reflow under the snapshot anyway, so start watching once it has landed.
    this._afterTransition(() => { if (container.isConnected) ro.observe(container); });
    observers.push(ro);
  }

  _animateMasonry(content) {
    this._reflowObservers?.forEach(o => o.disconnect());
    this._reflowObservers = [];
    if (!content) return;
    this._animateReflow(content, ':scope > .detail-column > .detail-section', this._reflowObservers);
    this._animateReflow(content.querySelector('.detail-features'), '.detail-feature-chip', this._reflowObservers);
  }

  // ---------- RENDER: HERO PHOTO ----------

  /* The backdrop's blurred box as its CSS lays it out, for the next open to
     pre-render: it only depends on the viewport, so the last open's is the
     next one's. Read after the transition, when style is already up to date. */
  _measureBackdrop() {
    const el = this._overlay?.querySelector('.detail-photo-backdrop');
    if (!el) return;
    const cs = getComputedStyle(el, '::before');
    const box = {
      width: parseFloat(cs.width),
      height: parseFloat(cs.height),
      bleed: parseFloat(cs.paddingLeft),
      blur: parseFloat(cs.getPropertyValue('--bd-blur-px')),
      repeatY: cs.getPropertyValue('--bd-repeat').trim() !== 'repeat-x',
    };
    if (box.width > 0 && box.height > 0 && box.blur > 0) this._backdropBox = box;
  }

  /** Feeds the blurred backdrop behind the hero photo (see .detail-photo-backdrop).
      Always the thumbnail: under a 40px blur its resolution is lost anyway, and
      the tint / dimming / title-tone caches are keyed by this URL. */
  _setBackdrop(url) {
    const el = this._overlay.querySelector('.detail-photo-backdrop');
    if (!el) return;
    // Pre-blurred when it can be (utils/photo.js blurredBackdrop): the GPU
    // otherwise redoes the blur on every frame the page moves. That needs the
    // backdrop's box, measured once an earlier open has landed
    // (_measureBackdrop), and the photo's small copy, made by extractPhotoColor;
    // until then, the live filter. ?vtdebug=liveblur keeps the live one, to compare.
    const show = () => {
      const pre = this._backdropBox && !vtFlag('liveblur') ? blurredBackdrop(url, this._backdropBox) : null;
      el.style.setProperty('--backdrop-img', `url("${pre ?? url}")`);
      el.classList.toggle('prerendered', !!pre);
      el.classList.add('loaded');
    };

    // Base color under the backdrop's fade (see #classroom-detail-overlay's
    // background). Best-effort: without it the page just stays --background-color.
    // The backdrop waits for it: below the photo it is the photo's bottom strip
    // stretched down the page, which only reads as a wash of color once the
    // tint it fades into is there. Shown early, a slow extraction left it as
    // the photo smeared down an untinted page. Both then fade in together.
    const cached = getCachedPhotoColor(url);
    if (cached) {
      document.documentElement.style.setProperty('--detail-tint', cached);
      show();
    }
    this._applyPhotoDim(url, el);
    this._applyTitleTone(url, el);
    extractPhotoColor(url).then(color => {
      if (!el.isConnected) return;
      if (color) document.documentElement.style.setProperty('--detail-tint', color);
      if (!cached) show();
      this._applyPhotoDim(url, el);
      this._applyTitleTone(url, el);
      this._applyTextContrast();
    });
  }

  /**
   * Shrinks the title (--title-fit, down to 60%) when its longest word is
   * wider than the room it has, as with "AULA INFORMATIZZATA" beside the
   * status badge: the name wraps between words, and a word that can't fit
   * would otherwise break mid-word. Not hyphens: WebKit doesn't hyphenate
   * capitalised words, and these names are all caps. Measured with
   * overflow-wrap off, as the widest line the text then makes.
   */
  _fitTitle() {
    const title = this._overlay.querySelector('.detail-title');
    const row = title?.parentElement;
    if (!title || this._overlay.hidden) return;
    // The room the row leaves the title, not the title's own width: the title is
    // fit-content, so once its text fits it is exactly as wide as the text.
    const rs = getComputedStyle(row);
    const ts = getComputedStyle(title);
    const badge = row.querySelector('.detail-status-wrapper');
    const room = row.clientWidth - parseFloat(rs.paddingLeft) - parseFloat(rs.paddingRight)
      - (badge ? badge.offsetWidth + parseFloat(rs.columnGap || 0) : 0)
      - parseFloat(ts.marginLeft) - parseFloat(ts.marginRight)
      - parseFloat(ts.paddingLeft) - parseFloat(ts.paddingRight);
    title.style.removeProperty('--title-fit');
    title.style.overflowWrap = 'normal';
    const range = document.createRange();
    range.selectNodeContents(title);
    const widest = () => Math.max(0, ...[...range.getClientRects()].map(r => r.width));
    // A few rounds: the text doesn't shrink exactly in proportion to the font size
    // (rounding, spacing), so one ratio can leave it a pixel or two over.
    let fit = 1;
    for (let i = 0; i < 4 && room > 0 && fit > 0.6; i++) {
      const w = widest();
      if (w <= room - 1) break; // a pixel spare: a word exactly as wide as its line still breaks
      fit = Math.max(0.6, fit * ((room - 1) / w) * 0.99);
      title.style.setProperty('--title-fit', fit.toFixed(3));
    }
    title.style.overflowWrap = '';
    this._measurePin();
    this._applyTextContrast(); // the text moved over the photo
  }

  /**
   * Colours the title and subtitle for the photo behind them
   * (utils/text-contrast.js). Refines
   * _applyTitleTone's black or white, which stays as the first guess. It reads
   * the page laid out at rest, so it waits for the transition to land and an
   * idle moment, and skips a page already scrolled (the next call made at the
   * top redoes it).
   */
  _applyTextContrast() {
    if (this._textContrastQueued) return;
    this._textContrastQueued = true;
    this._afterTransition(() => {
      const run = () => { this._textContrastQueued = false; this._planTextContrast(); };
      if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 500 });
      else setTimeout(run, 100);
    });
  }

  _planTextContrast() {
    if (this._currentId === null || this._overlay.hidden) return;
    if ((document.scrollingElement?.scrollTop ?? 0) !== 0) return;
    const title = this._overlay.querySelector('.detail-title');
    const subtitle = this._overlay.querySelector('.detail-subtitle');
    const photo = this._overlay.querySelector('.detail-photo-container');
    const backdrop = this._overlay.querySelector('.detail-photo-backdrop');
    const small = getPhotoSmall(thumbUrl(this._currentId));
    if (!title || !subtitle || !photo || !small) return;

    const plan = planHeaderText({
      lines: [title, subtitle],
      photoBox: photo.getBoundingClientRect(),
      backdropBox: backdrop?.getBoundingClientRect() ?? null,
      pageBg: getComputedStyle(this._overlay).backgroundColor,
      dim: this._photoDim(thumbUrl(this._currentId)),
      blur: backdrop ? parseFloat(getComputedStyle(backdrop, '::before').getPropertyValue('--bd-blur-px')) || 40 : 40,
      tint: getComputedStyle(document.documentElement).getPropertyValue('--detail-tint').trim() || 'grey',
      small,
    });
    if (!plan) return;

    title.style.setProperty('--title-ink', plan.inks[0]);
    subtitle.style.color = plan.inks[1];
  }

  /**
   * Measures the title's pin (see "The pin" in classroom-detail.css): where its
   * text sits at rest, where it goes in the pill beside the back button and at
   * what size, the pill's box at both ends, and the scroll at which the row
   * sticks. All in the row's own box, from layout offsets, so transforms and
   * the current scroll don't affect it, except the stick point, which needs
   * the page at rest and is kept from the last time it was.
   */
  _measurePin() {
    const row = this._overlay.querySelector('.detail-title-row');
    const title = row?.querySelector('.detail-title');
    if (!title || this._overlay.hidden || !CSS.supports('animation-timeline: scroll()')) return;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const rs = getComputedStyle(row);
    const ts = getComputedStyle(title);
    const rowRect = row.getBoundingClientRect();
    const stickyTop = parseFloat(rs.top) || 0;
    const padL = parseFloat(ts.paddingLeft), padT = parseFloat(ts.paddingTop);

    // At rest: the title's box (its glass starts there) and its text inside it.
    const x0 = title.offsetLeft, y0 = title.offsetTop, w0 = title.offsetWidth, h0 = title.offsetHeight;
    const textW = w0 - 2 * padL, textH = h0 - 2 * padT;

    // Pinned: a pill from 0.5rem past the back button to the badge, centred on
    // the button; the text at most 2/3 of its size (1.875rem → 1.25rem), less
    // if that is what fits.
    const back = document.getElementById('detail-back-btn');
    const backRect = back && !back.hidden ? back.getBoundingClientRect() : null;
    const pillX = (backRect ? backRect.right - rowRect.left : 4.25 * rem) + 0.5 * rem;
    const centreY = backRect ? backRect.top + backRect.height / 2 - stickyTop : 1.5 * rem;
    const badge = row.querySelector('.detail-status-wrapper');
    const limit = (badge ? badge.offsetLeft : row.clientWidth - parseFloat(rs.paddingRight)) - parseFloat(rs.columnGap || 0);
    const k = Math.max(0.3, Math.min(2 / 3, (limit - pillX - 1.75 * rem) / textW));
    const pillW = textW * k + 1.75 * rem;
    const pillH = Math.max(3 * rem, textH * k + 0.75 * rem);
    const pillY = centreY - pillH / 2;
    const dx = pillX + 0.875 * rem - (x0 + padL);
    const dy = pillY + (pillH - textH * k) / 2 - (y0 + padT);

    // The glass sits at the pill and starts transformed onto the title's resting box.
    const set = (name, v) => row.style.setProperty(name, `${v.toFixed(2)}px`);
    set('--pill-x', pillX); set('--pill-y', pillY); set('--pill-w', pillW); set('--pill-h', pillH);
    set('--pill-from-x', x0 - pillX); set('--pill-from-y', y0 - pillY);
    row.style.setProperty('--pill-from-sx', (w0 / pillW).toFixed(4));
    row.style.setProperty('--pill-from-sy', (h0 / pillH).toFixed(4));
    set('--pin-dx', dx); set('--pin-dy', dy);
    row.style.setProperty('--pin-k', k.toFixed(4));

    // The scroll at which the row sticks: its distance to the sticky top, less
    // what the photo's shrink (0 → 220px of scroll, in the flow above it) takes
    // off on the way.
    const scroll = document.scrollingElement?.scrollTop ?? 0;
    if (scroll !== 0) return;
    const distance = rowRect.top - stickyTop;
    const photo = this._overlay.querySelector('.detail-photo-container');
    let shrink = 0;
    if (photo) {
      const ph = photo.getBoundingClientRect();
      const end = innerWidth < 600 ? Math.max(0.33 * innerHeight, 240) : ph.width * 8 / 21;
      shrink = Math.max(0, ph.height - end);
    }
    const at = distance / (1 + shrink / 220) <= 220 ? distance / (1 + shrink / 220) : distance - shrink;
    this._overlay.style.setProperty('--title-pin-at', `${Math.max(1, at).toFixed(1)}px`);
  }

  /**
   * Brightness multiplier for the photo: 1 for dark/mid photos, down to 0.7 for
   * very bright ones. Dark mode only (1 in light mode). CSS applies it to the
   * photo and its backdrop together so the fade between them stays seamless.
   */
  _photoDim(url) {
    if (!window.matchMedia('(prefers-color-scheme: dark)').matches) return 1;
    const lum = getCachedPhotoAverageLuminance(url);
    if (lum == null) return 1;
    // Linear-light: mid-grey is ~0.18, a white-walled room ~0.5+.
    const t = Math.min(1, Math.max(0, (lum - 0.2) / 0.35));
    return 1 - 0.3 * t;
  }

  /** Publishes _photoDim as --photo-dim on the overlay (read by the dark-mode CSS). */
  _applyPhotoDim(url, el) {
    if (getCachedPhotoAverageLuminance(url) == null || !el.isConnected) return;
    this._overlay.style.setProperty('--photo-dim', this._photoDim(url).toFixed(3));
  }

  /**
   * Picks black or white for the title from what's actually behind it: the
   * photo's bottom strip, faded into the theme background (the title sits in
   * that fade). Sets data-title-tone="light"|"dark" on the overlay, meaning
   * the backdrop is light/dark; CSS turns that into the text color.
   */
  _applyTitleTone(url, el) {
    const photoLum = getCachedPhotoLuminance(url);
    if (photoLum == null || !el.isConnected) return;
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const bgLum = dark ? 0.02 : 0.9;
    // The photo is what's on screen after dark-mode dimming: CSS brightness()
    // scales sRGB values, which is roughly dim^2.2 in linear light.
    const shownLum = photoLum * this._photoDim(url) ** 2.2;
    const lum = shownLum * 0.8 + bgLum * 0.2;
    // 0.179 is where black and white text have equal WCAG contrast; sitting
    // higher gives white the benefit on mid-tones, where it reads better.
    this._overlay.dataset.titleTone = lum > 0.3 ? 'light' : 'dark';
  }

  /* Replaces the thumbnail the hero is showing with the full photo, once the
     transition has landed and the page has a moment: decoding and uploading a
     1500x1125 photo is exactly what an older phone can't do while the zoom or
     the page's entrance animations are running. Decoded off to the side first,
     so the <img> changes source with its pixels ready — no flash — and a full
     photo that fails to load just leaves the thumbnail where it is. */
  async _upgradePhoto(classroomId, img) {
    const full = await fetchPhotoUrl(classroomId);
    if (img.src === full) return;
    await new Promise(resolve => this._afterTransition(resolve));
    await new Promise(resolve => {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(resolve, { timeout: 800 });
      else setTimeout(resolve, 300);
    });
    if (this._currentId !== classroomId || !img.isConnected || img.src === full) return;
    const pre = new Image();
    pre.src = full;
    try { await pre.decode(); } catch { return; }
    if (this._currentId !== classroomId || !img.isConnected) return;
    img.src = full;
  }

  async _loadPhoto(classroomId) {
    if (this._currentId !== classroomId) return;

    try {
      // The photo URLs are plain, stable routes (/v1/photos/:id and its /thumb).
      // Once one has been resolved for this room this session (an earlier open, a
      // card, a search row), its bytes are almost certainly in the HTTP cache. The
      // full photo if we have it, else the thumbnail, which _upgradePhoto replaces.
      const cachedUrl = photoUrlCache.get(classroomId) ?? thumbUrlCache.get(classroomId);

      // Ensure we have a container for the photo (it might have been removed on previous error)
      let container = this._overlay.querySelector('.detail-photo-container');
      if (!container) {
        const header = this._overlay.querySelector('.detail-header');
        if (header) {
          header.insertAdjacentHTML('beforebegin', '<div class="detail-photo-backdrop"></div><div class="detail-photo-container"><img class="detail-photo" alt=""></div>');
          container = this._overlay.querySelector('.detail-photo-container');
        }
      }

      const img = container?.querySelector('.detail-photo');
      if (!img) return;

      // Already revealed (by the ViewTransition, or an earlier call): at most the
      // thumbnail the zoom carried still has to make way for the full photo.
      if (img.classList.contains('loaded')) {
        this._upgradePhoto(classroomId, img);
        return;
      }

      if (cachedUrl) {
        // This <img> is fresh from a full re-render (occupancy refresh, language
        // switch) that dropped the previous element and its decoded bitmap. Going
        // through the async decode path below would leave it at opacity:0 for a
        // frame and then replay the 0.6s fade/zoom intro on a photo that never
        // changed — the "blink". Stamp src + `loaded` synchronously (same task as
        // the innerHTML that created it, so it's painted only once, already
        // revealed). onerror still culls a genuinely broken URL (stale idfoto).
        img.onerror = () => {
          markPhotoBroken(classroomId);
          if (this._currentId === classroomId) { container?.remove(); this._overlay.querySelector('.detail-photo-backdrop')?.remove(); }
        };
        img.classList.add('loaded');
        container.classList.add('loaded');
        img.src = cachedUrl;
        this._setBackdrop(thumbUrl(classroomId));
        this._photoRevealed();
        this._upgradePhoto(classroomId, img);
        return;
      }

      // First time we've needed this room's photo this session — resolve, load,
      // decode, then reveal with the intro transition. The thumbnail first: a
      // third of the bytes over a phone's connection. The full photo follows.
      const url = await fetchThumbUrl(classroomId);
      if (this._currentId !== classroomId) return;

      // Most of the time this lands in the middle of the open transition, and
      // the backdrop blurring in underneath the zoom's live snapshot repaints
      // the whole page on every remaining frame of it. Wait for it to land.
      if (!vtFlag('live')) {
        await new Promise(resolve => this._afterTransition(resolve));
        if (this._currentId !== classroomId || !img.isConnected) return;
      }

      img.src = url;
      this._setBackdrop(url);
      img.decode().then(() => {
        if (this._currentId !== classroomId) return;
        img.classList.add('loaded');
        container.classList.add('loaded');
        this._photoRevealed();
        this._upgradePhoto(classroomId, img);
      }).catch(() => {
        // Only while this room is still up: a decode is also abandoned when
        // the page moves on, which says nothing about the photo.
        if (this._currentId !== classroomId) return;
        markPhotoBroken(classroomId);
        container.remove();
        this._overlay.querySelector('.detail-photo-backdrop')?.remove();
      });
    } catch (err) {
      console.error('Classroom photo load error:', err);
      if (this._currentId !== classroomId) return;
      this._overlay.querySelector('.detail-photo-container')?.remove();
      this._overlay.querySelector('.detail-photo-backdrop')?.remove();
    }
  }

  // ---------- RENDER: WEEKLY SCHEDULE ----------

  _loadSchedule(classroomId) {
    clearInterval(this._nowTimer);
    this._timelinePopoverCleanup?.();
    this._timelinePopoverCleanup = null;
    const data = occupancyData;
    const container = document.getElementById('detail-schedule-container');

    if (!container) {
      console.warn('ClassroomDetail: Schedule container not found in DOM');
      return;
    }

    if (!Array.isArray(data) || data.length === 0) {
      console.warn('ClassroomDetail: No occupancy data found or empty');
      container.innerHTML = `<p class="secondary">${t('detail.noData')}</p>`;
      return;
    }

    try {
      const today = new Date();
      const todayKey = [
        today.getFullYear(),
        String(today.getMonth() + 1).padStart(2, '0'),
        String(today.getDate()).padStart(2, '0'),
      ].join('');

      const total = DAY_END - DAY_START;

      // Build chronological day list, inserting Sunday placeholders between data days
      const parseKey = key => new Date(
        parseInt(key.slice(0, 4), 10),
        parseInt(key.slice(4, 6), 10) - 1,
        parseInt(key.slice(6, 8), 10)
      );
      const sortedData = data.filter(d => d?.date).sort((a, b) => parseKey(a.date) - parseKey(b.date));
      const days = [];
      let prevDate = null;
      for (const dayData of sortedData) {
        const curr = parseKey(dayData.date);
        if (prevDate) {
          const check = new Date(prevDate);
          check.setDate(check.getDate() + 1);
          while (check < curr) {
            if (SKIP_DAYS.includes(check.getDay())) days.push({ dayData: null, date: new Date(check) });
            check.setDate(check.getDate() + 1);
          }
        }
        days.push({ dayData, date: curr });
        prevDate = curr;
      }

      const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
      const nowPct = nowMin >= DAY_START && nowMin <= DAY_END
        ? ((nowMin - DAY_START) / total * 100).toFixed(2)
        : null;

      // Query context: from/to range carried over from the Available Tab
      const queryDateKey = this._queryContext?.date?.replace(/-/g, '') ?? null;
      // Same shape, from a clicked search-result session instead.
      const highlightDateKey = this._highlight?.date?.replace(/-/g, '') ?? null;
      let queryFromPct = null, queryToPct = null, queryFromDisplay = '', queryToDisplay = '';
      if (this._queryContext) {
        const qFrom = Math.max(timeToMinutes(this._queryContext.from), DAY_START);
        const qTo   = Math.min(timeToMinutes(this._queryContext.to),   DAY_END);
        queryFromPct    = ((qFrom - DAY_START) / total * 100).toFixed(2);
        queryToPct      = ((qTo   - DAY_START) / total * 100).toFixed(2);
        queryFromDisplay = minutesToTimeDisplay(qFrom);
        queryToDisplay   = minutesToTimeDisplay(qTo);
      }

      // Populated as blocks are built; a block's data-slot-idx indexes into this
      // so the popover can look up its full metadata without re-parsing the DOM.
      const scheduleSlots = [];

      const _dayParts = days.map(({ dayData, date }) => {
        const isSunday = !dayData;

        const dayNum    = date.getDate();
        const narrowDay = date.toLocaleDateString(getLocale(), { weekday: 'narrow' });
        const narrowDayName = narrowDay.charAt(0).toUpperCase() + narrowDay.slice(1);
        const isToday    = !isSunday && dayData.date === todayKey;
        const isQueryDay = !isSunday && queryDateKey !== null && dayData.date === queryDateKey;

        const labelHtml = `
          <div class="detail-schedule-label-cell${isToday ? ' detail-schedule-label-cell--today' : ''} date-element-container">
            <span class="date-day-of-week${isSunday ? ' date-sunday' : ''}">${narrowDayName}</span>
            <span class="date-number">${dayNum}</span>
          </div>`;

        if (isSunday) {
          return { labelHtml, rowHtml: `
            <div class="detail-schedule-row detail-schedule-row--sunday">
              <div class="detail-schedule-bar-wrapper">
                <div class="detail-schedule-bar"></div>
              </div>
            </div>` };
        }

        let occupancy = [];
        let roomBuilding = null;
        outer: for (const c of dayData.campuses ?? []) {
          for (const b of c.buildings ?? []) {
            const room = b.classrooms?.find(r => String(r.id) === String(classroomId));
            if (room) { occupancy = room.occupancy; roomBuilding = b; break outer; }
          }
        }

        // No source had this room's schedule that day (scripts/fetch.py):
        // say so instead of drawing an empty, free-looking bar.
        if (occupancy === null) {
          return { labelHtml, rowHtml: `
            <div class="detail-schedule-row detail-schedule-row--unknown${isToday ? ' detail-schedule-row--today' : ''}">
              <div class="detail-schedule-bar-wrapper">
                <div class="detail-schedule-bar"><span class="detail-schedule-unknown">${t('detail.scheduleUnknown')}</span></div>
              </div>
            </div>` };
        }

        // The bar's contents: closed hours, the queried range, and the
        // bookings, each block indexing into scheduleSlots for its popover
        const { html: barHtml, openAttrs } = dayBarHtml({
          occupancy,
          opening: getBuildingOpening(roomBuilding, dayData.date),
          query: isQueryDay && this._queryContext ? this._queryContext : null,
          blockAttrs: (slot) => ` data-slot-idx="${scheduleSlots.push(slot) - 1}" tabindex="0" role="button"`,
          isHighlighted: (slot) => highlightDateKey !== null
            && dayData.date === highlightDateKey
            && slot.inizio === this._highlight?.from
            && slot.fine === this._highlight?.to,
        });

        const querySideIndicatorsHtml = isQueryDay && queryFromPct !== null ? `
          <div class="detail-schedule-query-indicator" style="--qpos:${queryFromPct}%">${queryFromDisplay}</div>
          <div class="detail-schedule-query-indicator" style="--qpos:${queryToPct}%">${queryToDisplay}</div>
        ` : '';

        return { labelHtml, rowHtml: `
          <div class="detail-schedule-row${isToday ? ' detail-schedule-row--today' : ''}${isQueryDay ? ' detail-schedule-row--query' : ''}">
            <div class="detail-schedule-bar-wrapper">
              <div class="timeline-hover-cursor" hidden></div>
              ${isToday && nowPct !== null ? `<div class="timeline-time-indicator timeline-time-indicator--now" style="--pos:${nowPct}%">${t('timepicker.now')}</div>` : ''}
              ${querySideIndicatorsHtml}
              <div class="detail-schedule-bar"${openAttrs}>
                ${barHtml}
                ${isToday && nowPct !== null ? `<div class="timeline-now-bar-line" style="--pos:${nowPct}%"></div>` : ''}
                <div class="timeline-hover-line" hidden></div>
              </div>
            </div>
          </div>` };
      });

      const labelsHtml = _dayParts.map(p => p.labelHtml).join('');
      const rowsHtml   = _dayParts.map(p => p.rowHtml).join('');

      if (!rowsHtml) {
        console.warn('ClassroomDetail: No room matches found in any day of occupancy data');
        container.innerHTML = `<p class="secondary">${t('detail.noData')}</p>`;
        return;
      }

      const nowTickHtml = nowPct !== null
        ? `<div class="timeline-time-indicator timeline-time-indicator--now" style="--pos:${nowPct}%">${t('timepicker.now')}</div>`
        : '';

      const queryTicksHtml = queryFromPct !== null ? `
        <div class="detail-schedule-query-indicator" style="--qpos:${queryFromPct}%">${queryFromDisplay}</div>
        <div class="detail-schedule-query-indicator" style="--qpos:${queryToPct}%">${queryToDisplay}</div>
      ` : '';

      const ticksHtml = (() => {
        const ticks = [];
        for (let m = DAY_START + 60; m < DAY_END; m += 60) {
          const left = ((m - DAY_START) / total * 100).toFixed(2);
          ticks.push(`<div class="detail-schedule-tick" style="--pos:${left}%"><span>${minutesToTimeDisplay(m)}</span></div>`);
        }
        return ticks.join('');
      })();

      const gridLinesHtml = (() => {
        const lines = [];
        for (let m = DAY_START + 60; m < DAY_END; m += 60) {
          const left = ((m - DAY_START) / total * 100).toFixed(2);
          lines.push(`<div class="detail-schedule-grid-line" style="--pos:${left}%"></div>`);
        }
        if (nowPct !== null) {
          lines.push(`<div class="detail-schedule-now-line" style="--pos:${nowPct}%"></div>`);
        }
        return lines.join('');
      })();

      // --- Mobile day selector chips ---
      const selectorItemsHtml = days.map(({ dayData, date }, i) => {
        const isSunday = !dayData;
        const raw = date.toLocaleDateString(getLocale(), { weekday: 'narrow' });
        const dayName = raw.charAt(0).toUpperCase() + raw.slice(1);
        const dayNum = date.getDate();
        return `
          <div class="date-element-container${isSunday ? ' detail-schedule-day--sunday date-skipped' : ''}" data-day-index="${i}">
            <span class="date-day-of-week${isSunday ? ' date-sunday' : ''}">${dayName}</span>
            <span class="date-number">${dayNum}</span>
          </div>`;
      }).join('');

      container.innerHTML = `
        <div class="detail-schedule-day-selector">
          <div class="detail-today-indicator hidden" aria-hidden="true">${t('datepicker.today')}</div>
          <div class="date-picker-container detail-schedule-picker">
            ${selectorItemsHtml}
          </div>
          <div class="date-indicator"></div>
        </div>
        <div class="detail-schedule-inner">
          <div class="detail-schedule-ticks">${ticksHtml}${nowTickHtml}${queryTicksHtml}</div>
          <div class="detail-schedule-grid">
            <div class="detail-desktop-today-indicator hidden" aria-hidden="true">${t('datepicker.today')}</div>
            <div class="detail-schedule-labels-pill liquid-glass">${labelsHtml}</div>
            <div class="detail-schedule-bars">
              <div class="detail-schedule-grid-lines">${gridLinesHtml}</div>
              ${rowsHtml}
            </div>
          </div>
        </div>
      `;

      if (localStorage.getItem('poliAule_hideSundays') === 'true') {
        container.classList.add('detail-schedule--hide-sundays');
      }

      this._nowTimer = setInterval(() => {
        const n = new Date().getHours() * 60 + new Date().getMinutes();
        const pctVal = n >= DAY_START && n <= DAY_END
          ? `${((n - DAY_START) / total * 100).toFixed(2)}%`
          : null;
        container.querySelectorAll('.timeline-time-indicator--now, .timeline-now-bar-line, .detail-schedule-now-line').forEach(el => {
          if (pctVal) { el.style.setProperty('--pos', pctVal); el.hidden = false; }
          else { el.hidden = true; }
        });
      }, 60_000);

      // --- Mobile day selector interaction (drag/spring physics ported
      // from bottom-nav.js's tab pill — see pill-selector.js) ---
      const pickerContainer = container.querySelector('.detail-schedule-picker');
      const todayIndicatorEl = container.querySelector('.detail-today-indicator');
      const gridEl = container.querySelector('.detail-schedule-bars');
      const rowEls = gridEl.querySelectorAll('.detail-schedule-row');

      // The highlight is a one-shot cue for the lesson the user just searched
      // for — the first tap or keypress anywhere in the schedule drops it.
      const clearHighlight = () => {
        if (!this._highlight) return;
        this._highlight = null;
        container.querySelectorAll('.detail-schedule-block--highlight')
          .forEach(el => el.classList.remove('detail-schedule-block--highlight'));
      };
      container.addEventListener('pointerdown', clearHighlight);
      container.addEventListener('keydown', clearHighlight);

      let selectedDayIndex = 0;

      const daySelector = createPillSelector(pickerContainer, {
        onSelect(chip, { silent }) {
          const index = parseInt(chip.dataset.dayIndex);
          selectedDayIndex = index;
          rowEls.forEach((row, i) => row.classList.toggle('selected', i === index));
          if (!silent) {
            hideOccupationPopover();
          }
        },
      });
      daySelector.refresh();

      function selectScheduleDay(index, opts) {
        const chip = pickerContainer.querySelector(`[data-day-index="${index}"]`);
        if (chip) daySelector.selectElement(chip, opts);
      }

      // Auto-select: prefer the queried or highlighted day when coming from the
      // Available Tab or search overlay, otherwise today, or next available day
      // if after 20:15, or first available
      const todayDayIndex = days.findIndex(d => d.dayData?.date === todayKey);
      const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
      const preferredDateKey = queryDateKey ?? highlightDateKey;
      let initialDayIndex;
      if (preferredDateKey) {
        const preferredDayIndex = days.findIndex(d => d.dayData?.date === preferredDateKey);
        initialDayIndex = preferredDayIndex >= 0 ? preferredDayIndex : (todayDayIndex >= 0 ? todayDayIndex : days.findIndex(d => d.dayData !== null));
      } else if (nowMins > DAY_END && todayDayIndex >= 0) {
        const nextIndex = days.findIndex((d, i) => i > todayDayIndex && d.dayData !== null);
        initialDayIndex = nextIndex >= 0 ? nextIndex : todayDayIndex;
      } else if (todayDayIndex >= 0) {
        initialDayIndex = todayDayIndex;
      } else {
        initialDayIndex = days.findIndex(d => d.dayData !== null);
      }
      selectScheduleDay(Math.max(0, initialDayIndex), { silent: true, animate: false });

      // Today indicator: position the pill above the today chip (mobile only)
      function positionDetailTodayIndicator() {
        if (!todayIndicatorEl || !window.matchMedia('(max-width: 599px)').matches) return;
        const todayChip = pickerContainer.querySelector(`[data-day-index="${todayDayIndex}"]`);
        if (!todayChip || todayDayIndex < 0) {
          todayIndicatorEl.classList.add('hidden');
          return;
        }
        todayIndicatorEl.classList.remove('hidden');
        const left = pickerContainer.offsetLeft + todayChip.offsetLeft + todayChip.offsetWidth / 2;
        const top  = pickerContainer.offsetTop - todayIndicatorEl.offsetHeight - 8;
        todayIndicatorEl.style.left = `${left}px`;
        todayIndicatorEl.style.top  = `${top}px`;
      }
      todayIndicatorEl?.addEventListener('click', () => {
        if (todayDayIndex >= 0) selectScheduleDay(todayDayIndex);
      });
      positionDetailTodayIndicator();

      // Desktop Today indicator — position it vertically aligned with the today cell
      const desktopTodayIndicatorEl = container.querySelector('.detail-desktop-today-indicator');
      const pillEl = container.querySelector('.detail-schedule-labels-pill');

      function positionDesktopTodayIndicator() {
        if (!desktopTodayIndicatorEl || !pillEl || window.matchMedia('(max-width: 599px)').matches) return;
        const todayCell = pillEl.querySelector('.detail-schedule-label-cell--today');
        if (!todayCell) {
          desktopTodayIndicatorEl.classList.add('hidden');
          return;
        }
        desktopTodayIndicatorEl.classList.remove('hidden');
        const top = pillEl.offsetTop
          + todayCell.offsetTop
          + todayCell.offsetHeight / 2
          - desktopTodayIndicatorEl.offsetHeight / 2;
        desktopTodayIndicatorEl.style.top = `${top}px`;
      }
      positionDesktopTodayIndicator();
      window.addEventListener('resize', positionDesktopTodayIndicator);

      // Re-position the indicator when resizing from desktop → mobile, because
      // offsetLeft/offsetWidth read as 0 while the selector is display:none.
      const mobileQuery = window.matchMedia('(max-width: 599px)');
      const relayoutMobile = () => {
        daySelector.refresh();
        selectScheduleDay(selectedDayIndex, { silent: true, animate: false });
        positionDetailTodayIndicator();
      };
      mobileQuery.addEventListener('change', e => {
        if (e.matches) relayoutMobile();
        else positionDesktopTodayIndicator();
      });
      // The picker is centered in its wrapper, so resizing the window moves it
      // without necessarily changing its own size; the pill and Today badge are
      // placed with absolute offsets and would stay behind. Re-measure whenever
      // the wrapper or the picker changes size (also covers display:none → block).
      if (typeof ResizeObserver !== 'undefined') {
        let raf = 0;
        const ro = new ResizeObserver(() => {
          cancelAnimationFrame(raf);
          raf = requestAnimationFrame(() => {
            if (pickerContainer.offsetWidth) relayoutMobile();
          });
        });
        // The picker was just laid out above; a first relayout on the open
        // transition's opening frames would only repeat it. See _animateReflow.
        this._afterTransition(() => {
          if (!pickerContainer.isConnected) return;
          ro.observe(pickerContainer);
          ro.observe(pickerContainer.parentElement);
        });
      }

      // ---------- TIMELINE HOVER ----------
      let _activeBar = null;
      container.addEventListener('mousemove', e => {
        const bar = e.target.closest?.('.detail-schedule-bar');

        if (_activeBar && _activeBar !== bar) {
          const prevCursor = _activeBar.closest('.detail-schedule-bar-wrapper')?.querySelector('.timeline-hover-cursor');
          if (prevCursor) prevCursor.hidden = true;
          const prevLine = _activeBar.querySelector('.timeline-hover-line');
          if (prevLine) prevLine.hidden = true;
          _activeBar = null;
        }

        if (!bar) return;
        _activeBar = bar;

        const wrapper = bar.closest('.detail-schedule-bar-wrapper');
        const cursor = wrapper?.querySelector('.timeline-hover-cursor');
        const line = bar.querySelector('.timeline-hover-line');
        if (!cursor || !line) return;

        const rect = bar.getBoundingClientRect();
        const isMobileVertical = window.matchMedia('(max-width: 599px)').matches;

        const fraction = isMobileVertical
          ? Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
          : Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const minutes = Math.round(DAY_START + fraction * total);
        const pct = `${(fraction * 100).toFixed(2)}%`;

        if (isMobileVertical) {
          cursor.style.top = pct;
          cursor.style.left = '';
          line.style.top = pct;
          line.style.left = '';
        } else {
          cursor.style.left = pct;
          cursor.style.top = '';
          line.style.left = pct;
          line.style.top = '';
        }

        const { openFrom, openTo } = bar.dataset;
        const isClosedHere = openFrom !== undefined
          && (minutes < Number(openFrom) || minutes >= Number(openTo));
        cursor.textContent = minutesToTimeDisplay(minutes) + (isClosedHere ? ` · ${t('detail.closed')}` : '');
        cursor.hidden = false;
        line.hidden = false;
      });
      container.addEventListener('mouseleave', () => {
        if (_activeBar) {
          const prevCursor = _activeBar.closest('.detail-schedule-bar-wrapper')?.querySelector('.timeline-hover-cursor');
          if (prevCursor) prevCursor.hidden = true;
          const prevLine = _activeBar.querySelector('.timeline-hover-line');
          if (prevLine) prevLine.hidden = true;
          _activeBar = null;
        }
      });

      // ---------- TIMELINE OCCUPATION POPOVER ----------
      // One popover reused for every block; it lives on <body>, so it is
      // destroyed with the rest of this render (see _timelinePopoverCleanup).
      const timelinePopover = createPopover({ placement: 'top', role: 'tooltip', dismissable: false });
      timelinePopover.el.style.setProperty('--lg-popover-max-width', 'min(280px, 70vw)');
      let _popoverBlock = null;

      const showOccupationPopover = (blockEl) => {
        const slot = scheduleSlots[Number(blockEl.dataset.slotIdx)];
        if (!slot) return;
        timelinePopover.setContent(`<div class="timeline-popover-body">${buildOccupationPopoverHtml(slot)}</div>`);
        _popoverBlock = blockEl;
        timelinePopover.show(blockEl);
      };
      const hideOccupationPopover = () => { _popoverBlock = null; timelinePopover.hide(); };

      // Scroll to and open the popover on the searched lesson — once per open,
      // so a later re-render (language switch, refreshOccupancy) doesn't jump
      // the page back or re-pop it after the user has moved on. Deferred past
      // the open transition: _doOpen's own cleanup resets window.scrollY to 0
      // once the View Transition finishes if anything moved it in the
      // meantime (its safety net against stray scroll during the snapshot
      // animation), which would otherwise race and cancel this scroll.
      if (this._highlight && !this._highlightConsumed) {
        this._highlightConsumed = true;
        this._afterTransition(() => {
          if (this._currentId !== classroomId) return;
          const primaryBlock = container.querySelector('.detail-schedule-block--highlight');
          if (!primaryBlock) return;
          // Open the popover only once the page has settled: the close-on-scroll
          // handler would dismiss one opened mid-scroll.
          const rect = primaryBlock.getBoundingClientRect();
          const maxY = document.documentElement.scrollHeight - window.innerHeight;
          const targetY = Math.min(Math.max(0, window.scrollY + rect.top + rect.height / 2 - window.innerHeight / 2), maxY);
          if (reduceMotion?.matches || Math.abs(targetY - window.scrollY) < 1) {
            primaryBlock.scrollIntoView({ block: 'center', behavior: 'auto' });
            showOccupationPopover(primaryBlock);
            return;
          }
          let shown = false;
          const show = () => {
            if (shown || this._currentId !== classroomId || !primaryBlock.isConnected) return;
            shown = true;
            showOccupationPopover(primaryBlock);
          };
          window.addEventListener('scrollend', show, { once: true });
          setTimeout(show, 800); // no scrollend in older Safari
          primaryBlock.scrollIntoView({ block: 'center', behavior: 'smooth' });
        });
      }

      {
        // Desktop hover
        let _hoveredBlock = null;
        container.addEventListener('pointerover', e => {
          if (e.pointerType && e.pointerType !== 'mouse') return;
          const block = e.target.closest?.('.detail-schedule-block');
          if (!block || block === _hoveredBlock) return;
          _hoveredBlock = block;
          showOccupationPopover(block);
        });
        container.addEventListener('pointerout', e => {
          if (e.pointerType && e.pointerType !== 'mouse') return;
          const block = e.target.closest?.('.detail-schedule-block');
          if (!block || block !== _hoveredBlock) return;
          _hoveredBlock = null;
          hideOccupationPopover();
        });

        // Keyboard focus (mirrors hover for accessibility). Blocks are
        // tabindex="0", so a tap or click focuses them too — only react to
        // keyboard focus, or the click toggle below would immediately close
        // the popover focusin just opened (first tap appeared to do nothing).
        container.addEventListener('focusin', e => {
          const block = e.target.closest?.('.detail-schedule-block');
          if (block && block.matches(':focus-visible')) showOccupationPopover(block);
        });
        container.addEventListener('focusout', e => {
          const block = e.target.closest?.('.detail-schedule-block');
          if (block) hideOccupationPopover();
        });

        // Tap / click toggles — this is the primary interaction on mobile
        container.addEventListener('click', e => {
          const block = e.target.closest?.('.detail-schedule-block');
          if (!block) { hideOccupationPopover(); return; }
          e.stopPropagation();
          // A mouse click on the hovered block keeps the hover popover open.
          if (block === _hoveredBlock) { showOccupationPopover(block); return; }
          if (_popoverBlock === block) hideOccupationPopover();
          else showOccupationPopover(block);
        });

        // Close on any interaction outside the schedule area (e.g. tapping the room title).
        const onDocClick = e => {
          if (!container.contains(e.target)) hideOccupationPopover();
        };
        document.addEventListener('click', onDocClick);

        // Close on scroll. The popover is positioned in fixed/viewport coordinates
        // and doesn't track the trigger as the page scrolls, so once the trigger
        // moves the popover would otherwise be left floating over the wrong spot.
        // On desktop this already happens implicitly (scrolling moves the hovered
        // block out from under a stationary cursor, firing pointerout), but a tap
        // on mobile leaves the popover open with no such gesture to close it.
        const onScroll = () => hideOccupationPopover();
        window.addEventListener('scroll', onScroll, { capture: true, passive: true });

        this._timelinePopoverCleanup = () => {
          timelinePopover.destroy();
          document.removeEventListener('click', onDocClick);
          window.removeEventListener('scroll', onScroll, { capture: true });
        };
      }
    } catch (err) {
      console.error('ClassroomDetail: Error rendering schedule:', err);
      container.innerHTML = `<p class="secondary">${t('detail.noData')}</p>`;
    }
  }
}

export const classroomDetail = new ClassroomDetail();
