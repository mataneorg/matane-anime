import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@renderer/components/ConfirmDialog';
import { Button } from '@renderer/components/ui/button';
import { call } from '@renderer/lib/api';
import { describeError } from '@renderer/lib/errors';
import { notify } from '@renderer/lib/toast';
import { SettingRow, SettingsCard } from './parts';

/** Settings → Data and storage: forgets the watch sessions behind Statistics (library, progress and history stay). */
export function StatsSection() {
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
    <SettingsCard
      id="stats-title"
      title={t('settings.data.statistics')}
      description={t('settings.data.statisticsHint')}
    >
      <SettingRow label={t('settings.data.clearStats')}>
        <Button variant="secondary" size="sm" disabled={clear.isPending} onClick={() => setConfirming(true)}>
          {t('settings.data.clearStats')}
        </Button>
      </SettingRow>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('settings.data.clearStatsTitle')}
        description={t('settings.data.clearStatsBody')}
        confirmLabel={t('settings.data.clearStatsConfirm')}
        onConfirm={() => clear.mutate()}
      />
    </SettingsCard>
  );
}
