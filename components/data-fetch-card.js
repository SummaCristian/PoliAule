import { createMorphPopup, attachLiquidGlass } from 'vitrium';

// The header's data-fetch indicator button morphs into a glass card holding the
// freshness status + reload button, and back: Vitrium's morph popup, with the
// button as its trigger. Unlike the pickers there is no title bar, so the whole
// card takes the press / drag deform.
//
// script.js keeps ownership of #data-fetch-indicator-popover-container's
// contents (setupDataFetchIndicatorText); this file only relocates that
// container into the card.

function init() {
  const trigger = document.getElementById('data-fetch-btn');
  const container = document.getElementById('data-fetch-indicator-popover-container');
  if (!trigger || !container) return;

  const popup = createMorphPopup({ trigger, role: 'dialog', label: trigger.getAttribute('aria-label') ?? '', width: 20 * 16 });
  popup.inner.appendChild(container);
  attachLiquidGlass(popup.panel);
  trigger.addEventListener('click', () => popup.toggle());

  // The reload button is rebuilt by setupDataFetchIndicatorText each render;
  // close the card whenever a click inside it lands on that button.
  popup.inner.addEventListener('click', (e) => {
    if (e.target.closest('#reload-data-btn')) popup.close();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
