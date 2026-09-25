// Dialogs for the device transfer (logic in utils/transfer.js):
// - openTransferDialog(): Settings' "show QR" dialog on the sending device.
// - promptImport(): on the receiving device, after it was opened from the link.
import { createAlert } from 'vitrium';
import { t } from '../i18n.js';
import { getFavouriteIds } from '../utils/favourites.js';
import { renderQrSvg } from '../utils/qr.js';
import { buildTransferUrl, parseTransfer, applyTransfer } from '../utils/transfer.js';

// The QR's look. Any renderQrSvg() option (utils/qr.js) can go here; colours
// can also be themed from CSS via --qr-fg / --qr-finder / --qr-bg.
const QR_STYLE = {
  moduleShape: 'rounded',
  finderShape: 'rounded',
  logo: '/favicons/main/favicon.svg',
};

const Z_ABOVE_SETTINGS = 1300; // the settings popup sits at 1200

// Presents a one-off alert and tears it down once it has animated out.
async function presentOnce(options, from) {
  const alert = createAlert({ zIndex: Z_ABOVE_SETTINGS, ...options });
  const result = await alert.present({ from });
  setTimeout(() => alert.destroy(), 600);
  return result;
}

export async function openTransferDialog(from) {
  const url = buildTransferUrl();

  const content = document.createElement('div');
  content.className = 'transfer-dialog';
  const qr = document.createElement('div');
  qr.className = 'transfer-dialog__qr';
  qr.innerHTML = renderQrSvg(url, QR_STYLE); // all inputs are ours; see utils/qr.js
  qr.querySelector('svg').setAttribute('aria-label', t('transfer.qrLabel'));
  const status = document.createElement('p');
  status.className = 'transfer-dialog__status';
  status.setAttribute('aria-live', 'polite');
  content.append(qr, status);

  const copyLink = async () => {
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: 'PoliAule', url });
        return;
      }
      await navigator.clipboard.writeText(url);
      status.textContent = t('transfer.copied');
    } catch (e) {
      if (e?.name !== 'AbortError') status.textContent = t('transfer.copyFailed');
    }
  };

  await presentOnce({
    title: t('transfer.title'),
    message: t('transfer.message'),
    content,
    transition: 'morph',
    actions: [
      { id: 'copy', label: t('transfer.copyLink'), dismiss: false, onClick: copyLink },
      { id: 'done', label: t('transfer.done'), role: 'cancel' },
    ],
  }, from);
}

// Asks before importing a transfer link's payload, then reloads so every
// setting is picked up (most are only read at start-up).
export async function promptImport(raw, classroomsData) {
  const parsed = parseTransfer(raw, classroomsData);
  if (!parsed) {
    await presentOnce({
      title: t('import.invalidTitle'),
      message: t('import.invalidMessage'),
      actions: [{ id: 'ok', label: t('transfer.done'), role: 'default' }],
    });
    return;
  }

  const favCount = parsed.favourites.length;
  const settingsCount = Object.keys(parsed.settings).length;
  const parts = [];
  if (favCount) parts.push(t(favCount === 1 ? 'import.favouritesOne' : 'import.favouritesMany').replace('{n}', favCount));
  if (settingsCount) parts.push(t(settingsCount === 1 ? 'import.settingsOne' : 'import.settingsMany').replace('{n}', settingsCount));
  const summary = t('import.message').replace('{summary}', parts.join(t('import.and')));

  // Merge vs Replace only matters when both devices have favourites.
  const hasLocalFavs = getFavouriteIds().length > 0;
  const actions = favCount && hasLocalFavs
    ? [
        { id: 'merge', label: t('import.merge'), role: 'default' },
        { id: 'replace', label: t('import.replace'), role: 'destructive' },
        { id: 'cancel', label: t('import.cancel'), role: 'cancel' },
      ]
    : [
        { id: 'cancel', label: t('import.cancel'), role: 'cancel' },
        { id: 'merge', label: t('import.import'), role: 'default' },
      ];

  const choice = await presentOnce({
    title: t('import.title'),
    message: favCount && hasLocalFavs ? `${summary} ${t('import.mergeHint')}` : summary,
    actions,
  });
  if (choice !== 'merge' && choice !== 'replace') return;

  applyTransfer(parsed, { favouritesMode: choice });
  location.reload();
}
