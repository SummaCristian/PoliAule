import { classroomsData as occupancyData, SKIP_DAYS, getClassroomStatusNow } from '../available-rooms-script.js';
import { t, getLocale, onLanguageSwitch } from '../i18n.js';
import { haptics, defaultPatterns } from './haptics.js';
import { createTimeFormatter } from '../utils/time-format.js';
import { escapeHtml } from '../utils/html.js';
import { infoPage } from './info-page.js';

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

const HASH_PATTERN    = /^#classroom\/([^\/]+)\/(.+)$/;
const HASH_PATTERN_V1 = /^#classroom\/(\d+)$/;

// ---------- CLASS ----------

const PHOTO_API = 'https://onlineservices.polimi.it/maps_rest/rest/syncro/rooms/foto';

class ClassroomDetail {
  constructor() {
    this._overlay = null;
    this._tabbar = null;
    this._backBtn = null;
    this._staticData = null;       // classrooms.json hierarchy
    this._flatIndex = null;       // Map<id, { classroom, building, campus }>
    this._slugIndex = null;       // Map<"campus-slug\x00name", { classroom, building, campus }>
    this._pendingTrigger = null;   // { nameEl } stored by click handler before hashchange fires
    this._openTrigger = null;   // same, kept for reverse morph on close
    this._openedViaPushState = false;
    this._currentId = null;
    this._savedScrollPos = 0;
    this._openAnimationFinished = Promise.resolve(); // resolves when the page-open animation ends
    this._queryContext = null;  // { date, from, to } when opened from Available Tab, else null
    this._nowTimer = null;
  }

  // Called from script.js after all data is loaded.
  init(staticData) {
    this._staticData = staticData;
    this._overlay = document.getElementById('classroom-detail-overlay');
    this._tabbar = document.querySelector('.tabbar');
    this._backBtn = document.getElementById('detail-back-btn');

    this._backBtn?.addEventListener('click', () => {
      haptics.trigger(defaultPatterns.success);
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
      if (entry.classroom.idfoto) this._loadPhoto(this._currentId, entry.classroom.idfoto);
      window.scrollTo(0, scrollY);
    });

    window.addEventListener('timeformatchange', () => {
      if (this._currentId === null) return;
      const scrollY = window.scrollY;
      this._loadSchedule(this._currentId);
      window.scrollTo(0, scrollY);
    });

    // Click delegation — handles both available-tab info buttons and search-tab cards
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-open-classroom]');
      if (!trigger) return;
      e.stopPropagation();
      haptics.trigger(defaultPatterns.success);

      const id = parseInt(trigger.dataset.openClassroom);

      // Name and status elements that will morph into the overlay
      const card = trigger.closest('.classroom-card, .search-card--classroom') ?? trigger;
      const nameEl = card.querySelector('.classroom-name, .search-card-name') ?? null;
      const statusEl = card.querySelector('.classroom-status-txt') ?? null;

      const queryDate = card.dataset.queryDate ?? null;
      const queryFrom = card.dataset.queryFrom ?? null;
      const queryTo   = card.dataset.queryTo   ?? null;
      const queryContext = queryDate && queryFrom && queryTo
        ? { date: queryDate, from: queryFrom, to: queryTo }
        : null;

      const featureIconEls = [...card.querySelectorAll('[data-feature-id]')];

      this._pendingTrigger = { nameEl, statusEl, queryContext, featureIconEls };
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

