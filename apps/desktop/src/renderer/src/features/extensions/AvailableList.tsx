import type { AvailableExtension } from '@matane-anime/shared';
import { useMutation } from '@tanstack/react-query';
import { ArrowUpCircle, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { call } from '@renderer/lib/api';
import { describeError } from '@renderer/lib/errors';
import { notify } from '@renderer/lib/toast';
import { ExtensionIcon, LangBadges, TrustLine } from './parts';
import { availableState, formatSize, sortAvailable } from './helpers';

type InstallRequest = { repoId: number; extensionId: string; name: string };

/** The Available tab: what the repositories offer, with Install, Update or the reason there is no button. */
export function AvailableList({
  entries,
  onInstall,
}: {
  entries: AvailableExtension[];
  onInstall: (target: InstallRequest) => void;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {sortAvailable(entries).map((entry) => (
        <AvailableRow key={`${entry.repoId}/${entry.id}`} entry={entry} onInstall={onInstall} />
      ))}
    </ul>
  );
}

function AvailableRow({
  entry,
  onInstall,
}: {
  entry: AvailableExtension;
  onInstall: (target: InstallRequest) => void;
}) {
  const { t } = useTranslation();
  const state = availableState(entry);
  const update = useMutation({
    mutationFn: () => call('extensions.update', { extensionId: entry.id }),
    onSuccess: () => notify.success(t('extensions.toast.updated', { name: entry.name })),
    onError: (error) => notify.error(t('extensions.toast.updateFailed', { name: entry.name }), describeError(error, t)),
  });

  const note =
    state.kind === 'incompatible'
      ? t(`extensions.incompatible.${state.reason}`)
      : state.kind === 'conflict'
        ? state.with.kind === 'dev'
          ? t('extensions.conflict.dev')
          : t('extensions.conflict.repo', { repo: state.with.name ?? t('extensions.conflict.another') })
        : null;

  return (
    <li className="rounded-xl border bg-card/40 px-4 py-3.5" data-testid={`available-${entry.id}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ExtensionIcon id={entry.id} name={entry.name} className="size-11" />
        <div className="min-w-56 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{entry.name}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {state.kind === 'update' && entry.installedVersion
                ? `${entry.installedVersion} → ${entry.version}`
                : entry.version}
            </span>
            <LangBadges langs={entry.langs} />
            {entry.nsfw ? <Badge variant="danger">18+</Badge> : null}
            {state.kind === 'update' ? (
              <Badge variant="primary">{t('extensions.updateTo', { version: entry.version })}</Badge>
            ) : null}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-2 text-xs">
            <TrustLine trust={entry.repoTrust} repoName={entry.repoName} />
            <span aria-hidden className="text-muted-foreground">
              ·
            </span>
            <span className="min-w-0 truncate text-muted-foreground">{formatSize(entry.size)}</span>
          </div>
        </div>
        <div className="ml-auto shrink-0">
          {state.kind === 'update' ? (
            <Button
              size="sm"
              aria-label={t('extensions.updateOf', { name: entry.name })}
              disabled={update.isPending}
              onClick={() => update.mutate()}
            >
              <ArrowUpCircle aria-hidden />
              {update.isPending ? t('extensions.updating') : t('extensions.update')}
            </Button>
          ) : state.kind === 'installed' ? (
            <Badge>{t('extensions.installed')}</Badge>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              aria-label={t('extensions.installOf', { name: entry.name })}
              disabled={state.kind !== 'install'}
              onClick={() => onInstall({ repoId: entry.repoId, extensionId: entry.id, name: entry.name })}
            >
              <Download aria-hidden />
              {t('extensions.install')}
            </Button>
          )}
        </div>
      </div>
      {note ? <p className="mt-2 pl-15 text-xs text-muted-foreground">{note}</p> : null}
    </li>
  );
}
