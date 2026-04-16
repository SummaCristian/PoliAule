import { classroomsData as occupancyData, SKIP_DAYS, getClassroomStatusNow } from '../available-rooms-script.js';
import { t, getLocale, onLanguageSwitch } from '../i18n.js';
import { haptics, defaultPatterns } from './haptics.js';
import { createTimeFormatter } from '../utils/time-format.js';

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

// Mirror the campus naming logic from campus-picker.js / search-classrooms-script.js
const CITTA_STUDI_IDS = new Set(['MIA01', 'MIA06']);
const BOVISA_IDS = new Set(['MIB01', 'MIB02']);
const CITTA_STUDI_NAMES = { MIA01: 'Leonardo', MIA06: 'Colombo' };

function getCampusDisplayName(campus) {
  if (CITTA_STUDI_IDS.has(campus.id)) return CITTA_STUDI_NAMES[campus.id] ?? campus.name;
  if (BOVISA_IDS.has(campus.id))
    return (campus.name.split(' - ')[1] ?? campus.name).replace(/^Via\s+/i, '');
  return campus.name;
}

function timeToMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

const HASH_PATTERN = /^#classroom\/(\d+)$/;

// ---------- CLASS ----------

const PHOTO_API = 'https://onlineservices.polimi.it/maps_rest/rest/syncro/rooms/foto';

