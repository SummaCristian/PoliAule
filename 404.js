// Entry of the static 404 page (404.html): the shared not-found view, in the
// app's language, over a button back to the app.
import { initLiquidGlass } from 'vitrium';
import { initI18n, t } from './i18n.js';
import { createNotFound } from './components/not-found.js';

initI18n().then(() => {
  document.title = `${t('notFound.title')} · PoliAule`;
  initLiquidGlass();
  document.getElementById('not-found-root').appendChild(createNotFound({
    onAction: () => location.assign('/'),
  }));
});
