import type { RepoInfo } from '@matane-anime/shared';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Plus, RefreshCw, Server, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@renderer/components/ConfirmDialog';
import { Button } from '@renderer/components/ui/button';
import { call } from '@renderer/lib/api';
import { relativeTime } from '@renderer/lib/dates';
import { describeError } from '@renderer/lib/errors';
import { notify } from '@renderer/lib/toast';
import { useNow } from '@renderer/lib/useNow';
import { cn } from '@renderer/lib/utils';
import { TrustBadge } from './TrustBadge';
import { sortRepos } from './helpers';

/**
 * The Repositories side panel (mockup 09): where extensions come from, how far each repository is trusted and when
 * it was last read; check them all, trust or stop trusting a key, remove one, add one.
 */
export function RepositoriesPanel({
  repos,
  onAdd,
  onClose,
}: {
  repos: RepoInfo[];
  onAdd: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const panel = useRef<HTMLElement>(null);
  // Opening the panel moves the focus into it (the page puts it back on its button when it closes).
  useEffect(() => panel.current?.focus(), []);
  const check = useMutation({
    mutationFn: () => call('repos.refresh', {}),
    onSuccess: (result) => {
      if (result.failed.length === 0) {
        notify.success(t('extensions.toast.checked', { count: result.refreshed }));
      } else {
        notify.error(
          t('extensions.toast.checkFailed', { count: result.failed.length }),
          result.failed.map((failure) => failure.message).join('\n'),
        );
      }
    },
    onError: (error) => notify.error(t('extensions.toast.checkFailedAll'), describeError(error, t)),
  });

  return (
    <aside
      ref={panel}
      tabIndex={-1}
      className="flex w-80 shrink-0 flex-col border-l bg-sidebar outline-none"
      aria-label={t('extensions.tabs.repositories')}
      data-testid="repositories-panel"
    >
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <Server className="size-4 text-muted-foreground" strokeWidth={1.75} aria-hidden />
        <h2 className="flex-1 font-semibold">{t('extensions.tabs.repositories')}</h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('extensions.check')}
          title={t('extensions.check')}
          disabled={check.isPending || repos.length === 0}
          onClick={() => check.mutate()}
        >
          {check.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
        </Button>
        <Button variant="ghost" size="icon" aria-label={t('common.close')} title={t('common.close')} onClick={onClose}>
          <X aria-hidden />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {repos.length === 0 ? (
          <div className="flex flex-col gap-1 py-6 text-center">
            <p className="font-semibold">{t('extensions.noRepos.title')}</p>
            <p className="text-xs text-muted-foreground">{t('extensions.noRepos.description')}</p>
          </div>
        ) : (
          sortRepos(repos).map((repo) => <RepoCard key={repo.id} repo={repo} />)
        )}
      </div>
      <div className="border-t p-4">
        <Button variant="secondary" className="w-full border-dashed" onClick={onAdd}>
          <Plus aria-hidden />
          {t('extensions.addRepository')}
        </Button>
      </div>
    </aside>
  );
}

function RepoCard({ repo }: { repo: RepoInfo }) {
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
    <article className="rounded-xl border bg-card/40 p-3.5" data-testid={`repo-${repo.id}`}>
      <div className="flex items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate font-medium" title={repo.url}>
          {name}
        </h3>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('extensions.refreshRepo', { name })}
          title={t('extensions.refresh')}
          disabled={refresh.isPending}
          onClick={() => refresh.mutate()}
        >
          <RefreshCw className={cn(refresh.isPending && 'animate-spin')} aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('extensions.removeRepo', { name })}
          title={t('extensions.removeRepoShort')}
          onClick={() => setConfirming(true)}
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
      <p className="mt-1 truncate font-mono text-xs text-muted-foreground" title={repo.url}>
        {repo.url}
        {' · '}
        {repo.fingerprint ?? t('extensions.unsignedMark')}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
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
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {t('extensions.addRepo.count', { count: repo.extensionCount })}
        {' · '}
        {repo.lastFetchedAt === null
          ? t('extensions.neverSynced')
          : t('extensions.synced', { when: relativeTime(repo.lastFetchedAt, now, i18n.language) })}
      </p>
      {repo.lastError ? (
        <p
          role="alert"
          className="mt-2 rounded-lg border border-ctp-red/40 bg-ctp-red/10 px-3 py-2 text-xs text-danger-text select-text"
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
    </article>
  );
}
