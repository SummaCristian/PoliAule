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

const icon = (name) => `<i class="hgi-stroke ${name}" aria-hidden="true"></i>`;

// A tab's id is the id of the panel it shows.
const TABS = [
  { id: 'available-classrooms-container', labelKey: 'tabs.available', icon: icon('hgi-calendar-03') },
  { id: 'search-classrooms-container', labelKey: 'tabs.campus', icon: icon('hgi-university') },
];
const SEARCH = { id: 'search', labelKey: 'tabs.search', icon: icon('hgi-search-01') };

const root = document.getElementById('bn-wrapper');
const contentContainers = document.querySelectorAll('.tab-content');

/* --- Tab-content switching ---------------------------------------------- */
function showContent(targetId) {
  contentContainers.forEach(container => {
    if (container.id === targetId) {
      requestAnimationFrame(() => {
        container.classList.add('visible');
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
    }
  });
}

function persist(targetId) {
  if (localStorage.getItem(DEFAULT_TAB_KEY) === 'last') {
    localStorage.setItem(LAST_TAB_KEY, targetId);
  }
}

/* --- The bar ------------------------------------------------------------- */
const startupId = getStartupTabId();
const startup = TABS.find(tab => tab.id === startupId) ?? TABS[0];

const bar = createTabBar(root, {
  label: 'Main navigation',
  value: startup.id,
  // `label` is a getter: Vitrium rebuilds a tab's button from this object when
  // the layout changes (a resize across the breakpoint), so it must read the
  // current translation then, not the one from when this module loaded.
  tabs: [
    ...TABS.map(({ id, labelKey, icon }) => ({ id, get label() { return t(labelKey); }, icon, panel: id })),
    { id: SEARCH.id, get label() { return t(SEARCH.labelKey); }, icon: SEARCH.icon, prominent: true, press: true, onPress: () => openSearchOverlay() },
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
export function retranslateNav() {
  for (const { id, labelKey } of [...TABS, SEARCH]) bar.setLabel(id, t(labelKey));
}
onLanguageSwitch(retranslateNav);

/* --- Programmatic tab activation (e.g. the building header's jump button) - */
export function activateGroupTab(target) {
  bar.select(target, { silent: false });
}

/* --- Layout variables the rest of the app reads -------------------------- */
// --bottom-nav-height / --side-nav-width: how much room the bar takes (the
// page pads itself around it); --bn-tabbar-height / --bn-tabbar-outer-inset:
// the pill's own thickness and its clearance from the viewport edge, for
// campus-sheet.js's concentric corners and campus-map.css.
const barEl = root.querySelector('.lg-tabbar__bar');
function setNavSizeVars() {
  const style = document.documentElement.style;
  style.setProperty('--bottom-nav-height', `${root.offsetHeight}px`);
  style.setProperty('--side-nav-width', `${root.offsetWidth}px`);
  // offsetHeight, not getBoundingClientRect: the latter includes the
  // squash-and-stretch transform Vitrium applies while the bar changes layout,
  // which leaves a stale mid-animation value once it settles.
  if (barEl) style.setProperty('--bn-tabbar-height', `${barEl.offsetHeight}px`);
  const padLeft = parseFloat(getComputedStyle(root).paddingLeft);
  style.setProperty('--bn-tabbar-outer-inset', `${Number.isFinite(padLeft) ? padLeft : 28}px`);
  // campus-sheet.js builds its corners around these, so it needs to know.
  document.dispatchEvent(new Event('navsizechange'));
}
const navObserver = new ResizeObserver(setNavSizeVars);
navObserver.observe(root);
if (barEl) navObserver.observe(barEl);
setNavSizeVars();
