history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

// One-time move of the blur preference to the key Vitrium reads. The cached
// benchmark verdict isn't carried over; it re-runs once at idle.
try {
  const oldMode = localStorage.getItem('poliAule_blurMode');
  if (oldMode !== null) {
    if (localStorage.getItem('lg:blur-mode') === null) localStorage.setItem('lg:blur-mode', oldMode);
    localStorage.removeItem('poliAule_blurMode');
  }
  localStorage.removeItem('poliAule_blurBenchmark');
} catch { /* storage unavailable */ }

if (ENV_LABEL) {
  const badge = document.getElementById('env-badge');
  badge.textContent = ENV_LABEL;
  badge.removeAttribute('hidden');
}

import {
  classroomsData,
  findAvailableClassrooms,
  fetchClassroomsData,
  loadCachedClassroomsData,
  isCampusClosedAllDay,
  getOpenCommonAreas,
  lastFetchedAt,
  isDayPending,
  whenClassroomsDataSettled,
  SKIP_DAYS
} from './available-rooms-script.js';

import { ensureClassroomDirectory, classroomsData as staticClassroomsData } from './classroom-search-data.js';
import { initSearchOverlay } from './components/search-overlay.js';
import { springFlight } from './utils/vt-motion.js';
import { classroomDetail } from './components/classroom-detail.js';
import { infoPage } from './components/info-page.js';
import { changelogPage } from './components/changelog-page.js';
import { settingsPage } from './components/settings-page.js';
import { initUpdateBanner } from './components/update-banner.js';
import { ENV_LABEL } from './utils/env.js';
import { initInfoHint } from './components/info-hint.js';

import { initTimePickers } from './components/time-picker.js';
import { initHourLens, refreshHourLensData } from './components/hour-lens.js';
import { setupCampusPicker, selectCampusById } from './components/campus-picker.js';
import { initCampusMap } from './components/campus-map.js';
import { initCampusSheet } from './components/campus-sheet.js';
import { retranslateCampusBuildingsPage, goToBuilding } from './components/campus-buildings.js';
import { activateGroupTab, retranslateNav } from './components/bottom-nav.js';
import { setupDatePicker } from './components/date-picker.js';
import './components/date-chip-picker.js';
import './components/time-range-chip-picker.js';
import { initPickerDock } from './components/picker-dock.js';
import { initPickerRowFlip } from './components/picker-row-flip.js';
import './components/data-fetch-card.js';

import { buildCardForClassroom } from './components/classroom-list.js';
import { buildingOverview } from './components/building-overview.js';
import { attachBuildingScrubber, cancelBuildingScrubber } from './components/building-scrubber.js';
import { initLiquidGlass, createButton, resolveBlurCapability, applyBlurState, scheduleIdleBenchmark, initRefraction } from 'vitrium';
import { initFavourites, renderFavourites } from './components/favourites.js';
import { initCardDayPopover } from './components/card-day-popover.js';
import { createBuildingStarButton } from './utils/favourites.js';

import { initI18n, t, getLocale, applyTranslations, onLanguageSwitch, animateI18nElement } from './i18n.js';
import { escapeHtml } from './utils/html.js';
import './components/tooltip.js';
import { initSettings, applyPreferredCampusIfEnabled, applyRememberLastCampusIfEnabled, SHOW_PARTIAL_KEY, INTERVAL_HOURS_KEY, getRefractionPref } from './components/settings.js';
import { initKeybindings } from './components/keybindings.js';
import { takeImportHash } from './utils/transfer.js';
import { promptImport } from './components/transfer-dialog.js';
import { initServiceWorker } from './utils/pwa.js';
import { resumeState, initResumeSnapshot } from './utils/resume.js';
import { initSeason, decorate } from './utils/season.js';
import { graduationOn } from './utils/graduation.js';
import { flipLayout, morphRender } from './utils/layout-flip.js';

// Opened from a device-transfer QR/link (see utils/transfer.js)? Take the
// payload out of the URL now, before the hash routers (info page, classroom
// detail) look at it; the import prompt is shown once the splash is gone.
const _pendingImport = takeImportHash();
// Relaunched where the user left off (utils/resume.js) with a classroom page
// open: put its hash back before the detail page's router reads it on init.
// A link the app was opened from wins.
if (resumeState?.hash && !location.hash) history.replaceState(null, '', resumeState.hash);
// Same for a transfer link opened in a tab that's already running PoliAule
// (a same-document hash change, no reload).
window.addEventListener('hashchange', () => {
  const raw = takeImportHash();
  // Favourites are validated against the classroom directory, which may
  // still be loading if the link arrived during start-up.
  if (raw) ensureClassroomDirectory().then(() => promptImport(raw, staticClassroomsData));
});

// ---------- SPLASH SCREEN ----------
const _splashStartTime = Date.now();
const _SPLASH_MIN_MS = 300;

// Set once showSplashError() has replaced the splash's markup with the error
// screen. The 15s init-timeout (below) and a genuinely slow-but-successful
// init are two independent setTimeout callbacks racing each other — nothing
// cancels the success path just because the timeout fired first. If init
// finishes after the error screen is already showing, dismissSplash() would
// otherwise reach for a .splash-logo/.header-logo hand-off that no longer
// applies (the error markup has no .splash-logo) and crash. Recover instead
// by just dropping the error screen and revealing the app.
let _splashFailed = false;

