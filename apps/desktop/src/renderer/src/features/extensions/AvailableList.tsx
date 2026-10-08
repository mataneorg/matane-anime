import type { AvailableExtension } from '@matane-anime/shared';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { call } from '@renderer/lib/api';
import { describeError } from '@renderer/lib/errors';
import { notify } from '@renderer/lib/toast';
import { TrustBadge } from './TrustBadge';
import { availableState, formatSize, hue, sortAvailable } from './helpers';

/** The Available tab: what the repositories offer, with Install, Update or the reason there is no button. */
export function AvailableList({
  entries,
  onInstall,
}: {
  entries: AvailableExtension[];
  onInstall: (target: { repoId: number; extensionId: string; name: string }) => void;
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
  onInstall: (target: { repoId: number; extensionId: string; name: string }) => void;
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
  const meta = [
    entry.langs.map((lang) => lang.toUpperCase()).join(', '),
    formatSize(entry.size),
    entry.repoName,
  ].filter(Boolean);

  return (
    <li className="flex flex-col gap-1 rounded-xl bg-card p-4" data-testid={`available-${entry.id}`}>
      <div className="flex items-center gap-4">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-lg font-bold text-black"
          style={{ background: `hsl(${hue(entry.id)} 65% 75%)` }}
        >
          {entry.name.charAt(0).toUpperCase()}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold text-foreground">{entry.name}</span>
            <span className="font-mono text-xs leading-4">{entry.version}</span>
            {entry.nsfw ? <Badge tone="warning">18+</Badge> : null}
            {state.kind === 'update' ? (
              <Badge tone="accent">{t('extensions.updateTo', { version: entry.version })}</Badge>
            ) : null}
          </div>
          <span className="truncate text-xs leading-4">{meta.join(' · ')}</span>
        </div>
        <TrustBadge trust={entry.repoTrust} />
        {state.kind === 'install' ? (
          <Button
            variant="secondary"
            size="sm"
            aria-label={t('extensions.installOf', { name: entry.name })}
            onClick={() => onInstall({ repoId: entry.repoId, extensionId: entry.id, name: entry.name })}
          >
            {t('extensions.install')}
          </Button>
        ) : state.kind === 'update' ? (
          <Button
            variant="secondary"
            size="sm"
            aria-label={t('extensions.updateOf', { name: entry.name })}
            disabled={update.isPending}
            onClick={() => update.mutate()}
          >
            {update.isPending ? t('extensions.updating') : t('extensions.update')}
          </Button>
        ) : state.kind === 'installed' ? (
          <Badge>{t('extensions.installed')}</Badge>
        ) : (
          <Button variant="secondary" size="sm" disabled aria-label={t('extensions.installOf', { name: entry.name })}>
            {t('extensions.install')}
          </Button>
        )}
      </div>
      {note ? <p className="pl-14 text-xs leading-4">{note}</p> : null}
    </li>
  );
}
