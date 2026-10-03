// Offline support. The service worker (generated at build time by
// vite-plugin-pwa, see vite.config.js) precaches the app shell, so the app
// opens with no connection at all and draws from the data cache kept by
// available-rooms-script.js. API requests pass through it untouched.
//
// A new deploy installs in the background and then waits: switching to it
// reloads the page, so the user is asked first. Saying no is fine, it takes
// over by itself the next time the app is opened from scratch.
import { registerSW } from 'virtual:pwa-register';
import { createAlert } from 'vitrium';
import { t } from '../i18n.js';

// An app opened from the home screen can stay alive for days without a navigation
const UPDATE_CHECK_MS = 60 * 60 * 1000;

let prompting = false;

export function initServiceWorker() {
  const updateSW = registerSW({
    onNeedRefresh: () => promptUpdate(updateSW),
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      setInterval(() => registration.update().catch(() => {}), UPDATE_CHECK_MS);
    },
  });
}

async function promptUpdate(updateSW) {
  if (prompting) return;
  prompting = true;
  const alert = createAlert({
    title: t('update.title'),
    message: t('update.message'),
    actions: [
      { id: 'later', label: t('update.later'), role: 'cancel' },
      { id: 'reload', label: t('update.reload'), role: 'default' },
    ],
  });
  const choice = await alert.present();
  setTimeout(() => alert.destroy(), 600);
  prompting = false;
  if (choice === 'reload') updateSW(true); // activates the waiting worker, then reloads
}
