import { classroomsData as occupancyData, SKIP_DAYS, getClassroomStatusNow } from '../available-rooms-script.js';
import { t, getLocale, onLanguageSwitch } from '../i18n.js';
import { haptics, defaultPatterns } from './haptics.js';
import { createTimeFormatter } from '../utils/time-format.js';
import { escapeHtml } from '../utils/html.js';
import { infoPage } from './info-page.js';
import { fetchPhotoUrl, photoUrlCache } from '../utils/photo.js';
import { isFavourite, toggleFavourite, FILLED_STAR_SVG } from '../utils/favourites.js';
import { DynamicPopover } from './popover.js';
import { createPillSelector } from './pill-selector.js';

function minutesToTimeDisplay(minutes) {
  const d = new Date();
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return createTimeFormatter({ hour: 'numeric', minute: '2-digit' }).format(d);
}

// ---------- CONSTANTS ----------

const FEATURE_ICONS = {
  4: { icon: 'videocam', key: 'features.videoProjector' },
  5: { icon: 'mic', key: 'features.radioMic' },
  6: { icon: 'blinds', key: 'features.dimmable' },
  7: { icon: 'cable', key: 'features.wiredDesk' },
  142: { icon: 'electrical_services', key: 'features.powerOutlets' },
  223: { icon: 'video_call', key: 'features.videoconf' },
};


function timeToMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