function dismissSplash() {
  const overlay = document.getElementById('splash-overlay');
  if (!overlay) return;

  const revealHeader = () =>
    document.querySelectorAll('.splash-header-item')
      .forEach(el => el.classList.add('splash-revealed'));

  if (_splashFailed) {
    overlay.remove();
    revealHeader();
    changelogPage.checkHash();
    settingsPage.checkHash();
    return;
  }

  const splashLogo = overlay.querySelector('.splash-logo');
  // Never take off mid-intro (a fast, cached start lands here while the logo is
  // still fading and growing in): the transition's snapshot is a still image,
  // so the logo would fly half-faded and pop to full opacity as it landed, and
  // its growth would flip straight into the shrink.
  const intro = splashLogo.getAnimations().filter(a => a.playState === 'running');
  if (intro.length) {
    Promise.all(intro.map(a => a.finished)).then(dismissSplash, dismissSplash);
    return;
  }

  const realLogo = document.querySelector('.header-logo');
  const isInfo = location.hash === '#info';
  const isChangelog = changelogPage.matchesHash;
  const isSettings = settingsPage.matchesHash;

  if (document.startViewTransition) {
    // --- View Transition path ---
    splashLogo.style.viewTransitionName = 'splash-icon';

    if (isInfo) {
      // Also name the header title/badge so they morph directly into the hero
      const titleEl = document.querySelector('.header-title');
      const badgeEl = document.getElementById('env-badge');
      if (titleEl) titleEl.style.viewTransitionName = 'info-title';
      if (badgeEl && !badgeEl.hidden) {
        badgeEl.style.lineHeight = '1';
        badgeEl.style.viewTransitionName = 'info-badge';
      }

      const vt = document.startViewTransition(() => {
        splashLogo.style.viewTransitionName = '';
        if (titleEl) titleEl.style.viewTransitionName = '';
        if (badgeEl) { badgeEl.style.lineHeight = ''; badgeEl.style.viewTransitionName = ''; }

        overlay.remove();
        revealHeader();

        // Open info page in this same VT — no second transition needed
        infoPage._applyOpenState('splash-icon');
      });

      // A second VT firing before this one settles rejects .ready/.finished with
      // InvalidStateError; .finished is handled above, but .ready isn't awaited
      // anywhere, so it was surfacing as an unhandled rejection on every abort.
      vt.ready.catch(() => {});
      vt.finished.then(() => infoPage._clearVtNames()).catch(() => infoPage._clearVtNames());
    } else if (isChangelog) {
      // Same for the changelog: opened in this VT, the logo landing on its
      // hero icon, so the app under it never flashes by first
      const vt = document.startViewTransition(async () => {
        splashLogo.style.viewTransitionName = '';
        overlay.remove();
        revealHeader();
        await changelogPage.openInSplash('splash-icon');
      });

      vt.ready.catch(() => {});
      const cleanup = () => changelogPage.clearSplashName();
      vt.finished.then(cleanup).catch(cleanup);
    } else {
      const vt = document.startViewTransition(() => {
        splashLogo.style.viewTransitionName = '';
        overlay.remove();
        revealHeader();
        realLogo.style.viewTransitionName = 'splash-icon';
        // A #settings link opens in this same transition, so the app under
        // it never shows first
        if (isSettings) settingsPage.openInSplash();
      });

      // The logo curves into the header on a spring per axis
      // (utils/vt-motion.js), instead of sliding along a straight line
      vt.ready.then(() => springFlight('splash-icon')).catch(() => {});
      const cleanup = () => { realLogo.style.viewTransitionName = ''; };
      vt.finished.then(cleanup).catch(cleanup);
    }
  } else {
    // --- FLIP fallback ---
    const firstRect = splashLogo.getBoundingClientRect();
    const lastRect  = realLogo.getBoundingClientRect();
    const dx    = (lastRect.left + lastRect.width  / 2) - (firstRect.left + firstRect.width  / 2);
    const dy    = (lastRect.top  + lastRect.height / 2) - (firstRect.top  + firstRect.height / 2);
    const scale = lastRect.height / firstRect.height;

    realLogo.style.opacity = '0';
    overlay.style.pointerEvents = 'none';
    // Under the fading splash already, rather than after it
    if (isChangelog) changelogPage.checkHash();
    if (isSettings) settingsPage.checkHash();

    splashLogo.classList.add('splash-logo-flying');
    void splashLogo.offsetWidth;

    splashLogo.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
    overlay.classList.add('splash-hiding');
    revealHeader();

    splashLogo.addEventListener('transitionend', () => {
      realLogo.style.opacity = '';
      overlay.remove();
      if (isInfo) infoPage.checkHash();
    }, { once: true });
  }
}

// The splash of a resumed launch is only its background by now (the logo is
// hidden before first paint, see index.html). Scrolls back to where the page
// was while still covered (programmatic scrolling works under the splash's
// overflow: hidden), then fades it out. Two frames first, for the results the
// restored day re-renders once the date picker selects it.
function dismissSplashOnResume() {
  const overlay = document.getElementById('splash-overlay');
  if (!overlay) return;
  if (_splashFailed) { dismissSplash(); return; }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!location.hash && resumeState.scrollY) window.scrollTo(0, resumeState.scrollY);
    document.querySelectorAll('.splash-header-item')
      .forEach(el => el.classList.add('splash-revealed'));
    overlay.style.pointerEvents = 'none';
    overlay.classList.add('splash-hiding');
    setTimeout(() => overlay.remove(), 150); // the fade, see .resuming in index.html
  }));
}

// What utils/resume.js saves each time the app goes to the background
function collectResumeState() {
  return {
    tab: document.querySelector('.tab-content.visible')?.id ?? null,
    campus: document.getElementById('campus-picker').value || null,
    date: document.getElementById('date-picker').value || null,
    from: document.getElementById('from-time-picker').value || null,
    to: document.getElementById('to-time-picker').value || null,
    hash: /^#classroom\//.test(location.hash) ? location.hash : null,
    scrollY: Math.round(window.scrollY),
  };
}

