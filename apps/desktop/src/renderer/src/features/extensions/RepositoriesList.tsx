import type { RepoInfo } from '@matane-anime/shared';
import { useMutation } from '@tanstack/react-query';
import { RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@renderer/components/ConfirmDialog';
import { Button } from '@renderer/components/ui/button';
import { call } from '@renderer/lib/api';
import { relativeTime } from '@renderer/lib/dates';
import { describeError } from '@renderer/lib/errors';
import { notify } from '@renderer/lib/toast';
import { useNow } from '@renderer/lib/useNow';
import { TrustBadge } from './TrustBadge';
import { sortRepos } from './helpers';

/** The Repositories tab: where extensions come from, how far each is trusted and when it was last read. */
export function RepositoriesList({ repos }: { repos: RepoInfo[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {sortRepos(repos).map((repo) => (
        <RepoRow key={repo.id} repo={repo} />
      ))}
    </ul>
  );
}

function RepoRow({ repo }: { repo: RepoInfo }) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const [confirming, setConfirming] = useState(false);
  const name = repo.name ?? repo.url;

  const refresh = useMutation({
    mutationFn: () => call('repos.refresh', { id: repo.id }),
    onSuccess: (result) =>
      result.failed.length > 0
        ? notify.error(t('extensions.toast.repoFailed', { name }), result.failed[0]?.message)
        : notify.success(t('extensions.toast.repoRefreshed', { name })),
    onError: (error) => notify.error(t('extensions.toast.repoFailed', { name }), describeError(error, t)),
  });
  const trust = useMutation({
    mutationFn: (trusted: boolean) => call('repos.setTrust', { id: repo.id, trusted }),
    onError: (error) => notify.error(t('extensions.toast.trustFailed', { name }), describeError(error, t)),
  });
  const remove = useMutation({
    mutationFn: () => call('repos.remove', { id: repo.id }),
    onSuccess: () => notify.success(t('extensions.toast.repoRemoved', { name })),
    onError: (error) => notify.error(t('extensions.toast.repoRemoveFailed', { name }), describeError(error, t)),
  });

  return (
    <li
      className="flex flex-col gap-2 rounded-xl border bg-card/40 px-4 py-3.5 transition-colors hover:border-input hover:bg-card/70"
      data-testid={`repo-${repo.id}`}
    >
      <div className="flex items-center gap-4">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-semibold text-foreground">{name}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">
            {repo.url}
            {' · '}
            {repo.fingerprint ?? t('extensions.unsignedMark')}
          </span>
        </div>
        <TrustBadge trust={repo.trust} short />
        {repo.trust === 'unverified' ? (
          <Button variant="secondary" size="sm" disabled={trust.isPending} onClick={() => trust.mutate(true)}>
            {t('extensions.trustKey')}
          </Button>
        ) : repo.trust === 'trusted' ? (
          <Button variant="secondary" size="sm" disabled={trust.isPending} onClick={() => trust.mutate(false)}>
            {t('extensions.stopTrusting')}
          </Button>
        ) : null}
        <span className="text-xs text-muted-foreground">
          {repo.lastFetchedAt === null
            ? t('extensions.neverSynced')
            : t('extensions.synced', { when: relativeTime(repo.lastFetchedAt, now, i18n.language) })}
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('extensions.refreshRepo', { name })}
          title={t('extensions.refresh')}
          disabled={refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          <RefreshCw className={refresh.isPending ? 'size-4 animate-spin' : 'size-4'} strokeWidth={1.75} aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('extensions.removeRepo', { name })}
          title={t('extensions.removeRepoShort')}
          onClick={() => setConfirming(true)}
        >
          <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
        </Button>
      </div>
      {repo.lastError ? (
        <p
          role="alert"
          className="rounded-lg border border-ctp-red/40 bg-ctp-red/10 px-3 py-2 text-xs text-danger-text"
        >
          {t('extensions.lastError', { message: repo.lastError })}
        </p>
      ) : null}
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('extensions.removeRepoTitle', { name })}
        description={t('extensions.removeRepoBody')}
        confirmLabel={t('extensions.removeRepoShort')}
        onConfirm={() => remove.mutate()}
      />
    </li>
  );
}
