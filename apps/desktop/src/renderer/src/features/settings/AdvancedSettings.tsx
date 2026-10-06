import type { ExtensionLogEntry } from '@matane-anime/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Select } from '@renderer/components/ui/select';
import { LoadFolderButton } from '@renderer/features/extensions/LoadFolderButton';
import { extensionLogsQuery, extensionsQuery } from '@renderer/lib/catalog';
import { useIpcEvent } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/utils';

const LEVEL_COLOR: Record<ExtensionLogEntry['level'], string> = {
  debug: 'text-muted-foreground',
  info: 'text-foreground',
  warn: 'text-warning',
  error: 'text-danger',
};

/** Settings → Advanced: the developer tools of docs/PRD.md EXT-10 (load a folder, read the extension's log). */
export function AdvancedSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: extensions = [] } = useQuery(extensionsQuery);
  const logs = useQuery(extensionLogsQuery());
  const [filter, setFilter] = useState('all');

  useIpcEvent(
    'extensions.log',
    useCallback(
      (entry) =>
        queryClient.setQueryData<ExtensionLogEntry[]>(extensionLogsQuery().queryKey, (old) =>
          [...(old ?? []), entry].slice(-1000),
        ),
      [queryClient],
    ),
  );
  const lines = useMemo(
    () => (logs.data ?? []).filter((entry) => filter === 'all' || entry.extensionId === filter),
    [logs.data, filter],
  );

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" aria-labelledby="developer-title">
        <h2 id="developer-title" className="text-[15px] leading-[22px] font-semibold">
          {t('settings.advanced.developer')}
        </h2>
        <p>{t('settings.advanced.loadHint')}</p>
        <div>
          <LoadFolderButton variant="secondary" />
        </div>
      </section>

      <section className="flex flex-col gap-3 border-t pt-5" aria-labelledby="logs-title">
        <div className="flex items-center justify-between gap-4">
          <h2 id="logs-title" className="text-[15px] leading-[22px] font-semibold">
            {t('settings.advanced.logs')}
          </h2>
          <Select
            aria-label={t('settings.advanced.logs')}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">{t('settings.advanced.allExtensions')}</option>
            {extensions
              .filter((extension) => extension.status === 'ready')
              .map((extension) => (
                <option key={extension.id} value={extension.id}>
                  {extension.name}
                </option>
              ))}
          </Select>
        </div>
        <div className="max-h-96 min-h-32 overflow-y-auto rounded-xl bg-card p-3 font-mono text-xs leading-5">
          {lines.length === 0 ? (
            <p>{t('settings.advanced.noLogs')}</p>
          ) : (
            lines.map((entry, index) => (
              <div key={index} className={cn('whitespace-pre-wrap', LEVEL_COLOR[entry.level])}>
                <span className="text-muted-foreground">{new Date(entry.at).toLocaleTimeString()}</span> [
                {entry.extensionId}] {entry.message}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