function showSplashError() {
  const overlay = document.getElementById('splash-overlay');
  if (!overlay) return;
  _splashFailed = true;
  overlay.classList.add('splash-error');
  overlay.innerHTML = `
    <i class="hgi-stroke hgi-wifi-off-01 splash-error-icon" aria-hidden="true"></i>
    <p class="splash-error-title">Unable to load</p>
    <p class="splash-error-subtitle">Check your connection and try again.</p>
    <button class="button-primary splash-error-reload" onclick="location.reload()">Reload</button>
  `;
}

// ---------- THEME COLOR META TAGS ----------
const lightMeta = document.querySelector('meta[name="theme-color"][media="(prefers-color-scheme: light)"]');
const darkMeta = document.querySelector('meta[name="theme-color"][media="(prefers-color-scheme: dark)"]');
const mq = window.matchMedia('(prefers-color-scheme: dark)');

function updateThemeColor(e) {
  // Force Safari to re-read by briefly swapping content
  if (e.matches) {
    darkMeta.content = '#1E1E1E';
  } else {
    lightMeta.content = '#ECECEC';
  }
}

mq.addEventListener('change', updateThemeColor);

document.addEventListener('DOMContentLoaded', () => {
  const isSamsungBrowser = /SamsungBrowser/i.test(navigator.userAgent);
  if (isSamsungBrowser) {
    document.documentElement.classList.add('samsung');
  }

  const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
  if (!isSafari) {
    document.documentElement.classList.add('no-safari');
  }

  const header = document.querySelector('.header');
  const setHeaderHeight = () =>
    document.documentElement.style.setProperty('--header-height', `${header.offsetHeight}px`);
  setHeaderHeight();
  // The header's top padding is env(safe-area-inset-top), which a home-screen
  // app often reports as 0 (or the other orientation's value) at first layout
  // and corrects later. That moves only the padding, so the default
  // content-box observation never fires and --header-height stays stale, with
  // everything stuck below it landing under the header. Observe the border box,
  // and re-measure when the app comes back or the window changes.
  new ResizeObserver(setHeaderHeight).observe(header, { box: 'border-box' });
  window.addEventListener('resize', setHeaderHeight);
  window.addEventListener('orientationchange', setHeaderHeight);
  window.addEventListener('pageshow', setHeaderHeight);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) setHeaderHeight();
  });

  // Live height of the sticky picker bar (mobile), so the results' sticky
  // per-building headers can park directly beneath it instead of overlapping.
  const pickerBar = document.getElementById('available-classrooms-form');
  if (pickerBar) {
    const setPickerBarHeight = () =>
      document.documentElement.style.setProperty('--picker-bar-height', `${pickerBar.offsetHeight}px`);
    setPickerBarHeight();
    new ResizeObserver(setPickerBarHeight).observe(pickerBar);
  }
})

document.querySelectorAll('.button-primary').forEach(btn => {
  btn.addEventListener('touchend', () => { }, { passive: true });
});

// ---------- TAB BAR ----------
// Tab switching is owned by components/bottom-nav.js (the bottom pill nav).

// ---------- BUILDING CARD ----------

// Builds one building's section: a single <li class="building-section"> (its
// own card grid) holding a sticky header followed by that building's room
// cards, to append directly into the outer <ul>. Returns { node, cardIndex }
// (the next cardIndex feeds the stagger-animation sequencing).
function buildBuildingSection(building, rooms, from, to, cardIndex = 0, isToday = false, date = null, campusId = null, allResults = []) {
  const buildingName = building.name;

  const allPartial = rooms.every(r => r.status === 'partially-free');

  // One <li> per building: its own card grid, so the sticky header stays
  // confined to this section (see .building-section in classroom-list.css).
  const section = document.createElement('li');
  section.className = 'building-section';
  section.dataset.buildingName = buildingName;
  if (building.id != null) section.dataset.buildingId = building.id;
  if (allPartial) section.dataset.allPartial = 'true';

  const headerEl = document.createElement('div');
  headerEl.className = 'building-section-header';
  headerEl.style.setProperty('--appear-delay', `${Math.min(cardIndex * 30, 300)}ms`);
  headerEl.innerHTML = `
    <button class="building-section-titles lg-ring liquid-glass" type="button" aria-haspopup="dialog" aria-label="${escapeHtml(t('building.prefix'))} ${escapeHtml(buildingName)}">
      <span class="building-name">${t('building.prefix')} ${escapeHtml(buildingName)}</span>
      ${building.altName ? `<span class="building-alt-name">${escapeHtml(building.altName)}</span>` : ''}
    </button>
    <div class="building-section-actions">
      <button class="header-button lg-ring building-section-btn building-section-jump liquid-glass" type="button" aria-label="${escapeHtml(t('building.viewInCampus').replace('{name}', buildingName))}">
        <i class="hgi-stroke hgi-arrow-right-01" aria-hidden="true"></i>
      </button>
    </div>
  `;
  // Stars the whole building (utils/favourites.js), next to the jump button.
  headerEl.querySelector('.building-section-actions')
    .prepend(createBuildingStarButton(campusId, buildingName, 'header-button lg-ring building-section-btn'));
  decorate('buildingHeader', headerEl, { campusId, building });
  cardIndex++;
  section.appendChild(headerEl);

  // Tapping the name pill "zooms out" into the building overview grid.
  const titlesBtn = headerEl.querySelector('.building-section-titles');
  const openOverview = () => buildingOverview.open({
    campusId,
    date,
    from,
    to,
    results: allResults,
    sourceSection: section,
    buildingName,
  });
  // Press, hold and drag instead: pick another building to jump to (see
  // components/building-scrubber.js). While it has the gesture, it isn't a tap.
  const scrubber = attachBuildingScrubber(titlesBtn, section);
  let downAt = null;
  let openedByTap = false;
  titlesBtn.addEventListener('pointerdown', (e) => {
    downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    openedByTap = false;
    buildingOverview.prewarm(section, { campusId, date, from, to, results: allResults });
  });
  // A press that turns into a scroll: drop what prewarm() built for it.
  titlesBtn.addEventListener('pointercancel', () => buildingOverview.cancelPrewarm());
  // Open on pointerup, not click: iOS Safari swallows the click when the tap
  // lands while the page is still rubber-banding from a scroll (very easy to
  // hit when you've just scrolled to the bottom of the list), and the shared
  // liquid-glass handler eats it after a few px of finger travel. A short,
  // near-stationary press is a tap. open() is a no-op if one already ran.
  titlesBtn.addEventListener('pointerup', (e) => {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    const held = performance.now() - downAt.t;
    downAt = null;
    if (scrubber.consumed) return;
    if (moved <= 12 && held < 700) {
      openedByTap = e.pointerType === 'touch';
      openOverview();
    }
  });
  // The rest of that tap, once it has opened the overview: Chrome on Android
  // sends its click to whatever is under the finger by then, which is the
  // overview's card for this very building, and a card's click navigates back
  // out of the overview. So it opened and closed in one tap. Cancelling the
  // touchend cancels the click it would have made.
  titlesBtn.addEventListener('touchend', (e) => {
    if (!openedByTap) return;
    openedByTap = false;
    if (e.cancelable) e.preventDefault();
  }, { passive: false });
  // Fallback for keyboard / assistive-tech activation, which fires click only.
  titlesBtn.addEventListener('click', () => { if (!scrubber.consumed) openOverview(); });

  // Jumps straight to this building's detail page in the Campus tab — see
  // components/campus-buildings.js's goToBuilding(), which brings the picker
  // along to the right campus first if needed.
  headerEl.querySelector('.building-section-jump').addEventListener('click', () => {
    activateGroupTab('search-classrooms-container');
    goToBuilding(campusId, buildingName);
  });

  rooms.forEach(room => {
    const roomItem = document.createElement('div');
    roomItem.className = 'classroom-list-item-container';
    roomItem.dataset.status = room.status;
    const cardEl = buildCardForClassroom(room, building, from, to, isToday, date, '', true, false);
    cardEl.style.setProperty('--appear-delay', `${Math.min(cardIndex * 30, 300)}ms`);
    roomItem.appendChild(cardEl);
    section.appendChild(roomItem);
    cardIndex++;
  });

  return { node: section, cardIndex };
}

