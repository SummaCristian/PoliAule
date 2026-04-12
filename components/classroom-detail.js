import { classroomsData as occupancyData } from '../available-rooms-script.js';
import { t } from '../i18n.js';

// ---------- CONSTANTS ----------

const FEATURE_ICONS = {
  4:   { icon: 'videocam',            key: 'features.videoProjector' },
  5:   { icon: 'mic',                 key: 'features.radioMic' },
  6:   { icon: 'blinds',              key: 'features.dimmable' },
  7:   { icon: 'cable',               key: 'features.wiredDesk' },
  142: { icon: 'electrical_services', key: 'features.powerOutlets' },
  223: { icon: 'video_call',          key: 'features.videoconf' },
};

// Mirror the campus naming logic from campus-picker.js / search-classrooms-script.js
const CITTA_STUDI_IDS   = new Set(['MIA01', 'MIA06']);
const BOVISA_IDS        = new Set(['MIB01', 'MIB02']);
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

class ClassroomDetail {
  constructor() {
    this._overlay  = null;
    this._tabbar   = null;
    this._staticData = null;       // classrooms.json hierarchy
    this._flatIndex  = null;       // Map<id, { classroom, building, campus }>
    this._pendingTrigger = null;   // { nameEl } stored by click handler before hashchange fires
    this._openTrigger    = null;   // same, kept for reverse morph on close
    this._openedViaPushState = false;
    this._currentId = null;
  }

  // Called from script.js after all data is loaded.
  init(staticData) {
    this._staticData = staticData;
    this._overlay = document.getElementById('classroom-detail-overlay');
    this._tabbar  = document.querySelector('.tabbar');

    window.addEventListener('hashchange', () => this._onHashChange());

    // Click delegation — handles both available-tab info buttons and search-tab cards
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-open-classroom]');
      if (!trigger) return;
      e.stopPropagation();

      const id = parseInt(trigger.dataset.openClassroom);

      // Name element that will morph into the overlay title
      const card   = trigger.closest('.classroom-card') ?? trigger;
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
      const id      = parseInt(match[1]);
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

    this._currentId   = id;
    this._openTrigger = pending ?? null;
    document.body.style.overflow = 'hidden';

    const nameEl = pending?.nameEl ?? null;

    if (document.startViewTransition && this._tabbar) {
      // -- OLD state setup (before VT snapshot) --
      // Tabbar morphs into the back button
      this._tabbar.style.viewTransitionName = 'classroom-nav';
      // Room name morphs into the overlay title
      if (nameEl) nameEl.style.viewTransitionName = 'classroom-detail-name';

      const vt = document.startViewTransition(() => {
        // -- DOM changes (defines NEW state) --

        // Remove VT names from OLD-state sources so they don't duplicate the NEW-state targets.
        // Two elements sharing a VT name in the same state causes the browser to abort the
        // entire transition — that's why the open morph was silently skipped.
        this._tabbar.style.viewTransitionName = '';
        this._tabbar.classList.add('detail-open');
        if (nameEl) nameEl.style.viewTransitionName = '';

        // Show the overlay
        this._overlay.removeAttribute('hidden');
        this._renderContent(entry);
        this._overlay.classList.add('visible');

        // Back button is the NEW state destination for classroom-nav
        const backBtn = this._overlay.querySelector('.detail-back-btn');
        const titleEl = this._overlay.querySelector('.detail-title');
        if (backBtn) backBtn.style.viewTransitionName = 'classroom-nav';
        if (titleEl) titleEl.style.viewTransitionName = 'classroom-detail-name';
      });

      vt.finished.then(() => {
        // Clean up — VT names must be cleared after the animation
        this._tabbar.style.viewTransitionName = '';
        if (nameEl) nameEl.style.viewTransitionName = '';
        this._overlay.querySelector('.detail-back-btn')
          ?.style.setProperty('view-transition-name', '');
        this._overlay.querySelector('.detail-title')
          ?.style.setProperty('view-transition-name', '');
        // Tabbar stays hidden (opacity 0) until the overlay closes
      }).catch(() => {
        this._tabbar.style.viewTransitionName = '';
        if (nameEl) nameEl.style.viewTransitionName = '';
      });
    } else {
      // Fallback: show overlay, hide tabbar without animation
      this._overlay.removeAttribute('hidden');
      this._renderContent(entry);
      if (this._tabbar) {
        this._tabbar.classList.add('detail-open');
      }
      requestAnimationFrame(() => this._overlay.classList.add('visible'));
    }

