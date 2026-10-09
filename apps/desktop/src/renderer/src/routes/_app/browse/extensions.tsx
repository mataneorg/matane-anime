import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { CircleCheck, Info, Loader2, Package, Plus, RefreshCw, SearchX, Server } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@renderer/components/EmptyState';
import { ErrorState } from '@renderer/components/ErrorState';
import { SearchField } from '@renderer/components/SearchField';
import { Button } from '@renderer/components/ui/button';
import { AddRepoDialog } from '@renderer/features/extensions/AddRepoDialog';
import { AvailableList } from '@renderer/features/extensions/AvailableList';
import { InstallDialog, type InstallTarget } from '@renderer/features/extensions/InstallDialog';
import { InstalledList } from '@renderer/features/extensions/InstalledList';
import { LanguageFilter } from '@renderer/features/extensions/LanguageChips';
import { LoadFolderButton } from '@renderer/features/extensions/LoadFolderButton';
import { RepositoriesList } from '@renderer/features/extensions/RepositoriesList';
import { countUpdates } from '@renderer/features/extensions/helpers';
import { call } from '@renderer/lib/api';
import { availableQuery, extensionsQuery, reposQuery } from '@renderer/lib/catalog';
import { describeError } from '@renderer/lib/errors';
import { settingsQuery, useUpdateSettings } from '@renderer/lib/ipc';
import { notify } from '@renderer/lib/toast';
import { cn } from '@renderer/lib/utils';

type Tab = 'installed' | 'available' | 'updates' | 'repositories';
const TABS: Tab[] = ['installed', 'available', 'updates', 'repositories'];

export const Route = createFileRoute('/_app/browse/extensions')({
  // `?add=true` opens the Add repository dialog (the library's first steps link here).
  validateSearch: (search: Record<string, unknown>): { add?: true } => (search['add'] ? { add: true } : {}),
  component: ExtensionsPage,
});

function ExtensionsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const wantsAdd = Route.useSearch().add === true;
  const extensions = useQuery(extensionsQuery);
  const repos = useQuery(reposQuery);
  const available = useQuery(availableQuery);
  const { data: settings } = useQuery(settingsQuery);
  const update = useUpdateSettings();

  const [tab, setTab] = useState<Tab>('installed');
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(wantsAdd);
  const [installing, setInstalling] = useState<InstallTarget | null>(null);

  const installed = extensions.data ?? [];
  const offered = available.data ?? [];
  const repoList = repos.data ?? [];
  const updates = countUpdates(installed);

  const closeAdd = (): void => {
    setAdding(false);
    if (wantsAdd) void navigate({ to: '/browse/extensions', search: {}, replace: true });
  };

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
  const updateAll = useMutation({
    mutationFn: () => call('extensions.updateAll'),
    onSuccess: (result) => {
      if (result.updated.length > 0) notify.success(t('extensions.toast.updatedAll', { count: result.updated.length }));
      for (const failure of result.failed) {
        notify.error(t('extensions.toast.updateFailed', { name: failure.id }), failure.message);
      }
    },
    onError: (error) => notify.error(t('extensions.toast.updateAllFailed'), describeError(error, t)),
  });

  if (extensions.isError || repos.isError) {
    return (
      <ErrorState
        title={t('errors.title')}
        description={describeError(extensions.error ?? repos.error, t)}
        action={
          <Button
            variant="secondary"
            onClick={() => {
              void extensions.refetch();
              void repos.refetch();
            }}
          >
            {t('extensions.retry')}
          </Button>
        }
      />
    );
  }
  if (extensions.isPending || repos.isPending) return null;

  const nothingYet = installed.length === 0 && repoList.length === 0;
  const withUpdate = installed.filter((extension) => extension.updateAvailable && !extension.shadowed);
  const counts: Record<Tab, number> = {
    installed: installed.length,
    available: offered.length,
    updates: withUpdate.length,
    repositories: repoList.length,
  };
  // The search box narrows whichever list is open.
  const needle = search.trim().toLowerCase();
  const matches = (...texts: (string | null | undefined)[]): boolean =>
    needle === '' || texts.some((text) => text?.toLowerCase().includes(needle));
  const shownInstalled = installed.filter((extension) => matches(extension.name, extension.id));
  const shownUpdates = withUpdate.filter((extension) => matches(extension.name, extension.id));
  const shownOffered = offered.filter((entry) => matches(entry.name, entry.id));
  const shownRepos = repoList.filter((repo) => matches(repo.name, repo.url));

  return (
    <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-5 px-6 py-5">
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <h1 className="text-xl font-semibold">{t('extensions.title')}</h1>
        <div className="ml-auto flex items-center gap-2">
          {settings?.devMode ? <LoadFolderButton variant="secondary" /> : null}
          {nothingYet ? null : (
            <>
              <Button
                variant="secondary"
                disabled={check.isPending || repoList.length === 0}
                onClick={() => check.mutate()}
              >
                {check.isPending ? (
                  <Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden />
                ) : (
                  <RefreshCw className="size-4" strokeWidth={1.75} aria-hidden />
                )}
                {t('extensions.check')}
              </Button>
              <Button onClick={() => setAdding(true)}>
                <Plus className="size-4" strokeWidth={1.75} aria-hidden />
                {t('extensions.addRepository')}
              </Button>
            </>
          )}
        </div>
      </header>

      {nothingYet ? (
        <EmptyState
          icon={Package}
          title={t('extensions.emptyTitle')}
          description={t('extensions.emptyDescription')}
          action={
            <Button onClick={() => setAdding(true)}>
              <Plus className="size-4" strokeWidth={1.75} aria-hidden />
              {t('extensions.addRepository')}
            </Button>
          }
        >
          <p className="flex max-w-lg items-start gap-2 text-left text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0 text-ctp-blue" strokeWidth={1.75} aria-hidden />
            {t('extensions.addRepo.notice')}
          </p>
        </EmptyState>
      ) : (
        <>
          {updates > 0 ? (
            <div
              role="status"
              className="flex items-center gap-3 rounded-xl border border-ctp-blue/40 bg-ctp-blue/10 px-4 py-3 text-foreground"
            >
              <Info className="size-4 shrink-0 text-ctp-blue" strokeWidth={1.75} aria-hidden />
              <p className="flex-1">
                <span className="font-semibold">{t('extensions.updatesAvailable', { count: updates })}</span>{' '}
                {t('extensions.updatesHint')}
              </p>
              <Button size="sm" disabled={updateAll.isPending} onClick={() => updateAll.mutate()}>
                {updateAll.isPending ? (
                  <Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden />
                ) : null}
                {t('extensions.updateAll')}
              </Button>
            </div>
          ) : null}

          <div role="tablist" aria-label={t('extensions.title')} className="flex gap-6 border-b">
            {TABS.map((name) => (
              <button
                key={name}
                role="tab"
                type="button"
                id={`tab-${name}`}
                aria-selected={tab === name}
                aria-controls="extensions-panel"
                onClick={() => setTab(name)}
                className={cn(
                  '-mb-px flex h-9 items-center gap-2 border-b-2 border-transparent px-1 text-muted-foreground transition-colors hover:text-foreground',
                  tab === name && 'border-primary font-semibold text-foreground',
                )}
              >
                {t(`extensions.tabs.${name}`)}
                <span
                  className={cn(
                    'rounded-md bg-muted px-1.5 text-[11px] font-medium text-foreground',
                    tab === name && 'bg-primary/20 text-primary-text',
                  )}
                >
                  {counts[name]}
                </span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border bg-card/40 p-3">
            <SearchField
              value={search}
              onChange={setSearch}
              placeholder={t('extensions.search')}
              className="min-w-48 flex-1"
            />
            <LanguageFilter />
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={settings?.showNsfw ?? false}
                onChange={(event) => update.mutate({ showNsfw: event.target.checked })}
              />
              {t('extensions.filter.nsfw')}
            </label>
          </div>

          <div id="extensions-panel" role="tabpanel" aria-labelledby={`tab-${tab}`}>
            {tab === 'installed' ? (
              installed.length === 0 ? (
                <EmptyState
                  icon={Package}
                  title={t('extensions.noneInstalled.title')}
                  description={t('extensions.noneInstalled.description')}
                  action={
                    <Button variant="secondary" onClick={() => setTab('available')}>
                      {t('extensions.noneInstalled.action')}
                    </Button>
                  }
                />
              ) : shownInstalled.length === 0 ? (
                <NoMatches />
              ) : (
                <InstalledList extensions={shownInstalled} available={offered} onReinstall={setInstalling} />
              )
            ) : tab === 'available' ? (
              available.isError ? (
                <ErrorState error={available.error} onRetry={() => void available.refetch()} />
              ) : offered.length === 0 ? (
                <EmptyState
                  icon={Server}
                  title={t(repoList.length === 0 ? 'extensions.noRepos.title' : 'extensions.noneAvailable.title')}
                  description={t(
                    repoList.length === 0 ? 'extensions.noRepos.description' : 'extensions.noneAvailable.description',
                  )}
                />
              ) : shownOffered.length === 0 ? (
                <NoMatches />
              ) : (
                <AvailableList entries={shownOffered} onInstall={setInstalling} />
              )
            ) : tab === 'updates' ? (
              withUpdate.length === 0 ? (
                <EmptyState
                  icon={CircleCheck}
                  title={t('extensions.noUpdates.title')}
                  description={t('extensions.noUpdates.description')}
                />
              ) : shownUpdates.length === 0 ? (
                <NoMatches />
              ) : (
                <InstalledList extensions={shownUpdates} available={offered} onReinstall={setInstalling} />
              )
            ) : repoList.length === 0 ? (
              <EmptyState
                icon={Server}
                title={t('extensions.noRepos.title')}
                description={t('extensions.noRepos.description')}
              />
            ) : shownRepos.length === 0 ? (
              <NoMatches />
            ) : (
              <RepositoriesList repos={shownRepos} />
            )}
          </div>
        </>
      )}

      <AddRepoDialog
        open={adding}
        onOpenChange={(open) => (open ? setAdding(true) : closeAdd())}
        onAdded={(repo) => {
          closeAdd();
          setTab(repo.extensionCount > 0 ? 'available' : 'repositories');
        }}
      />
      <InstallDialog
        target={installing}
        onClose={() => setInstalling(null)}
        onInstalled={() => {
          setInstalling(null);
          setTab('installed');
        }}
      />
    </div>
  );
}

/** A search that matches nothing in the open tab. */
function NoMatches() {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={SearchX}
      title={t('extensions.noMatches.title')}
      description={t('extensions.noMatches.description')}
    />
  );
}
