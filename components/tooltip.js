const tip = document.createElement('div');
tip.className = 'app-tooltip';
document.body.appendChild(tip);

let hideTimer = null;

document.addEventListener('mouseenter', e => {
  const el = e.target.closest('[data-tooltip]');
  if (!el) return;

  clearTimeout(hideTimer);
  tip.textContent = el.dataset.tooltip;
  tip.classList.add('app-tooltip--visible');

  const rect = el.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();

  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  const top = rect.top - tipRect.height - 6 + window.scrollY;

  left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));

  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}, true);

document.addEventListener('mouseleave', e => {
  if (!e.target.closest('[data-tooltip]')) return;
  hideTimer = setTimeout(() => tip.classList.remove('app-tooltip--visible'), 80);
}, true);
