import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@renderer/components/ConfirmDialog';
import { Button } from '@renderer/components/ui/button';
import { call } from '@renderer/lib/api';
import { describeError } from '@renderer/lib/errors';
import { notify } from '@renderer/lib/toast';
import { WatchTimeRow } from './StatsSection';
import { SettingRow, SettingsCard } from './parts';

/**
 * Settings → Data and storage: the Clear data card (mockup 10f). Watch history empties the History page only; watch
 * time forgets the sessions behind Statistics. The library, progress and the other half stay in both cases.
 */
export function ClearDataSection() {
  const { t } = useTranslation();
  return (
    <SettingsCard id="clear-data-title" title={t('settings.data.clearData')}>
      <HistoryRow />
      <WatchTimeRow />
    </SettingsCard>
  );
}

function HistoryRow() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const clear = useMutation({
    mutationFn: () => call('history.clear'),
    onSuccess: () => {
      // Main also announces `history` and `library` through db.changed; this keeps the page right without waiting.
      void queryClient.invalidateQueries({ queryKey: ['history'] });
      void queryClient.invalidateQueries({ queryKey: ['library'] });
      notify.success(t('settings.data.historyCleared'));
    },
    onError: (error) => notify.error(t('settings.data.clearHistoryFailed'), describeError(error, t)),
  });

  return (
    <SettingRow label={t('settings.data.watchHistory')} hint={t('settings.data.watchHistoryHint')}>
      <Button
        variant="destructive"
        size="sm"
        data-testid="clear-history"
        disabled={clear.isPending}
        onClick={() => setConfirming(true)}
      >
        {t('settings.data.clearHistory')}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('history.clearTitle')}
        description={t('history.clearBody')}
        confirmLabel={t('history.clearAll')}
        onConfirm={() => clear.mutate()}
      />
    </SettingRow>
  );
}
