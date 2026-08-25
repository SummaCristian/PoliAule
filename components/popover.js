
// Popover library
import {
  computePosition,
  flip,
  shift,
  offset,
  arrow
} from "https://cdn.jsdelivr.net/npm/@floating-ui/dom@1/+esm";

export const supportsAnchor = CSS.supports('anchor-name: --a');
let _anchorCounter = 0;

// All Popovers currently in the page
const allPopovers = [];

// Shared positioning math used by both Popover (fixed trigger) and DynamicPopover
// (trigger reassigned at runtime, e.g. one popover reused across many hover targets).

async function computeFloatingPosition(trigger, popover, arrowEl, options) {
  const middleware = [
    offset(options.offset),
    flip(),
    shift({ padding: options.shiftPadding }),
  ];
  if (arrowEl) middleware.push(arrow({ element: arrowEl }));

  const { x, y, placement, middlewareData } = await computePosition(
    trigger,
    popover,
    { placement: options.placement, strategy: options.strategy ?? 'absolute', middleware }
  );

  Object.assign(popover.style, { left: `${x}px`, top: `${y}px` });

  if (arrowEl && middlewareData.arrow) {
    const { x: arrowX, y: arrowY } = middlewareData.arrow;
    const staticSide = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[placement.split('-')[0]];
    Object.assign(arrowEl.style, {
      left: arrowX != null ? `${arrowX}px` : '',
      top: arrowY != null ? `${arrowY}px` : '',
      [staticSide]: '-5px',
    });

    // Set transform-origin to point at the arrow
    const side = placement.split('-')[0];
    if (side === 'bottom' || side === 'top') {
      const originX = arrowX != null ? `${arrowX + 5}px` : '50%'; // +5 = half arrow width
      const originY = side === 'bottom' ? 'top' : 'bottom';
      popover.style.transformOrigin = `${originX} ${originY}`;
      popover.style.setProperty('--popover-closed-ty', side === 'bottom' ? '-6px' : '6px');
    } else {
      const originX = side === 'right' ? 'left' : 'right';
      const originY = arrowY != null ? `${arrowY + 5}px` : '50%';
      popover.style.transformOrigin = `${originX} ${originY}`;
      popover.style.setProperty('--popover-closed-ty', '0px');
    }
  }
}

// When CSS anchor positioning handles placement, floating-ui is skipped but we
// still need to point the arrow and set transform-origin toward the trigger.
// We only need the trigger's rect — no async call required.
function updateAnchorOriginAndArrow(trigger, popover, arrowEl) {
  const triggerRect = trigger.getBoundingClientRect();
  // offsetWidth is a layout value — unaffected by transform: scale(0).
  const popoverWidth = popover.offsetWidth;

  // Vertical: if the trigger is in the lower half of the viewport the
  // --popover-above try fires and the popover appears above the trigger.
  const isAbove = triggerRect.top > window.innerHeight / 2;

  // Horizontal: the default placement is right: anchor(right), meaning the
  // popover's right edge aligns to the trigger's right edge (natural for
  // right-side triggers). flip-inline kicks in when that would push the
  // popover off the left side of the viewport, switching to left: anchor(left).
  const flipsInline = triggerRect.right - popoverWidth < 8;

  // Express the trigger's centre as an offset from the popover's left edge:
  //   default     → trigger.right == popover.right → centre = popoverWidth - trigger.width / 2
  //   flip-inline → trigger.left == popover.left   → centre = trigger.width / 2
  const originX = flipsInline
    ? triggerRect.width / 2
    : popoverWidth - triggerRect.width / 2;

  popover.style.transformOrigin = `${originX}px ${isAbove ? 'bottom' : 'top'}`;
  popover.style.setProperty('--popover-closed-ty', isAbove ? '6px' : '-6px');

  if (arrowEl) {
    arrowEl.style.left = `${originX - 5}px`;
    if (isAbove) {
      arrowEl.style.top = 'auto';
      arrowEl.style.bottom = '-5px';
    } else {
      arrowEl.style.top = '-5px';
      arrowEl.style.bottom = 'auto';
    }
  }
}

