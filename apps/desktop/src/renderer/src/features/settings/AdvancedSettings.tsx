import type { ExtensionLogEntry } from '@matane-anime/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Eraser } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/components/ui/button';
import { Select } from '@renderer/components/ui/select';
import { Switch } from '@renderer/components/ui/switch';
import { LoadFolderButton } from '@renderer/features/extensions/LoadFolderButton';
import { extensionLogsQuery, extensionsQuery } from '@renderer/lib/catalog';
import { settingsQuery, useIpcEvent, useUpdateSettings } from '@renderer/lib/ipc';
import { notify } from '@renderer/lib/toast';
import { cn } from '@renderer/lib/utils';
import { type LogLine, LEVELS, logLines, logText } from './logs';

const LEVEL_COLOR: Record<ExtensionLogEntry['level'], string> = {
  debug: 'text-muted-foreground',
  info: 'text-foreground',
  warn: 'text-warning-text',
  error: 'text-danger-text',
};

/** Settings → Advanced: Developer mode and, with it on, the tools of docs/PRD.md EXT-10. */
export function AdvancedSettings() {
  const { t } = useTranslation();
  const { data: settings } = useQuery(settingsQuery);
  const update = useUpdateSettings();
  if (!settings) return null;

  return (
    <div className="flex max-w-[880px] flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-xl border bg-card/40 p-5" aria-labelledby="developer-title">
        <h2 id="developer-title" className="text-sm font-semibold">
          {t('settings.advanced.developer')}
        </h2>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <label htmlFor="dev-mode" className="block font-medium">
              {t('settings.advanced.devMode')}
            </label>
            <div className="text-xs leading-4 text-muted-foreground">{t('settings.advanced.devModeHint')}</div>
          </div>
          <Switch id="dev-mode" checked={settings.devMode} onCheckedChange={(devMode) => update.mutate({ devMode })} />
        </div>
        {settings.devMode ? (
          <>
            <p>{t('settings.advanced.loadHint')}</p>
            <div>
              <LoadFolderButton variant="secondary" />
            </div>
          </>
        ) : null}
      </section>
      {settings.devMode ? <LogPanel /> : null}
    </div>
  );
}

/** The extensions' log with a level filter, clear (only here, main keeps its own), copy, and load errors as lines. */
function LogPanel() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: extensions = [] } = useQuery(extensionsQuery);
  const logs = useQuery(extensionLogsQuery());
  const [filter, setFilter] = useState('all');
  const [levels, setLevels] = useState<ReadonlySet<ExtensionLogEntry['level']>>(new Set(LEVELS));
  const [clearedAt, setClearedAt] = useState(0);

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
    () => logLines(logs.data ?? [], extensions, { extensionId: filter, levels, clearedAt }),
    [logs.data, extensions, filter, levels, clearedAt],
  );

  const toggle = (level: ExtensionLogEntry['level']): void =>
    setLevels((current) => {
      const next = new Set(current);
      if (!next.delete(level)) next.add(level);
      return next;
    });
  const copy = (): void => {
    navigator.clipboard.writeText(logText(lines)).then(
      () => notify.success(t('settings.advanced.copied')),
      () => notify.error(t('settings.advanced.copyFailed')),
    );
  };

  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card/40 p-5" aria-labelledby="logs-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="logs-title" className="text-sm font-semibold">
          {t('settings.advanced.logs')}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            aria-label={t('settings.advanced.logsOf')}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <option value="all">{t('settings.advanced.allExtensions')}</option>
            {extensions.map((extension) => (
              <option key={extension.key} value={extension.id}>
                {extension.name}
              </option>
            ))}
          </Select>
          <Button variant="secondary" size="sm" onClick={copy} disabled={lines.length === 0}>
            <Copy className="size-3.5" strokeWidth={1.75} aria-hidden />
            {t('settings.advanced.copy')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setClearedAt(Date.now())} disabled={lines.length === 0}>
            <Eraser className="size-3.5" strokeWidth={1.75} aria-hidden />
            {t('settings.advanced.clear')}
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('settings.advanced.levels')}>
        {LEVELS.map((level) => (
          <button
            key={level}
            type="button"
            aria-pressed={levels.has(level)}
            onClick={() => toggle(level)}
            className={cn(
              'h-7 rounded-full border border-input px-3 text-xs leading-4 transition-colors',
              levels.has(level) && 'border-primary bg-primary/15 font-semibold text-foreground',
            )}
          >
            {t(`settings.advanced.level.${level}`)}
          </button>
        ))}
      </div>
      <div
        className="max-h-96 min-h-32 overflow-y-auto rounded-lg border bg-background p-3 font-mono text-xs leading-5"
        data-testid="log-panel"
      >
        {lines.length === 0 ? (
          <p>{t('settings.advanced.noLogs')}</p>
        ) : (
          lines.map((line, index) => <Line key={index} line={line} />)
        )}
      </div>
    </section>
  );
}

function Line({ line }: { line: LogLine }) {
  return (
    <div className={cn('whitespace-pre-wrap', LEVEL_COLOR[line.level])}>
      {line.at === null ? null : (
        <>
          <span className="text-muted-foreground">{new Date(line.at).toLocaleTimeString()}</span>{' '}
        </>
      )}
      [{line.source}] {line.message}
    </div>
  );
}
