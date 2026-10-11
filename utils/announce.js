// Screen-reader announcements: one polite live region (#a11y-status in
// index.html, visually hidden). Clearing it first makes a repeated message
// get read again.

let timer = null;

export function announce(message) {
  const region = document.getElementById('a11y-status');
  if (!region || !message) return;
  region.textContent = '';
  clearTimeout(timer);
  timer = setTimeout(() => { region.textContent = message; }, 50);
}
