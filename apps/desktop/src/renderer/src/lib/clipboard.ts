import i18n from 'i18next';
import { notify } from './toast';

/** Puts `text` on the clipboard and says so; `what` names it in the toast ("Extension ID"). */
export async function copyText(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    notify.success(i18n.t('contextMenu.copied', { what }));
  } catch {
    notify.error(i18n.t('contextMenu.copyFailed', { what }));
  }
}
