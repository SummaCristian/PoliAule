
// Popover library
import {
  computePosition,
  flip,
  shift,
  offset,
  arrow
} from "https://cdn.jsdelivr.net/npm/@floating-ui/dom@1/+esm";

import { haptics, defaultPatterns } from './haptics.js';

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

  open() { this.popover.setAttribute('data-show', ''); this._updatePosition(); }
  close() { this.popover.removeAttribute('data-show'); }
  toggle() { this.popover.hasAttribute('data-show') ? this.close() : this.open(); }

  destroy() {
    this.trigger.removeEventListener('click', this._onClick);
    document.removeEventListener('click', this._onDocumentClick);
  }
}

// On page load finds all popover components and initializes them
document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('[data-popover]').forEach(trigger => {
    const popoverEl = document.getElementById(trigger.dataset.popover);
    if (popoverEl) new Popover(trigger, popoverEl);
  });
});