  _doOpen(id, pending) {
    if (!this._overlay) return;
    this._buildFlatIndex();

    const entry = this._flatIndex?.get(id);
    if (!entry) return;

    this._currentId = id;
    this._openTrigger = pending ?? null;
    this._queryContext = pending?.queryContext ?? null;

    // Save scroll position for when we return
    this._savedScrollPos = window.scrollY;

    const nameEl = pending?.nameEl ?? null;
    const statusEl = pending?.statusEl ?? null;
    // When returning from info page, tabbar is already hidden and backBtn already visible —
    // skip the classroom-nav morph (same pattern as infoPage's fromDetail detection).
    const fromInfo = !!(this._backBtn && !this._backBtn.hidden);

    if (document.startViewTransition && this._tabbar) {
      // -- OLD state setup (before VT snapshot) --
      if (fromInfo) {
        // Info overlay is still visible — name its hero elements so they morph into the header.
        infoPage._prepareReturnVT();
      } else {
        // Tabbar morphs into the back button (both live in the header, so it's a clean in-place swap)
        this._tabbar.style.viewTransitionName = 'classroom-nav';
      }
      // Room name morphs into the overlay title
      if (nameEl) nameEl.style.viewTransitionName = 'classroom-detail-name';
      if (statusEl) statusEl.style.viewTransitionName = 'classroom-status';
      // Feature icons morph into the detail feature chips
      const featureIconEls = pending?.featureIconEls ?? [];
      for (const el of featureIconEls) {
        el.style.viewTransitionName = `classroom-feature-${el.dataset.featureId}`;
      }

      const vt = document.startViewTransition(() => {
        // -- DOM changes (defines NEW state) --
        if (fromInfo) {
          // Close info overlay and name header elements as NEW state morph targets.
          infoPage._applyReturnVT();
        } else {
          this._tabbar.style.viewTransitionName = '';
          this._tabbar.classList.add('detail-open');
        }
        if (nameEl) nameEl.style.viewTransitionName = '';
        if (statusEl) statusEl.style.viewTransitionName = '';
        for (const el of featureIconEls) el.style.viewTransitionName = '';

        // Show overlay and back button
        document.body.classList.add('detail-open');
        this._overlay.removeAttribute('hidden');
        this._renderContent(entry);
        this._overlay.classList.add('visible');
        if (this._backBtn) this._backBtn.removeAttribute('hidden');

        // Reset scroll for the new view
        window.scrollTo(0, 0);

        // Back button in the header is the NEW state destination for classroom-nav
        const titleEl = this._overlay.querySelector('.detail-title');
        const detailStatusEl = this._overlay.querySelector('.detail-title-row .classroom-status-txt');
        if (!fromInfo && this._backBtn) this._backBtn.style.viewTransitionName = 'classroom-nav';
        if (titleEl) titleEl.style.viewTransitionName = 'classroom-detail-name';
        if (detailStatusEl) detailStatusEl.style.viewTransitionName = 'classroom-status';
        // Morph icon → icon inside chip (same size both ends → clean positional move)
        this._overlay.querySelectorAll('.detail-feature-chip[data-feature-id]').forEach(chip => {
          const iconEl = chip.querySelector('.material-symbols-outlined');
          if (iconEl) iconEl.style.viewTransitionName = `classroom-feature-${chip.dataset.featureId}`;
        });

        // Load data immediately after rendering in the transition callback
        this._loadSchedule(id);
        if (entry.classroom.idfoto) this._loadPhoto(id, entry.classroom.idfoto);
      });

      // Store the VT promise so _loadPhoto can wait for the animation to finish
      // before revealing the image. If the image is cached and decodes instantly,
      // starting its reveal while the VT overlay is still active causes a flicker
      // when the VT tears down its pseudo-elements.
      this._openAnimationFinished = vt.finished.catch(() => {});

      const cleanup = () => {
        this._tabbar.style.viewTransitionName = '';
        if (nameEl) nameEl.style.viewTransitionName = '';
        if (statusEl) statusEl.style.viewTransitionName = '';
        if (this._backBtn) this._backBtn.style.viewTransitionName = '';
        this._overlay.querySelector('.detail-title')
          ?.style.setProperty('view-transition-name', '');
        this._overlay.querySelector('.detail-title-row .classroom-status-txt')
          ?.style.setProperty('view-transition-name', '');
        this._overlay.querySelectorAll('.detail-feature-chip[data-feature-id] .material-symbols-outlined').forEach(el => {
          el.style.viewTransitionName = '';
        });
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
      if (this._backBtn) this._backBtn.removeAttribute('hidden');
      requestAnimationFrame(() => {
        this._overlay.classList.add('visible');
        window.scrollTo(0, 0);
      });

      // Load data immediately after rendering in the fallback branch
      this._loadSchedule(id);
      if (entry.classroom.idfoto) this._loadPhoto(id, entry.classroom.idfoto);
    }
  }

  // ---------- CLOSE ----------

  _doClose() {
    if (!this._overlay || this._overlay.hidden) return;

    this._currentId = null;

    const nameEl = this._openTrigger?.nameEl ?? null;
    const statusEl = this._openTrigger?.statusEl ?? null;
    const titleEl = this._overlay.querySelector('.detail-title');
    const detailStatusEl = this._overlay.querySelector('.detail-title-row .classroom-status-txt');
    const nameInDom = nameEl && document.body.contains(nameEl);
    const statusInDom = statusEl && document.body.contains(statusEl);
    const featureIconEls = (this._openTrigger?.featureIconEls ?? [])
      .filter(el => document.body.contains(el));

    const cleanup = () => {
      this._overlay.innerHTML = '';
      this._openTrigger = null;
      this._queryContext = null;
      if (nameEl) nameEl.style.viewTransitionName = '';
      if (statusEl) statusEl.style.viewTransitionName = '';
      if (this._tabbar) this._tabbar.style.viewTransitionName = '';
      if (this._backBtn) this._backBtn.style.viewTransitionName = '';
      for (const el of featureIconEls) el.style.viewTransitionName = '';
    };

    if (document.startViewTransition && this._tabbar) {
      // -- OLD state setup --
      // Back button (in header) is the source; tabbar is the destination
      if (this._backBtn) this._backBtn.style.viewTransitionName = 'classroom-nav';
      if (titleEl && nameInDom) titleEl.style.viewTransitionName = 'classroom-detail-name';
      if (detailStatusEl && statusInDom) detailStatusEl.style.viewTransitionName = 'classroom-status';
      // Chip icons are the OLD state sources
      this._overlay.querySelectorAll('.detail-feature-chip[data-feature-id] .material-symbols-outlined').forEach(el => {
        const fid = el.closest('[data-feature-id]').dataset.featureId;
        el.style.viewTransitionName = `classroom-feature-${fid}`;
      });

      const vt = document.startViewTransition(() => {
        // -- DOM changes (defines NEW state) --

        // Fully hide the overlay and back button
        document.body.classList.remove('detail-open');
        this._overlay.setAttribute('hidden', '');
        this._overlay.classList.remove('visible');
        if (this._backBtn) this._backBtn.setAttribute('hidden', '');
        if (this._backBtn) this._backBtn.style.viewTransitionName = '';

        // Restore and name the tabbar as the NEW state destination for classroom-nav
        this._tabbar.classList.remove('detail-open');
        this._tabbar.style.viewTransitionName = 'classroom-nav';

        // Room name morphs back too
        if (nameInDom) nameEl.style.viewTransitionName = 'classroom-detail-name';
        if (statusInDom) statusEl.style.viewTransitionName = 'classroom-status';
        // Card icons are the NEW state destinations
        for (const el of featureIconEls) {
          el.style.viewTransitionName = `classroom-feature-${el.dataset.featureId}`;
        }

        // Restore scroll position so VT can morph back to the correct spot
        window.scrollTo(0, this._savedScrollPos);
      });

      vt.finished.then(cleanup).catch(cleanup);
    } else {
      // Fallback: fade out overlay, swap back button for tabbar without animation
      this._overlay.classList.remove('visible');
      if (this._tabbar) this._tabbar.classList.remove('detail-open');
      if (this._backBtn) this._backBtn.setAttribute('hidden', '');
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
      haptics.trigger(defaultPatterns.success);
      this._loadSchedule(classroom.id);
      if (classroom.idfoto) this._loadPhoto(classroom.id, classroom.idfoto);
    });

    // 3D tilt on desktop photo
    const photoContainer = this._overlay.querySelector('.detail-photo-container');
    if (photoContainer) {
      const wideEnough = window.matchMedia('(min-width: 600px)');

      photoContainer.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse' || !wideEnough.matches) return;
        const rect = photoContainer.getBoundingClientRect();
        const dx = (e.clientX - rect.left - rect.width  / 2) / (rect.width  / 2);
        const dy = (e.clientY - rect.top  - rect.height / 2) / (rect.height / 2);
        const tiltX = -dy * 5;
        const tiltY =  dx * 5;
        photoContainer.style.transition = 'transform 0.08s ease-out, box-shadow 0.08s ease-out';
        photoContainer.style.transform  = `perspective(900px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale(1.02)`;
        photoContainer.style.boxShadow  = '0 24px 64px rgba(0,0,0,0.28)';
      });

