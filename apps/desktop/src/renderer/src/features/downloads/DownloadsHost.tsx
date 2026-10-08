import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/components/ui/button';
import { Dialog, DialogContent } from '@renderer/components/ui/dialog';
import { downloadStorageQuery, enqueueEpisodes } from '@renderer/lib/downloads';
import { useIpcEvent } from '@renderer/lib/ipc';
import { useDownloadsStore } from '@renderer/stores/downloads';
import { formatBytes } from './format';

/**
 * Always mounted (routes/__root.tsx): feeds the progress store from the `downloads.progress` event, and asks
 * whether to download although the size limit would be passed (DL-10), whichever page started the download.
 */
export function DownloadsHost() {
  const { t, i18n } = useTranslation();
  const receive = useDownloadsStore((state) => state.receive);
  const prompt = useDownloadsStore((state) => state.limitPrompt);
  const dismiss = useDownloadsStore((state) => state.dismissLimit);
  const { data: storage } = useQuery({ ...downloadStorageQuery, enabled: prompt !== null });
  useIpcEvent('downloads.progress', receive);

  const confirm = useCallback(() => {
    const ids = useDownloadsStore.getState().limitPrompt ?? [];
    dismiss();
    void enqueueEpisodes(ids, { force: true });
  }, [dismiss]);

  return (
    <Dialog open={prompt !== null} onOpenChange={(open) => !open && dismiss()}>
      <DialogContent
        title={t('downloads.limit.title')}
        description={t('downloads.limit.body', {
          count: prompt?.length ?? 0,
          limit: storage ? formatBytes(storage.limitBytes, i18n.language) : '',
          used: storage ? formatBytes(storage.usedBytes, i18n.language) : '',
        })}
        closeLabel={t('common.close')}
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={dismiss}>
            {t('common.cancel')}
          </Button>
          <Button onClick={confirm}>{t('downloads.limit.confirm')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
