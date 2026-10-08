import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, type ButtonProps } from '@renderer/components/ui/button';
import { Dialog, DialogContent } from '@renderer/components/ui/dialog';
import { call } from '@renderer/lib/api';
import { downloadStorageQuery } from '@renderer/lib/downloads';
import { describeError } from '@renderer/lib/errors';
import { settingsQuery } from '@renderer/lib/ipc';
import { notify } from '@renderer/lib/toast';

/**
 * Picks a folder for the downloads. When episodes are already downloaded it asks whether to move them along
 * (DL-6) before `downloads.changeFolder` does either.
 */
export function ChangeFolderButton({ variant = 'secondary', size = 'md', className }: ButtonProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<string | null>(null);

  const change = useMutation({
    mutationFn: (input: { folder: string; move: boolean }) => call('downloads.changeFolder', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: settingsQuery.queryKey });
      void queryClient.invalidateQueries({ queryKey: ['downloads'] });
      notify.success(t('downloads.folder.changed'));
    },
    onError: (error) => notify.error(t('downloads.folder.failed'), describeError(error, t)),
  });

  const choose = async (): Promise<void> => {
    const folder = await call('dialog.pickFolder');
    if (!folder) return;
    const storage = await queryClient.fetchQuery({ ...downloadStorageQuery, staleTime: 0 });
    if (storage.counts.done > 0) setPicked(folder);
    else change.mutate({ folder, move: false });
  };
  const answer = (move: boolean): void => {
    if (picked) change.mutate({ folder: picked, move });
    setPicked(null);
  };

  return (
    <>
      <Button
        variant={variant}
        size={size}
        className={className}
        disabled={change.isPending}
        onClick={() => void choose()}
      >
        {t('downloads.folder.change')}
      </Button>
      <Dialog open={picked !== null} onOpenChange={(open) => !open && setPicked(null)}>
        <DialogContent
          title={t('downloads.folder.moveTitle')}
          description={t('downloads.folder.moveBody')}
          closeLabel={t('common.close')}
        >
          <p className="mb-4 font-mono text-xs leading-4 break-all text-foreground">{picked}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPicked(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="secondary" onClick={() => answer(false)}>
              {t('downloads.folder.leave')}
            </Button>
            <Button onClick={() => answer(true)}>{t('downloads.folder.move')}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