// ---------- DATA FETCHING ----------

// Triggers the fetching of data as soon as the page loads
document.addEventListener('DOMContentLoaded', async () => {
  // Safety net: if init hangs for any reason (e.g. fonts.ready stalls on bad
  // connectivity), surface the error screen instead of staying stuck forever.
  const _initTimeoutId = setTimeout(showSplashError, 15000);

  // Kick off occupancy fetching immediately, in parallel with everything
  // below. It's an independent network round trip (locale JSON and the
  // classroom directory don't feed into it) and doesn't block the splash —
  // the date picker/results area stay in their skeleton/loading state until
  // it resolves — so there's no reason to make it wait its turn behind the
  // rest of init.
  initOccupancyData();

  try {
    // The locale JSON and the static classroom directory are independent
    // fetches (neither's data feeds the other) but both block the splash —
    // it's what the page shell (campus picker, classroom detail, favourites)
    // is built from, and translations need to be in before anything renders
    // text. Running them head-to-tail with two `await`s would serialize two
    // network round trips for no reason, so fire them together instead.
    await Promise.all([initI18n(), ensureClassroomDirectory()]);

    applyTranslations();
    retranslateNav();
    // <date-chip-picker> renders its date label via Intl at module-eval time,
    // before initI18n() resolves — re-render it now that the locale is known.
    document.querySelector('date-chip-picker')?.retranslate();
    document.querySelector('time-range-chip-picker')?.retranslate();

    initSettings();

    // Holiday decorations, when today is in a season (utils/season.js)
    initSeason();

    // A week-long banner announcing the version this site runs
    initUpdateBanner();

    // Desktop keyboard shortcuts (no-ops on touch / narrow viewports)
    initKeybindings();

    // Init info page overlay immediately — no data dependency
    infoPage.init();
    changelogPage.init();
    initInfoHint();

    // Search overlay (bottom-nav FAB) — lazy-loads its data on first open
    initSearchOverlay();

    // Init classroom detail overlay (hash routing + VT morph)
    classroomDetail.init(staticClassroomsData);

    // Delegated press / swipe-deform for every .liquid-glass control
    initLiquidGlass();

    // Favourites carousel on the Available page
    initFavourites(staticClassroomsData);

    // Hover preview of a room's whole day on every classroom card
    initCardDayPopover();

    // Campus tab — fullscreen map, lazily initialised on first activation
    initCampusMap();

    // Campus tab — draggable glass sheet floating over the map
    initCampusSheet();

    // Setup the campus picker with the available ones
    setupCampusPicker(staticClassroomsData);
    applyPreferredCampusIfEnabled();
    applyRememberLastCampusIfEnabled();
    if (resumeState?.campus) selectCampusById(resumeState.campus, false);

    // Setup the time pickers to ensure valid time ranges
    // (these don't depend on occupancy data)
    setupTimePickers();
    if (resumeState) restoreQuery(resumeState);
    initTimePickers();
    initHourLens();

    // Decide pill vs. inline-expanded pickers based on the form column's width
    // (desktop two-column layout only).
    initPickerDock();

    // Pills that hop lines when another one changes width glide there instead.
    initPickerRowFlip();

    // Everything the occupancy UI reads (pickers, favourites, detail page) exists now
    resolveShellReady();

    // Setup the language switch handler immediately — doesn't depend on
    // fonts and shouldn't wait for the splash to dismiss
    onLanguageSwitch(() => {
      setupDataFetchIndicatorText(true);
      setupDatePicker(() => preferInitialDate);
      document.querySelector('campus-chip-picker')?.retranslate();
      retranslateCampusBuildingsPage();
      renderFavourites();
      const container = document.getElementById('available-classrooms-results');
      if (!container.classList.contains('empty')) {
        document.getElementById('available-classrooms-form').dispatchEvent(
          new Event('submit', { cancelable: true, bubbles: true })
        );
      }
    });

    // Apply the cached blur verdict (or the safe "off" default if none yet)
    // instantly — the actual benchmark never runs during load, see
    // Vitrium's core/blur-capability.js for why.
    applyBlurState(resolveBlurCapability());
    // Rim refraction on glass (Chromium only, and only while blur is on);
    // the glass style itself is set before first paint in index.html.
    initRefraction({ enabled: getRefractionPref() });

    await document.fonts.ready;
    document.querySelector('.time-pickers-container').style.opacity = '1';
    document.querySelector('campus-chip-picker')?.removeAttribute('data-loading');

    clearTimeout(_initTimeoutId);
    const elapsed = Date.now() - _splashStartTime;
    // A resumed launch (utils/resume.js) has nothing to show off: it goes
    // straight back to the page, without the minimum or the logo hand-off.
    const resuming = resumeState && location.hash !== '#info';
    const remaining = resuming ? 0 : Math.max(0, _SPLASH_MIN_MS - elapsed);
    setTimeout(resuming ? dismissSplashOnResume : dismissSplash, remaining);
    initResumeSnapshot(collectResumeState);
    // Leave the splash hand-off time to finish before the prompt pops up.
    if (_pendingImport) setTimeout(() => promptImport(_pendingImport, staticClassroomsData), remaining + 600);

    // Once things have settled, spend a moment of genuine idle time
    // benchmarking blur for real (first load / no cached verdict only).
    scheduleIdleBenchmark();

    // Offline app shell + update prompt. Registered once the app is up, so
    // installing it never competes with the first load.
    initServiceWorker();

  } catch (error) {
    clearTimeout(_initTimeoutId);
    console.error('Initialization failed:', error);
    const elapsed = Date.now() - _splashStartTime;
    const remaining = Math.max(0, _SPLASH_MIN_MS - elapsed);
    setTimeout(showSplashError, remaining);
  }
});