class ClassroomDetail {
  constructor() {
    this._overlay = null;
    this._tabbar = null;
    this._backBtn = null;
    this._staticData = null;       // classrooms.json hierarchy
    this._flatIndex = null;       // Map<id, { classroom, building, campus }>
    this._pendingTrigger = null;   // { nameEl } stored by click handler before hashchange fires
    this._openTrigger = null;   // same, kept for reverse morph on close
    this._openedViaPushState = false;
    this._currentId = null;
    this._savedScrollPos = 0;
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

      this._pendingTrigger = { nameEl, statusEl };
      this._openedViaPushState = true;
      location.hash = '#classroom/' + id;
    });

    // Handle hash that's already in the URL on page load (hashchange doesn't fire on load)
    const match = location.hash.match(HASH_PATTERN);
    if (match) {
      this._openedViaPushState = false;
      this._doOpen(parseInt(match[1]), null);
    }
  }

  // ---------- HASH ROUTING ----------

  _onHashChange() {
    const match = location.hash.match(HASH_PATTERN);
    if (match) {
      const id = parseInt(match[1]);
      const pending = this._pendingTrigger;
      this._pendingTrigger = null;
      this._doOpen(id, pending);
    } else if (this._currentId !== null) {
      this._doClose();
    }
  }

  // ---------- OPEN ----------

  _doOpen(id, pending) {
    if (!this._overlay) return;
    this._buildFlatIndex();

    const entry = this._flatIndex?.get(id);
    if (!entry) return;

    this._currentId = id;
    this._openTrigger = pending ?? null;

    // Save scroll position for when we return
    this._savedScrollPos = window.scrollY;

    const nameEl = pending?.nameEl ?? null;
    const statusEl = pending?.statusEl ?? null;

    if (document.startViewTransition && this._tabbar) {
      // -- OLD state setup (before VT snapshot) --
      // Tabbar morphs into the back button (both live in the header, so it's a clean in-place swap)
      this._tabbar.style.viewTransitionName = 'classroom-nav';
      // Room name morphs into the overlay title
      if (nameEl) nameEl.style.viewTransitionName = 'classroom-detail-name';
      if (statusEl) statusEl.style.viewTransitionName = 'classroom-status';

      const vt = document.startViewTransition(() => {
        // -- DOM changes (defines NEW state) --
        this._tabbar.style.viewTransitionName = '';
        this._tabbar.classList.add('detail-open');
        if (nameEl) nameEl.style.viewTransitionName = '';
        if (statusEl) statusEl.style.viewTransitionName = '';

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
        if (this._backBtn) this._backBtn.style.viewTransitionName = 'classroom-nav';
        if (titleEl) titleEl.style.viewTransitionName = 'classroom-detail-name';
        if (detailStatusEl) detailStatusEl.style.viewTransitionName = 'classroom-status';

        // Load data immediately after rendering in the transition callback
        this._loadSchedule(id);
        if (entry.classroom.idfoto) this._loadPhoto(id, entry.classroom.idfoto);
      });

      vt.finished.then(() => {
        // Clean up — VT names must be cleared after the animation
        this._tabbar.style.viewTransitionName = '';
        if (nameEl) nameEl.style.viewTransitionName = '';
        if (statusEl) statusEl.style.viewTransitionName = '';
        if (this._backBtn) this._backBtn.style.viewTransitionName = '';
        this._overlay.querySelector('.detail-title')
          ?.style.setProperty('view-transition-name', '');
        this._overlay.querySelector('.detail-title-row .classroom-status-txt')
          ?.style.setProperty('view-transition-name', '');
      }).catch(() => {
        this._tabbar.style.viewTransitionName = '';
        if (nameEl) nameEl.style.viewTransitionName = '';
        if (statusEl) statusEl.style.viewTransitionName = '';
        if (this._backBtn) this._backBtn.style.viewTransitionName = '';
      });
    } else {
      // Fallback: show overlay, swap tabbar for back button without animation
      document.body.classList.add('detail-open');
      this._overlay.removeAttribute('hidden');
      this._renderContent(entry);
      if (this._tabbar) this._tabbar.classList.add('detail-open');
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

    const cleanup = () => {
      this._overlay.innerHTML = '';
      this._openTrigger = null;
      if (nameEl) nameEl.style.viewTransitionName = '';
      if (statusEl) statusEl.style.viewTransitionName = '';
      if (this._tabbar) this._tabbar.style.viewTransitionName = '';
      if (this._backBtn) this._backBtn.style.viewTransitionName = '';
    };

    if (document.startViewTransition && this._tabbar) {
      // -- OLD state setup --
      // Back button (in header) is the source; tabbar is the destination
      if (this._backBtn) this._backBtn.style.viewTransitionName = 'classroom-nav';
      if (titleEl && nameInDom) titleEl.style.viewTransitionName = 'classroom-detail-name';
      if (detailStatusEl && statusInDom) detailStatusEl.style.viewTransitionName = 'classroom-status';

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
    for (const campus of (this._staticData ?? [])) {
      for (const building of campus.buildings) {
        for (const classroom of building.classrooms) {
          this._flatIndex.set(classroom.id, { classroom, building, campus });
        }
      }
    }
  }

  // ---------- RENDER: STATIC CONTENT ----------

  _renderContent({ classroom, building, campus }) {
    const featuresHtml = (classroom.features ?? [])
      .filter(f => FEATURE_ICONS[f.id])
      .map(({ id }) => {
        const { icon, key } = FEATURE_ICONS[id];
        return `
          <div class="detail-feature-chip">
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
          <h1 class="detail-title" role="button" tabindex="0">${classroom.name}</h1>
          ${statusHtml}
        </div>
        <p class="detail-subtitle secondary">
          ${t('building.prefix')} ${building.altName ? `${building.altName} (${building.name})` : building.name} &middot; ${getCampusDisplayName(campus)}
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
      const desktopQuery = window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 600px)');

      photoContainer.addEventListener('mousemove', (e) => {
        if (!desktopQuery.matches) return;
        const rect = photoContainer.getBoundingClientRect();
        const dx = (e.clientX - rect.left - rect.width  / 2) / (rect.width  / 2);
        const dy = (e.clientY - rect.top  - rect.height / 2) / (rect.height / 2);
        const tiltX = -dy * 5;
        const tiltY =  dx * 5;
        photoContainer.style.transition = 'transform 0.08s ease-out, box-shadow 0.08s ease-out';
        photoContainer.style.transform  = `perspective(900px) rotateX(${tiltX}deg) rotateY(${tiltY}deg) scale(1.02)`;
        photoContainer.style.boxShadow  = '0 24px 64px rgba(0,0,0,0.28)';
      });

      photoContainer.addEventListener('mouseleave', () => {
        photoContainer.style.transition = 'transform 0.6s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.6s ease';
        photoContainer.style.transform  = '';
        photoContainer.style.boxShadow  = '';
      });

      desktopQuery.addEventListener('change', (e) => {
        if (!e.matches) {
          photoContainer.style.transition = '';
          photoContainer.style.transform  = '';
          photoContainer.style.boxShadow  = '';
        }
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

      // Step 2: Assign to img.src. 
      // We use the tag directly to avoid CORS fetch issues while still 
      // triggering the browser's network request for the image.
      img.onload = () => {
        img.classList.add('loaded');
        container.classList.add('loaded');
      };
      img.onerror = () => {
        // If it fails (e.g. cookie error), we remove the container so it's clean,
        // but it can be recreated by a future _loadPhoto call (like a refresh).
        if (this._currentId === classroomId) container.remove();
      };

      img.src = url;
    } catch (err) {
      console.error('Classroom photo load error:', err);
      if (this._currentId !== classroomId) return;
      this._overlay.querySelector('.detail-photo-container')?.remove();
    }
  }

  // ---------- RENDER: WEEKLY SCHEDULE ----------

  _loadSchedule(classroomId) {
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

      const _dayParts = days.map(({ dayData, date }) => {
        const isSunday = !dayData;

        const dayNum    = date.getDate();
        const narrowDay = date.toLocaleDateString(getLocale(), { weekday: 'narrow' });
        const narrowDayName = narrowDay.charAt(0).toUpperCase() + narrowDay.slice(1);
        const isToday = !isSunday && dayData.date === todayKey;

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

        const blocksHtml = (occupancy || []).map(slot => {
          if (!slot.inizio || !slot.fine) return '';
          const s = Math.max(timeToMinutes(slot.inizio), DAY_START);
          const e = Math.min(timeToMinutes(slot.fine), DAY_END);
          if (e <= s) return '';
          const left  = ((s - DAY_START) / total * 100).toFixed(2);
          const width = ((e - s)         / total * 100).toFixed(2);
          return `<div class="detail-schedule-block" style="--block-start:${left}%;--block-size:${width}%"></div>`;
        }).join('');

        return { labelHtml, rowHtml: `
          <div class="detail-schedule-row${isToday ? ' detail-schedule-row--today' : ''}">
            <div class="detail-schedule-bar-wrapper">
              <div class="timeline-hover-cursor" hidden></div>
              ${isToday && nowPct !== null ? `<div class="timeline-time-indicator timeline-time-indicator--now" style="--pos:${nowPct}%">${t('timepicker.now')}</div>` : ''}
              <div class="detail-schedule-bar">
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
          <div class="detail-schedule-ticks">${ticksHtml}${nowTickHtml}</div>
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

      // Auto-select today, or first available day if today has no data
      const todayDayIndex = days.findIndex(d => d.dayData?.date === todayKey);
      const initialDayIndex = todayDayIndex >= 0
        ? todayDayIndex
        : days.findIndex(d => d.dayData !== null);
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
