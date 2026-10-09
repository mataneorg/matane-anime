import type { ExtensionLogEntry } from '@matane-anime/shared';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Eraser } from 'lucide-react';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/components/ui/button';
import { Dialog, DialogContent } from '@renderer/components/ui/dialog';
import { Segmented } from '@renderer/components/ui/segmented';
import { call } from '@renderer/lib/api';
import { extensionsQuery } from '@renderer/lib/catalog';
import { useIpcEvent } from '@renderer/lib/ipc';
import { notify } from '@renderer/lib/toast';
import { cn } from '@renderer/lib/utils';
import { type LogLevel, logLines, logText, mergeLogs } from '../settings/logs';

/** The level filter shows this level and everything worse. */
const FILTERS = ['all', 'info', 'warn', 'error'] as const;
type Filter = (typeof FILTERS)[number];
const LEVELS_FOR: Record<Filter, readonly LogLevel[]> = {
  all: ['debug', 'info', 'warn', 'error'],
  info: ['info', 'warn', 'error'],
  warn: ['warn', 'error'],
  error: ['error'],
};
const LEVEL_CLASS: Record<LogLevel, string> = {
  debug: 'text-muted-foreground',
  info: 'text-info-text',
  warn: 'text-warning-text',
  error: 'text-danger-text',
};
/** The log keeps this many lines per extension (main keeps its own copy). */
const KEEP = 500;

/**
 * One extension's log (mockup 09 "View logs"): its own `log.*` lines, failed calls and requests, new lines arriving
 * live. Clear hides what was logged so far in this window; main keeps its own copy.
 */
export function LogDialog({
  extensionId,
  name,
  open,
  onOpenChange,
}: {
  extensionId: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('extensions.logs.title', { name })}
        description={t('extensions.logs.description')}
        closeLabel={t('common.close')}
        className="h-[min(40rem,85vh)] w-[min(56rem,calc(100vw-48px))]"
      >
        {open ? <LogBody extensionId={extensionId} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function LogBody({ extensionId }: { extensionId: string }) {
  const { t, i18n } = useTranslation();
  // Read again every time the dialog opens (the log changes while it is closed). Lines that arrive live are kept
  // from the moment the dialog mounts, so none is lost while the list is being fetched; `mergeLogs` joins the two.
  const { data: fetched } = useQuery({
    queryKey: ['extension-log-dialog', extensionId],
    queryFn: () => call('extensions.logs', { extensionId }),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const { data: extensions = [] } = useQuery(extensionsQuery);
  const [live, setLive] = useState<ExtensionLogEntry[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [clearedAt, setClearedAt] = useState(0);
  const [copied, setCopied] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const atEnd = useRef(true);

  useIpcEvent(
    'extensions.log',
    useCallback(
      (entry: ExtensionLogEntry) => {
        if (entry.extensionId === extensionId) setLive((old) => [...old, entry].slice(-KEEP));
      },
      [extensionId],
    ),
  );

  const entries = useMemo(() => mergeLogs(fetched ?? [], live, KEEP), [fetched, live]);
  const lines = useMemo(
    () => logLines(entries, extensions, { extensionId, levels: new Set(LEVELS_FOR[filter]), clearedAt }),
    [entries, extensions, extensionId, filter, clearedAt],
  );

  // Follow new lines while the list is scrolled to its end.
  useLayoutEffect(() => {
    if (atEnd.current && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [lines.length]);

  const copy = (): void => {
    navigator.clipboard.writeText(logText(lines)).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => notify.error(t('extensions.logs.copyFailed')),
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label={t('extensions.logs.filter')}
          options={FILTERS}
          value={filter}
          onChange={setFilter}
          format={(value) => t(`extensions.logs.levels.${value}`)}
        />
        <span className="flex-1" />
        <Button variant="secondary" size="sm" onClick={copy} disabled={lines.length === 0}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? t('extensions.logs.copied') : t('extensions.logs.copy')}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setClearedAt(Date.now())} disabled={lines.length === 0}>
          <Eraser aria-hidden />
          {t('extensions.logs.clear')}
        </Button>
      </div>
      {lines.length === 0 ? (
        <p className="flex min-h-40 flex-1 items-center justify-center rounded-lg border bg-background p-8 text-muted-foreground">
          {t('extensions.logs.empty')}
        </p>
      ) : (
        <ol
          ref={list}
          aria-label={t('extensions.logs.lines')}
          data-testid="extension-log"
          onScroll={(event) => {
            const element = event.currentTarget;
            atEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
          }}
          className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-background p-3 font-mono text-xs leading-5 select-text"
        >
          {lines.map((line, index) => (
            <li key={index} className="flex gap-3 break-all whitespace-pre-wrap">
              <span className="shrink-0 text-muted-foreground">
                {line.at === null ? '' : new Date(line.at).toLocaleTimeString(i18n.language, { hour12: false })}
              </span>
              <span className={cn('w-12 shrink-0 font-semibold uppercase', LEVEL_CLASS[line.level])}>{line.level}</span>
              <span className="min-w-0">{line.message}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
