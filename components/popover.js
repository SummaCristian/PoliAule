
// Popover library
import {
  computePosition,
  flip,
  shift,
  offset,
  arrow
} from "https://cdn.jsdelivr.net/npm/@floating-ui/dom@1/+esm";

const supportsAnchor = CSS.supports('anchor-name: --a');
let _anchorCounter = 0;

// All Popovers currently in the page
const allPopovers = [];

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
    const middleware = [
      offset(this.options.offset),
      flip(),
      shift({ padding: this.options.shiftPadding }),
    ];
    if (this.arrowEl) middleware.push(arrow({ element: this.arrowEl }));

    const { x, y, placement, middlewareData } = await computePosition(
      this.trigger,
      this.popover,
      { placement: this.options.placement, middleware }
    );

    Object.assign(this.popover.style, { left: `${x}px`, top: `${y}px` });

    if (this.arrowEl && middlewareData.arrow) {
      const { x: arrowX, y: arrowY } = middlewareData.arrow;
      const staticSide = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[placement.split('-')[0]];
      Object.assign(this.arrowEl.style, {
        left: arrowX != null ? `${arrowX}px` : '',
        top: arrowY != null ? `${arrowY}px` : '',
        [staticSide]: '-5px',
      });

      // Set transform-origin to point at the arrow
      const side = placement.split('-')[0];
      if (side === 'bottom' || side === 'top') {
        const originX = arrowX != null ? `${arrowX + 5}px` : '50%'; // +5 = half arrow width
        const originY = side === 'bottom' ? 'top' : 'bottom';
        this.popover.style.transformOrigin = `${originX} ${originY}`;
      } else {
        const originX = side === 'right' ? 'left' : 'right';
        const originY = arrowY != null ? `${arrowY + 5}px` : '50%';
        this.popover.style.transformOrigin = `${originX} ${originY}`;
      }
    }
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
    const triggerRect = this.trigger.getBoundingClientRect();
    // offsetWidth is a layout value — unaffected by transform: scale(0).
    const popoverWidth = this.popover.offsetWidth;

    // Vertical: if the trigger is in the lower half of the viewport the
    // --popover-above try fires and the popover appears above the trigger.
    const isAbove = triggerRect.top > window.innerHeight / 2;

    // Horizontal: the default placement is left: anchor(left), meaning the
    // popover's left edge aligns to the trigger's left edge. flip-inline
    // kicks in when that would push the popover off the right side of the
    // viewport, switching to right: anchor(right) instead.
    const flipsInline = triggerRect.left + popoverWidth > window.innerWidth - 8;

    // Express the trigger's centre as an offset from the popover's left edge:
    //   default     → trigger.left == popover.left  → centre = trigger.width / 2
    //   flip-inline → trigger.right == popover.right → centre = popoverWidth - trigger.width / 2
    const originX = flipsInline
      ? popoverWidth - triggerRect.width / 2
      : triggerRect.width / 2;

    this.popover.style.transformOrigin = `${originX}px ${isAbove ? 'bottom' : 'top'}`;

    if (this.arrowEl) {
      this.arrowEl.style.left = `${originX - 5}px`;
      if (isAbove) {
        this.arrowEl.style.top = 'auto';
        this.arrowEl.style.bottom = '-5px';
      } else {
        this.arrowEl.style.top = '-5px';
        this.arrowEl.style.bottom = 'auto';
      }
    }
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