// Resolved by the DOMContentLoaded init once the page shell is set up. Data
// from the cache can be ready before that, and an auto-search fired then would
// read an empty campus and time range.
let resolveShellReady;
const shellReady = new Promise(resolve => { resolveShellReady = resolve; });

// Fetches occupancy data in the background (independent of the splash
// screen) and populates everything that depends on it once it's ready.
// The last visit's cached copy, when there is one, draws the UI straight
// away; the network then only confirms it (304s) or replaces it. Without
// one, the UI draws as soon as the start-up day is in, and the rest of the
// week follows.
async function initOccupancyData() {
  const hasCache = await loadCachedClassroomsData();
  let fetchSettled = false;
  let firstDayIn;
  const firstDay = new Promise(resolve => { firstDayIn = resolve; });
  const fetched = fetchClassroomsData(hasCache ? {} : {
    getFirstDate: () => preferInitialDate,
    onFirstDay: firstDayIn,
  }).finally(() => { fetchSettled = true; });
  if (!hasCache) await Promise.race([firstDay, fetched]);

  await shellReady;
  // The network may have answered while the shell was still setting up
  const drawnEarly = !fetchSettled;
  populateOccupancyUi();
  const changed = await fetched;
  // A partial first draw is always stale once the whole week is in
  if (drawnEarly && (changed || !hasCache)) refreshOccupancyUi();
}

// Fills in everything that depends on the occupancy data, the first time it's there
function populateOccupancyUi() {

  // Use the fetched data to set the only valid dates into the date picker
  setupDatePicker(() => preferInitialDate);
  refreshHourLensData();
  document.getElementById('available-classrooms-form').removeAttribute('data-loading');
  document.querySelector('date-chip-picker')?.removeAttribute('data-loading');

  setupDataFetchIndicator();
  setupLiveSearch();

  // If a classroom detail page was opened before occupancy data arrived
  // (e.g. a direct link), fill in its status badge and timeline now.
  classroomDetail.refreshOccupancy();
  renderFavourites();

  // There's no search button: the first search runs now, and live search
  // (setupLiveSearch) keeps it current from then on
  document.getElementById('available-classrooms-form').dispatchEvent(
    new Event('submit', { cancelable: true, bubbles: true })
  );
}

// ---------- FORM 1: AVAILABLE CLASSROOMS ----------
// Setup the 'Available Classrooms' form
document.getElementById('available-classrooms-form').addEventListener('submit', (e) => {
  // Skip default submit behavior since we will handle it with JavaScript
  e.preventDefault();


  // Check if data was already fetched
  if (!classroomsData.length) {
    console.warn('Data not yet loaded, please wait...');
    return;
  }

  // Read input data
  const data = new FormData(e.target);
  const campus = data.get('campus');
  const date = data.get('date'); // comes from the hidden select

  // A day still on its way (first visit, see initOccupancyData): search once
  // it's in, unless a search after the load (refreshOccupancyUi) got there
  // first. It was requested with the first day, so the wait is short: the
  // current results just stay up meanwhile.
  delete e.target.dataset.waitingFor;
  if (date && isDayPending(date.replace(/-/g, ''))) {
    const form = e.target;
    form.dataset.waitingFor = date;
    whenClassroomsDataSettled().then(() => {
      if (form.dataset.waitingFor !== date) return;
      delete form.dataset.waitingFor;
      form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    });
    return;
  }
  const from = data.get('from');
  const to = data.get('to');

  // Compute results
  const results = findAvailableClassrooms(campus, date, from, to);

  // Render results
  renderAvailableClassroomsResults(results, date, from, to, campus);
});