    this._loadSchedule(id);
  }

  // ---------- CLOSE ----------

  _doClose() {
    if (!this._overlay || this._overlay.hidden) return;

    this._currentId = null;
    document.body.style.overflow = '';

    const nameEl  = this._openTrigger?.nameEl ?? null;
    const backBtn = this._overlay.querySelector('.detail-back-btn');
    const titleEl = this._overlay.querySelector('.detail-title');
    const nameInDom = nameEl && document.body.contains(nameEl);

    const cleanup = () => {
      this._overlay.innerHTML = '';
      this._openTrigger = null;
      if (nameEl) nameEl.style.viewTransitionName = '';
      if (this._tabbar) this._tabbar.style.viewTransitionName = '';
    };

    if (document.startViewTransition && this._tabbar) {
      // -- OLD state setup --
      // Back button is the source; tabbar is the destination
      if (backBtn) backBtn.style.viewTransitionName = 'classroom-nav';
      if (titleEl && nameInDom) titleEl.style.viewTransitionName = 'classroom-detail-name';

      const vt = document.startViewTransition(() => {
        // -- DOM changes (defines NEW state) --

        // Fully hide the overlay so it's absent from the NEW state
        this._overlay.setAttribute('hidden', '');
        this._overlay.classList.remove('visible');

        // Restore and name the tabbar as the NEW state destination for classroom-nav
        this._tabbar.classList.remove('detail-open');
        this._tabbar.style.viewTransitionName = 'classroom-nav';

        // Room name morphs back too
        if (nameInDom) nameEl.style.viewTransitionName = 'classroom-detail-name';
      });

      vt.finished.then(cleanup).catch(cleanup);
    } else {
      // Fallback: fade out overlay, restore tabbar without animation
      this._overlay.classList.remove('visible');
      if (this._tabbar) {
        this._tabbar.classList.remove('detail-open');
      }
      const hide = () => {
        this._overlay.setAttribute('hidden', '');
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
      <div class="detail-header">
        <button class="detail-back-btn" aria-label="${t('search.back')}">
          <span class="material-symbols-outlined">arrow_back</span>
        </button>
        <h1 class="detail-title">${classroom.name}</h1>
      </div>
      <div class="detail-content">
        <p class="detail-subtitle secondary">
          ${t('building.prefix')} ${building.name} &middot; ${getCampusDisplayName(campus)}
        </p>

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

    this._overlay.querySelector('.detail-back-btn').addEventListener('click', () => {
      if (this._openedViaPushState) {
        history.back();
      } else {
        // Opened via direct URL — clear hash without leaving the page
        history.replaceState(null, '', window.location.pathname + window.location.search);
        this._doClose();
      }
    });
  }

  // ---------- RENDER: WEEKLY SCHEDULE ----------

  _loadSchedule(classroomId) {
    const data      = occupancyData; // live ES module binding
    const container = document.getElementById('detail-schedule-container');
    if (!container) return;

    if (!data?.length) {
      container.innerHTML = `<p class="secondary">${t('detail.noData')}</p>`;
      return;
    }

    const today    = new Date();
    const todayKey = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('');

    const DAY_START = 8 * 60;
    const DAY_END   = 20 * 60;
    const total     = DAY_END - DAY_START;

    const rowsHtml = data.map(dayData => {
      let occupancy = [];
      outer: for (const c of dayData.campuses ?? []) {
        for (const b of c.buildings ?? []) {
          const room = b.classrooms?.find(r => r.id === classroomId);
          if (room) { occupancy = room.occupancy ?? []; break outer; }
        }
      }

      const dateKey   = dayData.date;
      const isToday   = dateKey === todayKey;
      const date      = new Date(
        parseInt(dateKey.slice(0, 4)),
        parseInt(dateKey.slice(4, 6)) - 1,
        parseInt(dateKey.slice(6, 8))
      );
      const dayName   = date.toLocaleDateString(undefined, { weekday: 'short' });
      const dayNum    = date.getDate();
      const monthName = date.toLocaleDateString(undefined, { month: 'short' });

      const blocksHtml = occupancy.map(slot => {
        const s = Math.max(timeToMinutes(slot.inizio), DAY_START);
        const e = Math.min(timeToMinutes(slot.fine),   DAY_END);
        if (e <= s) return '';
        const left  = ((s - DAY_START) / total * 100).toFixed(2);
        const width = ((e - s)         / total * 100).toFixed(2);
        return `<div class="detail-schedule-block" style="left:${left}%;width:${width}%"></div>`;
      }).join('');

      const now    = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const nowHtml = isToday && nowMin >= DAY_START && nowMin <= DAY_END
        ? `<div class="detail-schedule-now" style="left:${((nowMin - DAY_START) / total * 100).toFixed(2)}%"></div>`
        : '';

      return `
        <div class="detail-schedule-row${isToday ? ' detail-schedule-row--today' : ''}">
          <div class="detail-schedule-label">
            <span class="detail-schedule-day">${dayName}</span>
            <span class="detail-schedule-date secondary">${dayNum} ${monthName}</span>
          </div>
          <div class="detail-schedule-bar-wrapper">
            <div class="detail-schedule-bar">
              ${blocksHtml}
              ${nowHtml}
            </div>
          </div>
        </div>`;
    }).join('');

    const ticksHtml = [8, 10, 12, 14, 16, 18, 20].map(h => {
      const left = ((h * 60 - DAY_START) / total * 100).toFixed(2);
      return `<div class="detail-schedule-tick" style="left:${left}%"><span>${h}:00</span></div>`;
    }).join('');

    container.innerHTML = `
      <div class="detail-schedule-grid">${rowsHtml}</div>
      <div class="detail-schedule-ticks">${ticksHtml}</div>
    `;
  }
}

export const classroomDetail = new ClassroomDetail();