// Implements a Popover component
export class Popover {
  constructor(triggerEl, popoverEl, options = {}) {
    this.trigger = triggerEl;
    this.popover = popoverEl;
    this.arrowEl = popoverEl.querySelector('#arrow, [data-arrow]');
    this.options = {
      placement: 'bottom',
      offset: 8,
      shiftPadding: 8,
      ...options
    };

    this._onClick = this._onClick.bind(this);
    this._onDocumentClick = this._onDocumentClick.bind(this);

    this.trigger.addEventListener('click', this._onClick);
    document.addEventListener('click', this._onDocumentClick);

    if (supportsAnchor) {
      const name = `--popover-${_anchorCounter++}`;
      this.trigger.style.anchorName = name;
      this.popover.style.positionAnchor = name;
    }

    allPopovers.push(this);
  }

  async _updatePosition() {
    await computeFloatingPosition(this.trigger, this.popover, this.arrowEl, this.options);
  }

  _onClick(e) {
    e.stopPropagation();
    const isOpen = this.popover.hasAttribute('data-show');

    // Close all others
    allPopovers.forEach(p => p !== this && p.close());

    // Toggle this one
    isOpen ? this.close() : this.open();
  }

  // Hides the popover when clicking outside of it
  _onDocumentClick(e) {
    if (!this.popover.contains(e.target) && !this.trigger.contains(e.target)) {
      this.popover.removeAttribute('data-show');
    }
  }

  // When CSS anchor positioning handles placement, floating-ui is skipped but we
  // still need to point the arrow and set transform-origin toward the trigger.
  // We only need the trigger's rect — no async call required.
  _updateAnchorOriginAndArrow() {
    updateAnchorOriginAndArrow(this.trigger, this.popover, this.arrowEl);
  }

  open() {
    this.popover.setAttribute('data-show', '');
    if (supportsAnchor) {
      this._updateAnchorOriginAndArrow();
    } else {
      this._updatePosition();
    }
  }
  close() { this.popover.removeAttribute('data-show'); }
  toggle() { this.popover.hasAttribute('data-show') ? this.close() : this.open(); }

  destroy() {
    this.trigger.removeEventListener('click', this._onClick);
    document.removeEventListener('click', this._onDocumentClick);
  }
}

// A popover whose trigger element isn't fixed at construction time — e.g. one
// popover reused across many dynamically-generated hover/tap targets (like
// timeline occupation blocks), where creating a Popover instance per target
// would mean binding a permanent click listener and anchor-name per element.
// The caller owns the gesture (hover, click, focus, ...) and calls show()/hide().
//
// This always positions via floating-ui rather than CSS anchor positioning.
// The generic .popover anchor-positioning CSS in style.css hardcodes a single
// fixed direction (below, right-aligned) with position-try-fallbacks that only
// kick in on actual viewport overflow — fine for the static header popovers it
// was built for, but wrong for a tooltip that should default to a specific side
// (e.g. above a timeline block) and flip based on real available space. Using
// floating-ui uniformly means flip()'s resolved `placement` always matches what
// actually got applied, so the arrow never points the wrong way.
export class DynamicPopover {
  constructor(popoverEl, options = {}) {
    this.popover = popoverEl;
    this.arrowEl = popoverEl.querySelector('#arrow, [data-arrow]');
    this.trigger = null;
    this.options = {
      placement: 'top',
      offset: 8,
      shiftPadding: 8,
      strategy: 'fixed',
      ...options
    };
  }

  show(triggerEl) {
    this.trigger = triggerEl;
    computeFloatingPosition(this.trigger, this.popover, this.arrowEl, this.options);
    this.popover.setAttribute('data-show', '');
  }

  hide() {
    this.popover.removeAttribute('data-show');
    this.trigger = null;
  }
}

// Close all popovers on scroll — only needed as a fallback when anchor positioning
// isn't available, since position-visibility: anchors-visible handles it natively.
if (!supportsAnchor) {
  window.addEventListener('scroll', () => {
    allPopovers.forEach(p => p.close());
  }, { capture: true, passive: true });
}

// On page load finds all popover components and initializes them
document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('[data-popover]').forEach(trigger => {
    const popoverEl = document.getElementById(trigger.dataset.popover);
    if (!popoverEl) return;
    const options = {};
    if (trigger.dataset.popoverShiftPadding !== undefined)
      options.shiftPadding = Number(trigger.dataset.popoverShiftPadding);
    if (trigger.dataset.popoverPlacement !== undefined)
      options.placement = trigger.dataset.popoverPlacement;
    new Popover(trigger, popoverEl, options);
  });
});