// Graduation sessions that arrive (or change) after the results are drawn
// add or drop the note above them; a campus change re-runs the search anyway
document.addEventListener('graduationschange', () => {
  const container = document.getElementById('available-classrooms-results');
  if (!container?.dataset.searched || container.classList.contains('empty')) return;
  const date = document.getElementById('date-picker')?.value;
  const campusId = document.getElementById('campus-picker')?.value;
  const old = container.querySelector(':scope > .graduation-note');
  const note = date && graduationNote(date, campusId);
  // Same note as before: nothing to redo
  if (!old === !note) return;
  // The note shrinks away (or rises in) and the list slides up or down to
  // make room for it
  flipLayout(container, ':scope > .graduation-note, .results-filter-row, .classroom-card, .building-section-header', () => {
    old?.remove();
    if (note) container.prepend(note);
  }, { isLeaving: (el) => el === old });
});

// Builds the UI to show the results of the 'Available Classrooms' form submission.
// A new date, time or campus rebuilds the whole list, so the rooms that are in
// both glide from their old place to the new one, the ones gone fade out
// where they were, and the new ones run their usual entrance
// (utils/layout-flip.js).
function renderAvailableClassroomsResults(results, date, from, to, campusId = null) {
  const container = document.getElementById('available-classrooms-results');
  // Another campus has nothing in common with the list on screen: replace it whole
  const swap = container.dataset.campus != null && container.dataset.campus !== String(campusId);
  container.dataset.campus = campusId;
  morphRender(container, '.classroom-card, .building-section-header', resultsKey,
    () => buildAvailableClassroomsResults(container, results, date, from, to, campusId), { swap });
}

function resultsKey(el) {
  if (el.dataset.openClassroom) return `room:${el.dataset.openClassroom}`;
  const building = el.closest('.building-section')?.dataset.buildingName;
  return building != null ? `building:${building}` : null;
}

function buildAvailableClassroomsResults(container, results, date, from, to, campusId) {
  buildingOverview.reset(); // tear down the zoom-out view if it's open
  cancelBuildingScrubber();
  container.dataset.searched = 'true';
  container.innerHTML = ''; // Clear previous results

  // Find the day entry matching the selected date
  const dateKey = date.replace(/-/g, ''); // "2026-03-16" → "20260316"
  const dayData = classroomsData.find(day => day.date === dateKey) ?? classroomsData[0];

  if (results.length === 0) {
    if (campusId && isCampusClosedAllDay(campusId, date)) renderCampusClosedContainer(container, campusId, date);
    else renderNoResultsClassroomsContainer(container);
    return;
  }

  container.classList.remove('empty');

  const graduation = graduationNote(date, campusId);
  if (graduation) container.appendChild(graduation);

  // Filter row (rendered only when partial-free filter is needed)
  const filterRow = document.createElement('div');
  filterRow.className = 'results-filter-row';

  // Partial-free filter toggle — initial state driven by Show Partially Free setting
  const showPartialSaved = localStorage.getItem(SHOW_PARTIAL_KEY);
  const showPartialDefault = showPartialSaved === null ? true : showPartialSaved === 'true';
  const hasPartial = results.some(b => b.rooms.some(r => r.status === 'partially-free'));
  if (hasPartial) {
    // Vitrium glass button: clear accent-tinted glass while partially free rooms are shown, plain glass when hidden.
    const setShown = (shown) => {
      toggleBtn.classList.toggle('lg-glass--tinted', shown);
      toggleBtn.classList.toggle('lg-glass--clear', shown);
      toggleBtn.setAttribute('aria-pressed', String(shown));
    };
    const applyShown = (shown) => container.classList.toggle('hide-partial', !shown);
    const toggleBtn = createButton({
      icon: '<i class="hgi-stroke hgi-filter" aria-hidden="true"></i>',
      text: t('results.filterPartial'),
      className: 'results-filter-btn',
      onClick: () => {
        const shown = toggleBtn.getAttribute('aria-pressed') !== 'true';
        setShown(shown);
        // The partly free cards shrink away (or rise in) and the rest glide
        // into place; while the list is still running its entrance, just swap
        const apply = () => applyShown(shown);
        if (!list.classList.contains('appeared')) { apply(); return; }
        flipLayout(list, '.classroom-card, .building-section-header', apply, {
          isLeaving: (el) => !shown && !!el.closest('[data-status="partially-free"], [data-all-partial="true"]'),
        });
      },
    });
    setShown(showPartialDefault);
    applyShown(showPartialDefault);
    filterRow.appendChild(toggleBtn);
    container.appendChild(filterRow);
  }

  const list = document.createElement('ul');
  list.className = 'list-outer-container';

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const isToday = date === todayStr;

  let cardIndex = 0;
  results.forEach(buildingResult => {
    const { node, cardIndex: next } = buildBuildingSection(buildingResult.building, buildingResult.rooms, from, to, cardIndex, isToday, date, campusId, results);
    cardIndex = next;
    list.appendChild(node);
  });

  // The building overview's zoom frame (components/building-overview.js).
  // It's here from the start because moving the list into it on tap
  // restyled and re-laid out the whole list right when the zoom started.
  const stage = document.createElement('div');
  stage.className = 'bo-stage';
  stage.appendChild(list);
  container.appendChild(stage);

  // Mark the list as appeared after the staggered animation finishes.
  // This avoids re-triggering the animation when returning from the details page
  // or switching back and forth between tabs.
  requestAnimationFrame(() => {
    setTimeout(() => {
      list.classList.add('appeared');
    }, 1100);
  });
}

