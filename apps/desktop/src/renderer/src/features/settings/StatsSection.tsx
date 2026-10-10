import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@renderer/components/ConfirmDialog';
import { Button } from '@renderer/components/ui/button';
import { call } from '@renderer/lib/api';
import { describeError } from '@renderer/lib/errors';
import { notify } from '@renderer/lib/toast';
import { SettingRow } from './parts';

/** A row of the Clear data card: forgets the watch sessions behind Statistics (library, progress and history stay). */
export function WatchTimeRow() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const clear = useMutation({
    mutationFn: () => call('stats.clear'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['stats'] });
      notify.success(t('settings.data.statsCleared'));
    },
    onError: (error) => notify.error(t('settings.data.clearStatsFailed'), describeError(error, t)),
  });

  return (
    <SettingRow label={t('settings.data.watchTime')} hint={t('settings.data.watchTimeHint')}>
      <Button
        variant="destructive"
        size="sm"
        data-testid="clear-watch-time"
        disabled={clear.isPending}
        onClick={() => setConfirming(true)}
      >
        {t('settings.data.clearWatchTime')}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('settings.data.clearStatsTitle')}
        description={t('settings.data.clearStatsBody')}
        confirmLabel={t('settings.data.clearStatsConfirm')}
        onConfirm={() => clear.mutate()}
      />
    </SettingRow>
  );
}
