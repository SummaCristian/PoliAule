import { classroomsData as occupancyData, SKIP_DAYS } from '../available-rooms-script.js';
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

      const id = parseInt(trigger.dataset.openClassroom);

      // Name element that will morph into the overlay title
      const card = trigger.closest('.classroom-card') ?? trigger;
      const nameEl = card.querySelector('.classroom-name, .search-card-name') ?? null;

      this._pendingTrigger = { nameEl };
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

    if (document.startViewTransition && this._tabbar) {
      // -- OLD state setup (before VT snapshot) --
      // Tabbar morphs into the back button (both live in the header, so it's a clean in-place swap)
      this._tabbar.style.viewTransitionName = 'classroom-nav';
      // Room name morphs into the overlay title
      if (nameEl) nameEl.style.viewTransitionName = 'classroom-detail-name';

      const vt = document.startViewTransition(() => {
        // -- DOM changes (defines NEW state) --
        this._tabbar.style.viewTransitionName = '';
        this._tabbar.classList.add('detail-open');
        if (nameEl) nameEl.style.viewTransitionName = '';

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
        if (this._backBtn) this._backBtn.style.viewTransitionName = 'classroom-nav';
        if (titleEl) titleEl.style.viewTransitionName = 'classroom-detail-name';

        // Load data immediately after rendering in the transition callback
        this._loadSchedule(id);
        if (entry.classroom.idfoto) this._loadPhoto(id, entry.classroom.idfoto);
      });

      vt.finished.then(() => {
        // Clean up — VT names must be cleared after the animation
        this._tabbar.style.viewTransitionName = '';
        if (nameEl) nameEl.style.viewTransitionName = '';
        if (this._backBtn) this._backBtn.style.viewTransitionName = '';
        this._overlay.querySelector('.detail-title')
          ?.style.setProperty('view-transition-name', '');
      }).catch(() => {
        this._tabbar.style.viewTransitionName = '';
        if (nameEl) nameEl.style.viewTransitionName = '';
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
    const titleEl = this._overlay.querySelector('.detail-title');
    const nameInDom = nameEl && document.body.contains(nameEl);

    const cleanup = () => {
      this._overlay.innerHTML = '';
      this._openTrigger = null;
      if (nameEl) nameEl.style.viewTransitionName = '';
      if (this._tabbar) this._tabbar.style.viewTransitionName = '';
      if (this._backBtn) this._backBtn.style.viewTransitionName = '';
    };

    if (document.startViewTransition && this._tabbar) {
      // -- OLD state setup --
      // Back button (in header) is the source; tabbar is the destination
      if (this._backBtn) this._backBtn.style.viewTransitionName = 'classroom-nav';
      if (titleEl && nameInDom) titleEl.style.viewTransitionName = 'classroom-detail-name';

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

    this._overlay.innerHTML = `
      ${classroom.idfoto ? `
        <div class="detail-photo-container">
          <img class="detail-photo" alt="">
          <div class="detail-photo-gradient"></div>
        </div>` : ''}
      <div class="detail-header">
        <h1 class="detail-title" role="button" tabindex="0">${classroom.name}</h1>
        <p class="detail-subtitle secondary">
          ${t('building.prefix')} ${building.name} &middot; ${getCampusDisplayName(campus)}
        </p>
        <div class="detail-stats">
          <div class="detail-stat">
            <span class="material-symbols-outlined">groups</span>
            <span>${classroom.capienza} ${t('detail.seats')}</span>
          </div>
          ${classroom.posti_disabili ? `
            <div class="detail-stat">
              <span class="material-symbols-outlined">accessible</span>
              <span>${classroom.posti_disabili} ${t('detail.disabledSeats')}</span>
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
          <h2 class="detail-section-title">${t('detail.weeklySchedule')}</h2>
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

      const DAY_START = 8 * 60 + 15;
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

      const rowsHtml = days.map(({ dayData, date }) => {
        const isSunday = !dayData;

        const raw       = date.toLocaleDateString(getLocale(), { weekday: 'short' });
        const dayName   = raw.charAt(0).toUpperCase() + raw.slice(1);
        const dayNum    = date.getDate();
        const monthName = date.toLocaleDateString(getLocale(), { month: 'short' });

        if (isSunday) {
          return `
            <div class="detail-schedule-row detail-schedule-row--sunday">
              <div class="detail-schedule-label">
                <span class="detail-schedule-day">${dayName}</span>
                <span class="detail-schedule-date secondary">${dayNum} ${monthName}</span>
              </div>
              <div class="detail-schedule-bar-wrapper">
                <div class="detail-schedule-bar"></div>
              </div>
            </div>`;
        }

        let occupancy = [];
        outer: for (const c of dayData.campuses ?? []) {
          for (const b of c.buildings ?? []) {
            const room = b.classrooms?.find(r => String(r.id) === String(classroomId));
            if (room) { occupancy = room.occupancy ?? []; break outer; }
          }
        }

        const isToday   = dayData.date === todayKey;
        const blocksHtml = (occupancy || []).map(slot => {
          if (!slot.inizio || !slot.fine) return '';
          const s = Math.max(timeToMinutes(slot.inizio), DAY_START);
          const e = Math.min(timeToMinutes(slot.fine), DAY_END);
          if (e <= s) return '';
          const left  = ((s - DAY_START) / total * 100).toFixed(2);
          const width = ((e - s)         / total * 100).toFixed(2);
          return `<div class="detail-schedule-block" style="left:${left}%;width:${width}%"></div>`;
        }).join('');

        return `
          <div class="detail-schedule-row${isToday ? ' detail-schedule-row--today' : ''}">
            <div class="detail-schedule-label">
              <span class="detail-schedule-day">${dayName}</span>
              <span class="detail-schedule-date secondary">${dayNum} ${monthName}</span>
            </div>
            <div class="detail-schedule-bar-wrapper">
              <div class="timeline-hover-cursor" hidden></div>
              <div class="detail-schedule-bar">
                ${blocksHtml}
                <div class="timeline-hover-line" hidden></div>
              </div>
            </div>
          </div>`;
      }).join('');

      if (!rowsHtml) {
        console.warn('ClassroomDetail: No room matches found in any day of occupancy data');
        container.innerHTML = `<p class="secondary">${t('detail.noData')}</p>`;
        return;
      }

      const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
      const nowTickHtml = nowMin >= DAY_START && nowMin <= DAY_END
        ? `<div class="timeline-time-indicator timeline-time-indicator--now" style="left:${((nowMin - DAY_START) / total * 100).toFixed(2)}%">${t('timepicker.now')}</div>`
        : '';

      const ticksHtml = (() => {
        const ticks = [];
        for (let m = DAY_START; m <= DAY_END; m += 60) {
          const left = ((m - DAY_START) / total * 100).toFixed(2);
          ticks.push(`<div class="detail-schedule-tick" style="left:${left}%"><span>${minutesToTimeDisplay(m)}</span></div>`);
        }
        return ticks.join('');
      })();

      container.innerHTML = `
        <div class="detail-schedule-ticks">${ticksHtml}${nowTickHtml}</div>
        <div class="detail-schedule-grid">${rowsHtml}</div>
      `;

      if (localStorage.getItem('poliAule_hideSundays') === 'true') {
        container.classList.add('detail-schedule--hide-sundays');
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
        const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const minutes = Math.round(DAY_START + fraction * total);
        const pct = `${(fraction * 100).toFixed(2)}%`;

        cursor.style.left = pct;
        cursor.textContent = minutesToTimeDisplay(minutes);
        cursor.hidden = false;

        line.style.left = pct;
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