// Render the error state for the Available Classrooms results container
function renderNoResultsClassroomsContainer(container) {
  container.classList.add('empty');

  container.innerHTML = `
    <i class="hgi-stroke hgi-search-remove empty-container-icon" aria-hidden="true"></i>
    <p class="empty-container-title">${t('results.noResultsTitle')}</p>
    <p class="empty-container-subtitle">${t('results.noResultsSubtitle')}</p>
  `;
}

// The empty state when every building on the campus is closed that day (a
// Sunday, a holiday): a tinted glass note saying so, instead of "no results",
// plus the common areas that stay open anyway (building 11's Patio and Agorà).
function renderCampusClosedContainer(container, campusId, date) {
  container.classList.add('empty');

  const commonAreaLines = getOpenCommonAreas(campusId, date).map(({ building, names, hours }) => {
    const allDay = hours[0] === '00:00' && hours[1] === '23:59';
    return `<p class="campus-closed-note__body">${t('results.campusClosedCommonAreas')
      .replace('{building}', escapeHtml(building))
      .replace('{areas}', names.map(escapeHtml).join(', '))
      .replace('{hours}', allDay ? t('results.campusClosedAllDay') : `${escapeHtml(hours[0])}–${escapeHtml(hours[1])}`)}</p>`;
  });

  container.innerHTML = `
    <div class="campus-closed-note lg-glass lg-glass--clear lg-glass--tinted liquid-glass" role="note">
      <i class="hgi-stroke hgi-door-lock campus-closed-note__icon" aria-hidden="true"></i>
      <div class="campus-closed-note__text">
        <p class="campus-closed-note__title">${t('results.campusClosedTitle')}</p>
        <p class="campus-closed-note__body">${t('results.campusClosedText')}</p>
        ${commonAreaLines.join('')}
      </div>
    </div>
  `;
}

// A graduation day at the campus (utils/graduation.js): a note above the
// results that the ceremonies may take rooms the data shows as free. Styled
// like the campus-closed note, laurel in place of the lock.
function graduationNote(date, campusId) {
  if (!graduationOn(date, campusId)) return null;
  const note = document.createElement('div');
  note.className = 'campus-closed-note graduation-note lg-glass lg-glass--clear lg-glass--tinted liquid-glass';
  note.setAttribute('role', 'note');
  note.innerHTML = `
    <i class="hgi-stroke hgi-laurel-wreath-01 campus-closed-note__icon" aria-hidden="true"></i>
    <div class="campus-closed-note__text">
      <p class="campus-closed-note__title">${t('results.graduationTitle')}</p>
      <p class="campus-closed-note__body">${t('results.graduationText')}</p>
    </div>
  `;
  return note;
}

const TIME_MIN_MINS = 7 * 60 + 15;  // 07:15
const TIME_MAX_MINS = 20 * 60 + 15; // 20:15

// Set by setupTimePickers when the current time is after 20:15 (need tomorrow's date)
let preferInitialDate = null;

// Sets up the time pickers to ensure that the 'to' time
// is always at least 1 hour after the 'from' time, within 07:15–20:15
function setupTimePickers() {
  const fromPicker = document.getElementById('from-time-picker');
  const toPicker = document.getElementById('to-time-picker');

  function toMinutes(timeStr) {
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  }

  function formatMins(mins) {
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }

  function formatTime(date) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }

  fromPicker.addEventListener('input', () => {
    if (!fromPicker.value) return;

    const fromMins = toMinutes(fromPicker.value);
    const minToMins = Math.min(fromMins + 60, TIME_MAX_MINS);
    toPicker.min = formatMins(minToMins);

    if (toPicker.value && toMinutes(toPicker.value) < minToMins) {
      toPicker.value = formatMins(minToMins);
    }
  });

  toPicker.addEventListener('input', () => {
    if (!toPicker.value || !fromPicker.value) return;

    const diffMinutes = toMinutes(toPicker.value) - toMinutes(fromPicker.value);
    if (diffMinutes < 60) {
      const corrected = Math.min(toMinutes(fromPicker.value) + 60, TIME_MAX_MINS);
      toPicker.value = formatMins(corrected);
    }
  });

  // Set initial values
  const intervalHours = parseInt(localStorage.getItem(INTERVAL_HOURS_KEY), 10) || 2;
  const now = new Date();

  // Snap to next :15 slot
  const snapped = new Date(now);
  snapped.setMinutes(15, 0, 0);
  if (now.getMinutes() >= 15) snapped.setHours(snapped.getHours() + 1);

  const snappedMins = snapped.getHours() * 60 + snapped.getMinutes();

  if (snappedMins > TIME_MAX_MINS) {
    // After 20:15 → next non-skipped day at 07:15; signal date picker to advance
    do { snapped.setDate(snapped.getDate() + 1); } while (SKIP_DAYS.includes(snapped.getDay()));
    snapped.setHours(7, 15, 0, 0);
    preferInitialDate = [
      snapped.getFullYear(),
      String(snapped.getMonth() + 1).padStart(2, '0'),
      String(snapped.getDate()).padStart(2, '0'),
    ].join('-');
  } else if (snappedMins < TIME_MIN_MINS) {
    // Before 07:15 → today at 07:15
    snapped.setHours(7, 15, 0, 0);
  }

  let fromMins = snapped.getHours() * 60 + snapped.getMinutes();
  let toMins = fromMins + intervalHours * 60;

  if (toMins > TIME_MAX_MINS) {
    toMins = TIME_MAX_MINS;
    fromMins = Math.max(TIME_MIN_MINS, toMins - Math.max(60, intervalHours * 60));
    // Re-sync snapped object for formatTime(snapped)
    snapped.setHours(Math.floor(fromMins / 60), fromMins % 60, 0, 0);
  }

  const minToMins = Math.min(fromMins + 60, TIME_MAX_MINS);

  fromPicker.value = formatTime(snapped);
  toPicker.value = formatMins(toMins);
  toPicker.min = formatMins(minToMins);
}