      photoContainer.addEventListener('pointerleave', (e) => {
        if (e.pointerType !== 'mouse') return;
        photoContainer.style.transition = 'transform 0.6s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.6s ease';
        photoContainer.style.transform  = '';
        photoContainer.style.boxShadow  = '';
      });
    }
  }

  // ---------- RENDER: HERO PHOTO ----------

  async _loadPhoto(classroomId, idfoto) {
    if (this._currentId !== classroomId) return;

    try {
      // Step 1: Fetch the fresh URL.
      // The polimi API establishes a session/cookie here required for step 2.
      const resp = await fetch(`${PHOTO_API}/${idfoto}`, { credentials: 'omit' });
      if (!resp.ok) throw new Error(`URL fetch failed: ${resp.status}`);
      const text = await resp.text();
      const url = text.match(/https?:\/\/\S+/)?.[0];
      if (!url) throw new Error('No URL in response');

      // Guard against a compromised API returning a URL pointing to an arbitrary server.
      // The browser would otherwise silently GET that URL, leaking the user's IP/fingerprint.
      const parsedUrl = new URL(url);
      if (parsedUrl.hostname !== 'docmanager.polimi.it' || parsedUrl.protocol !== 'https:') {
        throw new Error(`Untrusted photo URL: ${parsedUrl.hostname}`);
      }

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

      // Reset state for new attempt
      img.classList.remove('loaded');
      container.classList.remove('loaded');

      // Step 2: Assign to img.src, then wait for BOTH:
      //   a) full image decode (so the bitmap is ready before the transition starts)
      //   b) the page-open animation to finish (so a cached/fast image doesn't start
      //      its reveal while the VT overlay is still active — that interaction causes
      //      a flicker in Safari iOS when the VT tears down its pseudo-elements)
      img.src = url;
      Promise.all([
        img.decode().catch(() => 'error'),
        this._openAnimationFinished,
      ]).then(([decodeResult]) => {
        if (decodeResult === 'error') {
          if (this._currentId === classroomId) container.remove();
          return;
        }
        if (this._currentId !== classroomId) return;
        img.classList.add('loaded');
        container.classList.add('loaded');
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
          return `<div class="detail-schedule-block" style="--block-start:${left}%;--block-size:${width}%;--idx:${idx}"></div>`;
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
            <div class="date-indicator"></div>
            ${selectorItemsHtml}
          </div>
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

      // --- Mobile day selector interaction ---
      const pickerContainer = container.querySelector('.detail-schedule-picker');
      const indicatorEl = pickerContainer.querySelector('.date-indicator');
      const todayIndicatorEl = container.querySelector('.detail-today-indicator');
      const gridEl = container.querySelector('.detail-schedule-bars');
      const rowEls = gridEl.querySelectorAll('.detail-schedule-row');

      function placeSelectorIndicator(chipEl) {
        const paddingLeft = parseFloat(getComputedStyle(pickerContainer).paddingLeft);
        const x = chipEl.offsetLeft - paddingLeft;
        indicatorEl.style.setProperty('--indicator-x', `${x}px`);
        indicatorEl.style.width = `${chipEl.offsetWidth}px`;
        indicatorEl.style.height = `${chipEl.offsetHeight}px`;
        indicatorEl.style.transform = `translateX(${x}px)`;
        indicatorEl.style.opacity = '1';
      }

      let selectedDayIndex = 0;

      function selectScheduleDay(index) {
        selectedDayIndex = index;
        pickerContainer.querySelectorAll('.date-element-container').forEach(c => c.classList.remove('active'));
        const chip = pickerContainer.querySelector(`[data-day-index="${index}"]`);
        if (chip) {
          chip.classList.add('active');
          placeSelectorIndicator(chip);
        }
        rowEls.forEach((row, i) => row.classList.toggle('selected', i === index));
      }

      pickerContainer.querySelectorAll('.date-element-container').forEach(chip => {
        chip.addEventListener('click', () => {
          if (chip.classList.contains('date-skipped')) {
            indicatorEl.classList.remove('shake');
            void indicatorEl.offsetWidth; // force reflow to restart animation
            indicatorEl.classList.add('shake');
            indicatorEl.addEventListener('animationend', () => indicatorEl.classList.remove('shake'), { once: true });
            haptics.trigger(defaultPatterns.error);
            return;
          }
          haptics.trigger(defaultPatterns.success);
          selectScheduleDay(parseInt(chip.dataset.dayIndex));
        });
      });

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
      selectScheduleDay(Math.max(0, initialDayIndex));

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
        if (todayDayIndex >= 0) {
          haptics.trigger(defaultPatterns.success);
          selectScheduleDay(todayDayIndex);
        }
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
          selectScheduleDay(selectedDayIndex);
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
    } catch (err) {
      console.error('ClassroomDetail: Error rendering schedule:', err);
      container.innerHTML = `<p class="secondary">${t('detail.noData')}</p>`;
    }
  }
}

export const classroomDetail = new ClassroomDetail();