// Builds the popover body for a single occupancy slot. Course/exam slots carry
// structured fields (course, code, professors, section); anything the scrape
// couldn't parse only has `raw`; very old cached data may only have `name`.
function buildOccupationPopoverHtml(slot) {
  const timeRange = `${minutesToTimeDisplay(timeToMinutes(slot.inizio))} – ${minutesToTimeDisplay(timeToMinutes(slot.fine))}`;

  let titleText;
  const metaLines = [];

  if (slot.category === 'COURSE' || slot.category === 'EXAM') {
    titleText = slot.course ?? slot.name ?? t('detail.occupied');
    if (slot.category === 'EXAM') {
      metaLines.push(`<span class="timeline-popover-badge">${t('detail.examLabel')}</span>`);
    }
    if (slot.code != null) metaLines.push(`<span>${escapeHtml(String(slot.code))}</span>`);
    if (slot.section) metaLines.push(`<span>${escapeHtml(slot.section)}</span>`);
    if (Array.isArray(slot.professors) && slot.professors.length) {
      metaLines.push(`<span>${escapeHtml(slot.professors.join(', '))}</span>`);
    }
  } else {
    titleText = slot.raw ?? slot.name ?? t('detail.occupied');
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
    this._savedScrollPos = 0;
    this._queryContext = null;  // { date, from, to } when opened from Available Tab, else null
    this._nowTimer = null;
    this._timelinePopoverCleanup = null; // removes the previous _loadSchedule's document-level listener
  }

  // Called from script.js after all data is loaded.
  init(staticData) {
    this._staticData = staticData;
    this._overlay = document.getElementById('classroom-detail-overlay');
    this._tabbar = document.querySelector('.bn-wrapper');
    this._backBtn = document.getElementById('detail-back-btn');
    this._favBtn = document.getElementById('favourite-btn');

    this._favBtn?.addEventListener('click', () => {
      if (this._currentId === null) return;
      haptics.trigger(defaultPatterns.light);
      toggleFavourite(this._currentId);
      this._syncFavBtn();
    });
    window.addEventListener('favourites-changed', () => this._syncFavBtn());

    this._backBtn?.addEventListener('click', () => {
      haptics.trigger(defaultPatterns.light);
      if (this._openedViaPushState) {
        history.back();
      } else {
        history.replaceState(null, '', window.location.pathname + window.location.search);
        this._doClose();
      }
    });

    window.addEventListener('hashchange', () => this._onHashChange());

    window.addEventListener('hidesundayschange', (e) => {
      const container = document.getElementById('detail-schedule-container');
      if (container) container.classList.toggle('detail-schedule--hide-sundays', e.detail.hidden);
    });

    onLanguageSwitch(() => {
      if (this._currentId === null) return;
      const entry = this._flatIndex?.get(this._currentId);
      if (!entry) return;
      const scrollY = window.scrollY;
      this._renderContent(entry);
      this._loadSchedule(this._currentId);
      if (entry.classroom.idfoto) this._loadPhoto(this._currentId);
      window.scrollTo(0, scrollY);
    });

    window.addEventListener('timeformatchange', () => {
      if (this._currentId === null) return;
      const scrollY = window.scrollY;
      this._loadSchedule(this._currentId);
      window.scrollTo(0, scrollY);
    });

    // Click delegation — handles classroom cards on both the available and campus tabs
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-open-classroom]');
      if (!trigger) return;
      e.stopPropagation();
      haptics.trigger(defaultPatterns.light);

      const id = parseInt(trigger.dataset.openClassroom);

      // The whole card morphs into the whole page (VT shared element).
      const card = trigger.closest('.classroom-card') ?? trigger;

      const queryDate = card.dataset.queryDate ?? null;
      const queryFrom = card.dataset.queryFrom ?? null;
      const queryTo   = card.dataset.queryTo   ?? null;
      const queryContext = queryDate && queryFrom && queryTo
        ? { date: queryDate, from: queryFrom, to: queryTo }
        : null;

      this._pendingTrigger = { queryContext, cardEl: card };
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
    const fav = isFavourite(this._currentId);
    // .favourite-btn--active tints the star yellow (see style.css); the outline
    // hgi-star is swapped for a filled star SVG.
    this._favBtn.classList.toggle('favourite-btn--active', fav);
    this._favBtn.setAttribute('aria-label', t(fav ? 'favourite.remove' : 'favourite.add'));
    this._favBtn.setAttribute('aria-pressed', fav ? 'true' : 'false');
    this._favBtn.innerHTML = fav
      ? FILLED_STAR_SVG
      : '<i class="hgi-stroke hgi-star" aria-hidden="true"></i>';
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
    if (entry.classroom.idfoto) this._loadPhoto(this._currentId);
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
        this._doClose();
      }
    }
  }

  _silentClose() {
    if (!this._overlay || this._overlay.hidden) return;
    this._currentId = null;
    clearInterval(this._nowTimer);
    document.body.classList.remove('detail-open');
    // Leave tabbar.detail-open and backBtn visibility intact — info page takes over both
    this._overlay.setAttribute('hidden', '');
    this._overlay.classList.remove('visible');
    this._overlay.innerHTML = '';
    this._openTrigger = null;
    this._queryContext = null;
  }

  // ---------- OPEN ----------

  async _doOpen(id, pending) {
    if (!this._overlay) return;
    this._buildFlatIndex();

    const entry = this._flatIndex?.get(id);
    if (!entry) return;

    this._currentId = id;
    this._openTrigger = pending ?? null;
    this._queryContext = pending?.queryContext ?? null;

    // Save scroll position for when we return
    this._savedScrollPos = window.scrollY;

    // When returning from info page, the back button is already visible and info's own
    // hero elements should morph into the header instead of touching the tabbar.
    const fromInfo = !!(this._backBtn && !this._backBtn.hidden);

    // Photo VT: if the URL is already cached, pre-decode it so the detail photo
    // is bitmap-ready when the VT snapshots the new state.
    const hasPhoto = !!entry.classroom.idfoto;
    let validPhotoUrl = hasPhoto ? (photoUrlCache.get(id) ?? null) : null;
    if (validPhotoUrl) {
      const tmp = new Image();
      tmp.src = validPhotoUrl;
      const decoded = await tmp.decode().then(() => true).catch(() => false);
      if (this._currentId !== id) return; // navigated away during decode
      // Decode failed (e.g. a 404 from a stale idfoto) — don't stamp a broken image as
      // "loaded" below. Leaving validPhotoUrl unset lets _loadPhoto()'s own error path
      // (which removes the photo container entirely) run normally instead of being
      // skipped via its "already loaded" short-circuit.
      if (!decoded) validPhotoUrl = null;
    }

    if (document.startViewTransition) {
      // -- Whole-card zoom: one shared element, the card's own bounding box
      // morphs straight into the full page (SwiftUI .zoom-style), rather than
      // morphing name/photo/icons independently. --
      const cardEl = pending?.cardEl ?? null;
      const cardInDom = !!(cardEl && document.body.contains(cardEl));
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
      if (cardInDom) cardEl.style.viewTransitionName = 'classroom-detail-zoom';

      const vt = document.startViewTransition(() => {
        if (fromInfo) {
          infoPage._applyReturnVT();
        } else if (this._tabbar) {
          this._tabbar.classList.add('detail-open');
        }
        if (cardInDom) cardEl.style.viewTransitionName = '';

        document.body.classList.add('detail-open');
        // --header-height is normally kept live by a ResizeObserver (script.js),
        // but that callback fires asynchronously — too late for the VT, which
        // snapshots the "new" state synchronously right after this callback
        // returns. Without this, the photo's margin-top (which reads that var)
        // uses the stale, pre-detail-open header height for the whole
        // animation, so the "tucked behind the header" look only snaps in
        // once the transition ends and the real DOM/ResizeObserver catch up.
        if (headerEl) {
          document.documentElement.style.setProperty('--header-height', `${headerEl.offsetHeight}px`);
        }
        this._overlay.removeAttribute('hidden');
        this._renderContent(entry);
        this._overlay.classList.add('visible');
        if (this._backBtn) this._backBtn.removeAttribute('hidden');
        if (this._favBtn) { this._favBtn.removeAttribute('hidden'); this._syncFavBtn(); }
        window.scrollTo(0, 0);

        // Force a synchronous layout flush before naming the overlay, so its
        // flex-resolved size (siblings hidden via .detail-open above) is fully
        // settled at the exact moment the VT captures the "new" state geometry.
        void this._overlay.offsetHeight;
        this._overlay.style.viewTransitionName = 'classroom-detail-zoom';

        if (validPhotoUrl) {
          const detailImg = this._overlay.querySelector('.detail-photo');
          const detailContainer = this._overlay.querySelector('.detail-photo-container');
          if (detailImg) {
            detailImg.src = validPhotoUrl;
            detailImg.classList.add('loaded');
            detailContainer?.classList.add('loaded');
          }
        }

        this._loadSchedule(id);
        if (hasPhoto) this._loadPhoto(id);
      });

      const cleanup = () => {
        this._overlay.style.viewTransitionName = '';
        if (cardEl) cardEl.style.viewTransitionName = '';
        if (headerEl) headerEl.style.viewTransitionName = '';
        if (fromInfo) infoPage._cleanupReturnVT();
      };
      vt.finished.then(cleanup).catch(cleanup);
    } else {
      // Fallback: show overlay, swap tabbar for back button without animation
      if (fromInfo) {
        infoPage._applyReturnVT();
      } else {
        if (this._tabbar) this._tabbar.classList.add('detail-open');
      }
      document.body.classList.add('detail-open');
      this._overlay.removeAttribute('hidden');
      this._renderContent(entry);
      // Stamp cached photo immediately in the fallback path too
      if (validPhotoUrl) {
        const detailImg = this._overlay.querySelector('.detail-photo');
        const detailContainer = this._overlay.querySelector('.detail-photo-container');
        if (detailImg) {
          detailImg.src = validPhotoUrl;
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

  _doClose() {
    if (!this._overlay || this._overlay.hidden) return;

    this._currentId = null;

    const cardEl = this._openTrigger?.cardEl ?? null;
    const cardInDom = !!(cardEl && document.body.contains(cardEl));
    const headerEl = document.querySelector('.header');

    const cleanup = () => {
      this._overlay.innerHTML = '';
      this._openTrigger = null;
      this._queryContext = null;
      this._overlay.style.viewTransitionName = '';
      if (headerEl) headerEl.style.viewTransitionName = '';
      document.documentElement.classList.remove('header-vt-fixed');
      if (cardEl) {
        cardEl.style.viewTransitionName = '';
        cardEl.style.removeProperty('content-visibility');
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

      this._overlay.style.viewTransitionName = 'classroom-detail-zoom';

      const vt = document.startViewTransition(() => {
        // -- DOM changes (defines NEW state) --

        // Fully hide the overlay and back button
        document.body.classList.remove('detail-open');
        this._overlay.setAttribute('hidden', '');
        this._overlay.classList.remove('visible');
        if (this._backBtn) this._backBtn.setAttribute('hidden', '');
        if (this._favBtn) this._favBtn.setAttribute('hidden', '');
        this._overlay.style.viewTransitionName = '';
        if (headerEl) {
          document.documentElement.style.setProperty('--header-height', `${headerEl.offsetHeight}px`);
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

        // Force a synchronous layout flush before naming the card, so its
        // resolved position/size (list re-scrolled above) is fully settled at
        // the exact moment the VT captures the "new" state geometry.
        if (cardInDom) {
          void cardEl.offsetHeight;
          cardEl.style.viewTransitionName = 'classroom-detail-zoom';
        }
      });

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

  _renderContent({ classroom, building, campus }) {
    const featuresHtml = (classroom.features ?? [])
      .filter(f => FEATURE_ICONS[f.id])
      .map(({ id }) => {
        const { icon, key } = FEATURE_ICONS[id];
        return `
          <div class="detail-feature-chip" data-feature-id="${id}">
            <span class="material-symbols-outlined">${icon}</span>
            <span>${t(key)}</span>
          </div>`;
      })
      .join('');

    const status = getClassroomStatusNow(classroom.id);
    let statusHtml = '';
    if (status) {
      const statusKeys = {
        'free': 'status.free',
        'occupied': 'status.occupied',
        'free-soon': 'status.freeSoon',
        'occupied-soon': 'status.occupiedSoon'
      };
      statusHtml = `
        <div class="detail-status-wrapper">
          <span class="detail-status-label">${t('detail.currentStatus')}</span>
          <h4 class="classroom-status-txt ${status}">${t(statusKeys[status])}</h4>
        </div>`;
    }

    this._overlay.innerHTML = `
      ${classroom.idfoto ? `
        <div class="detail-photo-container">
          <img class="detail-photo" alt="">
          <div class="detail-photo-gradient"></div>
        </div>` : ''}
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
            <span class="material-symbols-outlined">groups</span>
            <span>${classroom.seats} ${t('detail.seats')}</span>
          </div>
          ${classroom.accessible_seats ? `
            <div class="detail-stat">
              <span class="material-symbols-outlined">accessible</span>
              <span>${classroom.accessible_seats} ${t('detail.disabledSeats')}</span>
            </div>
          ` : ''}
        </div>
      </div>
      <div class="detail-content">
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
                <span class="detail-schedule-legend-box"></span>
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
    `;

    // Title click -> manual refresh of photo and schedule
    this._overlay.querySelector('.detail-title')?.addEventListener('click', () => {
      haptics.trigger(defaultPatterns.light);
      this._loadSchedule(classroom.id);
      if (classroom.idfoto) this._loadPhoto(classroom.id);
    });

  }

  // ---------- RENDER: HERO PHOTO ----------

  async _loadPhoto(classroomId) {
    if (this._currentId !== classroomId) return;

    try {
      // Step 1: Resolve the photo URL (cached after first fetch; may also be pre-warmed by card thumbnails).
      const url = await fetchPhotoUrl(classroomId);

      if (this._currentId !== classroomId) return;

      // Ensure we have a container for the photo (it might have been removed on previous error)
      let container = this._overlay.querySelector('.detail-photo-container');
      if (!container) {
        const header = this._overlay.querySelector('.detail-header');
        if (header) {
          header.insertAdjacentHTML('beforebegin', '<div class="detail-photo-container"><img class="detail-photo" alt=""></div>');
          container = this._overlay.querySelector('.detail-photo-container');
        }
      }

      const img = container?.querySelector('.detail-photo');
      if (!img) return;

      // Already stamped by the ViewTransition (cached URL path) — nothing to do.
      if (img.classList.contains('loaded')) return;

      img.classList.remove('loaded');
      container.classList.remove('loaded');

      // Step 2: load and decode, then reveal.
      img.src = url;
      img.decode().then(() => {
        if (this._currentId !== classroomId) return;
        img.classList.add('loaded');
        container.classList.add('loaded');
      }).catch(() => {
        if (this._currentId === classroomId) container.remove();
      });
    } catch (err) {
      console.error('Classroom photo load error:', err);
      if (this._currentId !== classroomId) return;
      this._overlay.querySelector('.detail-photo-container')?.remove();
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

      const DAY_START = 7 * 60 + 15;
      const DAY_END = 20 * 60 + 15;
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
        outer: for (const c of dayData.campuses ?? []) {
          for (const b of c.buildings ?? []) {
            const room = b.classrooms?.find(r => String(r.id) === String(classroomId));
            if (room) { occupancy = room.occupancy ?? []; break outer; }
          }
        }

        const blocksHtml = (occupancy || []).map((slot, idx) => {
          if (!slot.inizio || !slot.fine) return '';
          const s = Math.max(timeToMinutes(slot.inizio), DAY_START);
          const e = Math.min(timeToMinutes(slot.fine), DAY_END);
          if (e <= s) return '';
          const left  = ((s - DAY_START) / total * 100).toFixed(2);
          const width = ((e - s)         / total * 100).toFixed(2);
          const slotIdx = scheduleSlots.push(slot) - 1;
          return `<div class="detail-schedule-block" data-slot-idx="${slotIdx}" tabindex="0" role="button" style="--block-start:${left}%;--block-size:${width}%;--idx:${idx}"></div>`;
        }).join('');

        const queryOverlayHtml = isQueryDay && queryFromPct !== null
          ? `<div class="detail-schedule-query-region" style="--qfrom:${queryFromPct}%;--qto:${queryToPct}%"></div>`
          : '';
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
              <div class="detail-schedule-bar">
                ${queryOverlayHtml}
                ${blocksHtml}
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
            <div class="detail-schedule-labels-pill">${labelsHtml}</div>
            <div class="detail-schedule-bars">
              <div class="detail-schedule-grid-lines">${gridLinesHtml}</div>
              ${rowsHtml}
            </div>
          </div>
        </div>
        <div id="detail-timeline-popover" class="popover timeline-occupation-popover" role="tooltip">
          <div class="arrow" data-arrow></div>
          <div class="timeline-popover-body"></div>
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

      let selectedDayIndex = 0;

      const daySelector = createPillSelector(pickerContainer, {
        onSelect(chip, { silent }) {
          const index = parseInt(chip.dataset.dayIndex);
          selectedDayIndex = index;
          rowEls.forEach((row, i) => row.classList.toggle('selected', i === index));
          if (!silent) {
            haptics.trigger(defaultPatterns.light);
            hideOccupationPopover();
          }
        },
      });
      daySelector.refresh();

      function selectScheduleDay(index, opts) {
        const chip = pickerContainer.querySelector(`[data-day-index="${index}"]`);
        if (chip) daySelector.selectElement(chip, opts);
      }

      // Auto-select: prefer the queried day when coming from the Available Tab,
      // otherwise today, or next available day if after 20:15, or first available
      const todayDayIndex = days.findIndex(d => d.dayData?.date === todayKey);
      const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
      let initialDayIndex;
      if (queryDateKey) {
        const queryDayIndex = days.findIndex(d => d.dayData?.date === queryDateKey);
        initialDayIndex = queryDayIndex >= 0 ? queryDayIndex : (todayDayIndex >= 0 ? todayDayIndex : days.findIndex(d => d.dayData !== null));
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
      mobileQuery.addEventListener('change', e => {
        if (e.matches) {
          daySelector.refresh();
          selectScheduleDay(selectedDayIndex, { silent: true, animate: false });
          positionDetailTodayIndicator();
        } else {
          positionDesktopTodayIndicator();
        }
      });

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

        cursor.textContent = minutesToTimeDisplay(minutes);
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
      const timelinePopoverEl = container.querySelector('#detail-timeline-popover');
      const timelinePopoverBody = timelinePopoverEl?.querySelector('.timeline-popover-body') ?? null;
      const timelinePopover = timelinePopoverEl ? new DynamicPopover(timelinePopoverEl, { placement: 'top' }) : null;

      const showOccupationPopover = (blockEl) => {
        if (!timelinePopover || !timelinePopoverBody) return;
        const slot = scheduleSlots[Number(blockEl.dataset.slotIdx)];
        if (!slot) return;
        timelinePopoverBody.innerHTML = buildOccupationPopoverHtml(slot);
        timelinePopover.show(blockEl);
      };
      const hideOccupationPopover = () => timelinePopover?.hide();

      if (timelinePopover) {
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

        // Keyboard focus (mirrors hover for accessibility)
        container.addEventListener('focusin', e => {
          const block = e.target.closest?.('.detail-schedule-block');
          if (block) showOccupationPopover(block);
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
          haptics.trigger(defaultPatterns.light);
          if (timelinePopover.trigger === block) hideOccupationPopover();
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