// Puts back the day and time range a resumed launch left on (utils/resume.js).
// The hour lens moves a range whose hours have passed on, and a day no longer
// published falls back to the first one, like any preferred date.
function restoreQuery({ date, from, to }) {
  const HHMM = /^\d{2}:\d{2}$/;
  if (HHMM.test(from) && HHMM.test(to)) {
    const [h, m] = from.split(':').map(Number);
    const minTo = Math.min(h * 60 + m + 60, TIME_MAX_MINS);
    const toPicker = document.getElementById('to-time-picker');
    document.getElementById('from-time-picker').value = from;
    toPicker.value = to;
    toPicker.min = `${String(Math.floor(minTo / 60)).padStart(2, '0')}:${String(minTo % 60).padStart(2, '0')}`;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) preferInitialDate = date;
}

function setupDataFetchIndicator() {
  const indicator = document.getElementById('data-fetch-indicator');

  if (!classroomsData.length) {
    indicator.classList.add('red');
    return;
  }

  const today = new Date();
  const todayKey = [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0')
  ].join('');

  const generationDate = new Date((lastFetchedAt ?? classroomsData[0].generated_at) + 'Z');
  const generationKey = [
    generationDate.getFullYear(),
    String(generationDate.getMonth() + 1).padStart(2, '0'),
    String(generationDate.getDate()).padStart(2, '0')
  ].join('');

  const hasFutureData = classroomsData.some(entry => entry.date > todayKey);

  if (generationKey === todayKey) {
    // Generated today — fresh
    indicator.classList.add('green');
  } else if (hasFutureData) {
    // Not generated today but still has upcoming days — tolerable
    indicator.classList.add('yellow');
  } else {
    // No future data at all — outdated
    indicator.classList.add('red');
  }

  setupDataFetchIndicatorText();
}

// Setups the text inside the popover shown in the Data Fetch Indicator
function setupDataFetchIndicatorText(animate = false) {
  const container = document.getElementById('data-fetch-indicator-popover-container');

  const states = {
    green: {
      title: t('data.greenTitle'),
      description: t('data.greenDesc'),
    },
    yellow: {
      title: t('data.yellowTitle'),
      description: t('data.yellowDesc'),
    },
    red: {
      title: t('data.redTitle'),
      description: t('data.redDesc'),
    },
  };

  // Derive current status from the indicator's classes
  const indicator = document.getElementById('data-fetch-indicator');
  const status = ['green', 'yellow', 'red'].find(s => indicator.classList.contains(s)) ?? 'red';
  const { title, description } = states[status];

  // Last fetch time
  const generationDate = classroomsData[0]
    ? new Date((lastFetchedAt ?? classroomsData[0].generated_at) + 'Z')
    : null;

  const dateLocale = getLocale() === 'it' ? 'it-IT' : 'en-GB';
  const formattedTime = generationDate
    ? generationDate.toLocaleString(dateLocale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'Europe/Rome',
    })
    : '—';

  container.innerHTML = `
    <h1 class="popover-title ${status}">${title}</h1>
    <p class="data-status-description secondary">${description}</p>
    <label class="data-status-time secondary">${t('data.lastFetched')}: ${formattedTime}</label>
    <button id="reload-data-btn" class="button-primary button-secondary data-reload-btn">
      <i class="hgi-stroke hgi-refresh data-reload-icon" aria-hidden="true"></i>
      <span class="data-reload-label">${t('data.reload')}</span>
    </button>
  `;
  document.getElementById('reload-data-btn').addEventListener('click', reloadOccupancyData);
  if (animate) animateI18nElement(container);
}

async function reloadOccupancyData() {
  const btn = document.getElementById('reload-data-btn');
  if (!btn || btn.disabled) return;

  btn.disabled = true;
  btn.querySelector('.data-reload-icon').classList.add('spinning');
  btn.querySelector('.data-reload-label').textContent = t('data.reloading');

  await fetchClassroomsData();
  refreshOccupancyUi();
}

// Redraws what depends on the occupancy data after it was replaced
function refreshOccupancyUi() {
  const indicator = document.getElementById('data-fetch-indicator');
  indicator.classList.remove('green', 'yellow', 'red');
  setupDataFetchIndicator();
  // Keep the day the user is on, if it's still published
  const selectedDate = document.getElementById('date-picker').value;
  setupDatePicker(() => selectedDate || preferInitialDate);
  refreshHourLensData();
  classroomDetail.refreshOccupancy();
  renderFavourites();
  // The search overlay redraws an open query (components/search-overlay.js)
  document.dispatchEvent(new CustomEvent('occupancychange'));

  const resultsContainer = document.getElementById('available-classrooms-results');
  if (resultsContainer && !resultsContainer.classList.contains('empty')) {
    document.getElementById('available-classrooms-form').dispatchEvent(
      new Event('submit', { cancelable: true, bubbles: true })
    );
  }
}

// ---------- LIVE SEARCH ----------

function setupLiveSearch() {
  const form = document.getElementById('available-classrooms-form');
  const results = document.getElementById('available-classrooms-results');

  function trigger() {
    if (!classroomsData.length || !results.dataset.searched) return;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }

  let debounceTimer = null;
  function triggerDebounced() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(trigger, 320);
  }

  document.addEventListener('campuschange', trigger);
  document.getElementById('date-picker').addEventListener('change', trigger);
  document.getElementById('from-time-picker').addEventListener('input', triggerDebounced);
  document.getElementById('to-time-picker').addEventListener('input', triggerDebounced);
}
