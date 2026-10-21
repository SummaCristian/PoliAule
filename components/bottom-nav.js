// The main navigation: Vitrium's tab bar. Available and Campus are tabs that
// slide, resize and can be dragged; Search is its own floating circle (a
// `prominent` + `press` tab), which never becomes selected: pressing it opens
// the search overlay, which morphs out of it (see search-overlay.js).
//
// A row pinned to the bottom on mobile, a vertical rail pinned top-left below
// the header from 600px up. This file wires it to the app's tab panels, the
// saved start-up / last tab, and the layout variables the rest of the CSS reads.
import { createTabBar } from 'vitrium';
import { t, onLanguageSwitch } from '../i18n.js';
import { DEFAULT_TAB_KEY, LAST_TAB_KEY, getStartupTabId } from './settings.js';
import { openSearchOverlay } from './search-overlay.js';
import { resumeState } from '../utils/resume.js';

const icon = (paths) => `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">${paths.map(d => `<path d="${d}" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}</svg>`;

// HugeIcons Stroke Rounded path data from @hugeicons/core-free-icons (MIT).
const icons = {
  calendar: icon([
    'M16 2V6M8 2V6',
    'M13 4H11C7.22876 4 5.34315 4 4.17157 5.17157C3 6.34315 3 8.22876 3 12V14C3 17.7712 3 19.6569 4.17157 20.8284C5.34315 22 7.22876 22 11 22H13C16.7712 22 18.6569 22 19.8284 20.8284C21 19.6569 21 17.7712 21 14V12C21 8.22876 21 6.34315 19.8284 5.17157C18.6569 4 16.7712 4 13 4Z',
    'M3 10H21',
    'M12.1258 14H12.0008M12.1258 18H12.0008M7.625 14H7.5M7.625 18H7.5M16.625 14H16.5M12.2508 14C12.2508 14.1381 12.1389 14.25 12.0008 14.25C11.8628 14.25 11.7508 14.1381 11.7508 14C11.7508 13.8619 11.8628 13.75 12.0008 13.75C12.1389 13.75 12.2508 13.8619 12.2508 14ZM12.2508 18C12.2508 18.1381 12.1389 18.25 12.0008 18.25C11.8628 18.25 11.7508 18.1381 11.7508 18C11.7508 17.8619 11.8628 17.75 12.0008 17.75C12.1389 17.75 12.2508 17.8619 12.2508 18ZM7.75 14C7.75 14.1381 7.63807 14.25 7.5 14.25C7.36193 14.25 7.25 14.1381 7.25 14C7.25 13.8619 7.36193 13.75 7.5 13.75C7.63807 13.75 7.75 13.8619 7.75 14ZM7.75 18C7.75 18.1381 7.63807 18.25 7.5 18.25C7.36193 18.25 7.25 18.1381 7.25 18C7.25 17.8619 7.36193 17.75 7.5 17.75C7.63807 17.75 7.75 17.8619 7.75 18ZM16.75 14C16.75 14.1381 16.6381 14.25 16.5 14.25C16.3619 14.25 16.25 14.1381 16.25 14C16.25 13.8619 16.3619 13.75 16.5 13.75C16.6381 13.75 16.75 13.8619 16.75 14Z',
  ]),
  university: icon([
    'M2 22H21.5', 'M3 13V22M21 13V22', 'M7.5 8V22M16.5 8V22',
    'M2 13H7M22 13H17', 'M6.5 8H17.5',
    'M12 8V4.98221M12 4.98221V2.97035C12 2.49615 12 2.25905 12.1464 2.11173C12.6061 1.64939 14.5 2.74303 15.2203 3.18653C15.8285 3.56105 16 4.30914 16 4.98221H12Z',
    'M12 22L12 20', 'M10.5 12L10.5 12.5M13.5 12V12.5', 'M10.5 16L10.5 16.5M13.5 16V16.5',
  ]),
  search: icon(['M17 17L21 21', 'M19 11C19 6.58172 15.4183 3 11 3C6.58172 3 3 6.58172 3 11C3 15.4183 6.58172 19 11 19C15.4183 19 19 15.4183 19 11Z']),
};

// A tab's id is the id of the panel it shows.
const TABS = [
  // Settings' Default Tab picker shows these same icons (components/settings.js)
  { id: 'available-classrooms-container', labelKey: 'tabs.available', icon: icons.calendar },
  { id: 'search-classrooms-container', labelKey: 'tabs.campus', icon: icons.university },
];
const SEARCH = { id: 'search', labelKey: 'tabs.search', icon: icons.search };

const root = document.getElementById('bn-wrapper');
const contentContainers = document.querySelectorAll('.tab-content');

/* --- Tab-content switching ---------------------------------------------- */
// The Campus tab's scroll lock (campus-map.css) keys off this class on <html>,
// set and cleared together with the tab's own .visible. It used to be
// html:has(#search-classrooms-container.visible), but a :has() whose argument
// can match anywhere in the document makes Chrome re-check <html> after DOM
// changes anywhere, and restyle the whole page each time: opening a classroom
// page paid for that in every forced style pass of its transition.
const CAMPUS_TAB_ID = 'search-classrooms-container';

function showContent(targetId) {
  contentContainers.forEach(container => {
    if (container.id === targetId) {
      requestAnimationFrame(() => {
        container.classList.add('visible');
        if (container.id === CAMPUS_TAB_ID) document.documentElement.classList.add('campus-tab');
        // content-visibility:hidden->visible doesn't reliably fire
        // ResizeObserver on descendants across browsers (e.g. Safari), so
        // anything that measured its own layout (offsetTop/offsetWidth)
        // while this tab was hidden, like the date picker's sliding
        // indicator, can be left with stale coordinates baked into inline
        // styles. Let listeners (date-picker.js) recompute now that this
        // subtree is actually laid out again.
        container.dispatchEvent(new CustomEvent('tabvisible', { bubbles: true }));
      });
    } else {
      container.classList.remove('visible');
      if (container.id === CAMPUS_TAB_ID) document.documentElement.classList.remove('campus-tab');
    }
  });
}

function persist(targetId) {
  if (localStorage.getItem(DEFAULT_TAB_KEY) === 'last') {
    localStorage.setItem(LAST_TAB_KEY, targetId);
  }
}

/* --- The bar ------------------------------------------------------------- */
// A relaunch that resumes (utils/resume.js) reopens the tab it left on
const startupId = resumeState?.tab ?? getStartupTabId();
const startup = TABS.find(tab => tab.id === startupId) ?? TABS[0];

const bar = createTabBar(root, {
  label: t('a11y.mainNav'),
  value: startup.id,
  tabs: [
    ...TABS.map(({ id, labelKey, icon }) => ({ id, label: t(labelKey), icon, panel: id })),
    { id: SEARCH.id, label: t(SEARCH.labelKey), icon: SEARCH.icon, prominent: true, press: true, onPress: () => openSearchOverlay() },
  ],
  onSelect(id, { silent }) {
    showContent(id);
    if (silent) return;
    window.scrollTo(0, 0);
    persist(id);
  },
});
showContent(startup.id);

// The labels are built when this module loads, before the locale has, so
// script.js calls this once i18n is ready, and it runs on every language switch.
// (setLabel also updates the tab definitions, so a later layout change keeps them.)
export function retranslateNav() {
  for (const { id, labelKey } of [...TABS, SEARCH]) bar.setLabel(id, t(labelKey));
  root.querySelector('[role="tablist"]')?.setAttribute('aria-label', t('a11y.mainNav'));
}
onLanguageSwitch(retranslateNav);

/* --- Programmatic tab activation (e.g. the building header's jump button) - */
export function activateGroupTab(target) {
  bar.select(target, { silent: false });
}

/* --- Layout variables the rest of the app reads -------------------------- */
// --bottom-nav-height / --side-nav-width: how much room the bar takes (the
// page pads itself around it, and animates that padding: see style.css); --bn-tabbar-height / --bn-tabbar-outer-inset:
// the pill's own thickness and its clearance from the viewport edge, for
// campus-sheet.js's concentric corners and campus-map.css.
const barEl = root.querySelector('.lg-tabbar__bar');
function setNavSizeVars() {
  const style = document.documentElement.style;
  // Everything is measured before anything is published: a variable set
  // between two reads makes the second one lay the page out again, and this
  // runs on every frame the bar changes size.
  // Each of the two is published only while the bar is in the layout it
  // belongs to. While it moves between layouts the wrapper briefly measures as
  // the other one (a full-width row, or a tall rail); publishing that would
  // send the page's padding, which animates, towards a value it then abandons.
  const vertical = root.classList.contains('lg-tabbar--vertical');
  const navSize = vertical ? root.offsetWidth : root.offsetHeight;
  // offsetHeight, not getBoundingClientRect (which includes the squash-and-
  // stretch transform while the bar changes layout). Vitrium publishes the same
  // measurement as --lg-tabbar-height.
  const barHeight = barEl?.offsetHeight;
  const padLeft = parseFloat(getComputedStyle(root).paddingLeft);

  style.setProperty(vertical ? '--side-nav-width' : '--bottom-nav-height', `${navSize}px`);
  if (barEl) style.setProperty('--bn-tabbar-height', `${barHeight}px`);
  style.setProperty('--bn-tabbar-outer-inset', `${Number.isFinite(padLeft) ? padLeft : 28}px`);
  // campus-sheet.js builds its corners around these, so it needs to know.
  document.dispatchEvent(new Event('navsizechange'));
}
const navObserver = new ResizeObserver(setNavSizeVars);
navObserver.observe(root);
if (barEl) navObserver.observe(barEl);
setNavSizeVars();
