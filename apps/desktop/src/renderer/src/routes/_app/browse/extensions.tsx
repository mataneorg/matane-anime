import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ArrowUpCircle, CircleCheck, Info, Loader2, Package, Plus, RotateCw, SearchX, Server } from 'lucide-react';
import { type KeyboardEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@renderer/components/EmptyState';
import { ErrorState } from '@renderer/components/ErrorState';
import { SearchField } from '@renderer/components/SearchField';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { AddRepoDialog } from '@renderer/features/extensions/AddRepoDialog';
import { AvailableList } from '@renderer/features/extensions/AvailableList';
import { InstallDialog, type InstallTarget } from '@renderer/features/extensions/InstallDialog';
import { InstalledList } from '@renderer/features/extensions/InstalledList';
import { ContentLanguagePicker, NsfwToggle } from '@renderer/features/extensions/ContentControls';
import { LoadFolderButton } from '@renderer/features/extensions/LoadFolderButton';
import { RepositoriesPanel } from '@renderer/features/extensions/RepositoriesPanel';
import { countUpdates, reloadSequentially } from '@renderer/features/extensions/helpers';
import { call } from '@renderer/lib/api';
import { availableQuery, extensionsQuery, reposQuery } from '@renderer/lib/catalog';
import { describeError } from '@renderer/lib/errors';
import { settingsQuery } from '@renderer/lib/ipc';
import { notify } from '@renderer/lib/toast';
import { cn } from '@renderer/lib/utils';

type Tab = 'installed' | 'available' | 'updates';
const TABS: Tab[] = ['installed', 'available', 'updates'];

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

  const [tab, setTab] = useState<Tab>('installed');
  const [panelOpen, setPanelOpen] = useState(false);
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
  // The folders loaded for development; "Reload all" reads each of them again.
  const devFolders = installed.flatMap((extension) =>
    extension.origin === 'dev' && extension.folder !== null ? [extension.folder] : [],
  );
  const reloadAll = useMutation({
    // One after the other: two folders can hold the same extension id.
    mutationFn: () => reloadSequentially(devFolders, (folder) => call('extensions.reload', { folder })),
    onSuccess: ({ reloaded, failed }) => {
      if (failed.length === 0) notify.success(t('extensions.toast.reloadedAll', { count: reloaded }));
      else {
        notify.error(
          t('extensions.toast.reloadPartial', { ok: reloaded, failed: failed.length }),
          failed.map((failure) => `${failure.name}: ${failure.message}`).join('\n'),
        );
      }
    },
    onError: (error) => notify.error(t('extensions.toast.reloadAllFailed'), describeError(error, t)),
  });

  // The Repositories panel takes the focus when it opens and gives it back to its button when it closes.
  const panelButton = useRef<HTMLButtonElement>(null);
  const closePanel = (): void => {
    setPanelOpen(false);
    panelButton.current?.focus();
  };
  // Arrow keys move between the tabs, which are a single tab stop.
  const moveTab = (event: KeyboardEvent, index: number): void => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = TABS[(index + step + TABS.length) % TABS.length] as Tab;
    setTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  };

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
  };
  // The search box narrows whichever list is open.
  const needle = search.trim().toLowerCase();
  const matches = (...texts: (string | null | undefined)[]): boolean =>
    needle === '' || texts.some((text) => text?.toLowerCase().includes(needle));
  const shownInstalled = installed.filter((extension) => matches(extension.name, extension.id));
  const shownUpdates = withUpdate.filter((extension) => matches(extension.name, extension.id));
  const shownOffered = offered.filter((entry) => matches(entry.name, entry.id));

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-center gap-3 px-8 pt-6 pb-4">
          <h1 className="text-2xl font-semibold">{t('extensions.title')}</h1>
          {updates > 0 ? (
            <Badge variant="primary" role="status" className="rounded-full px-2.5 py-1">
              {t('extensions.updatesAvailable', { count: updates })}
            </Badge>
          ) : null}
          <span className="flex-1" />
          {settings?.devMode ? <LoadFolderButton variant="ghost" size="sm" /> : null}
          <Button
            ref={panelButton}
            variant="secondary"
            aria-pressed={panelOpen}
            onClick={() => (panelOpen ? closePanel() : setPanelOpen(true))}
          >
            <Server aria-hidden />
            {t('extensions.tabs.repositories')}
          </Button>
          {updates > 0 ? (
            <Button disabled={updateAll.isPending} onClick={() => updateAll.mutate()}>
              {updateAll.isPending ? <Loader2 className="animate-spin" aria-hidden /> : <ArrowUpCircle aria-hidden />}
              {t('extensions.updateAll')}
            </Button>
          ) : null}
        </header>

        {nothingYet ? (
          <EmptyState
            icon={Package}
            title={t('extensions.emptyTitle')}
            description={t('extensions.emptyDescription')}
            action={
              <Button onClick={() => setAdding(true)}>
                <Plus aria-hidden />
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
            <div
              role="tablist"
              aria-label={t('extensions.title')}
              className="mx-8 flex shrink-0 items-end gap-6 border-b"
            >
              {TABS.map((name, index) => (
                <button
                  key={name}
                  role="tab"
                  type="button"
                  id={`tab-${name}`}
                  aria-selected={tab === name}
                  aria-controls="extensions-panel"
                  tabIndex={tab === name ? 0 : -1}
                  onClick={() => setTab(name)}
                  onKeyDown={(event) => moveTab(event, index)}
                  className={cn(
                    '-mb-px flex items-center gap-2 border-b-2 border-transparent pb-2.5 text-muted-foreground transition-colors hover:text-foreground',
                    tab === name && 'border-primary font-semibold text-foreground',
                  )}
                >
                  {t(`extensions.tabs.${name}`)}
                  <span
                    className={cn(
                      'rounded-md bg-muted px-1.5 text-[11px] font-semibold text-foreground',
                      name === 'updates' && counts.updates > 0 && 'bg-primary/20 text-primary-text',
                    )}
                  >
                    {counts[name]}
                  </span>
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-8 py-5">
              <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border bg-card/40 p-3">
                <SearchField
                  value={search}
                  onChange={setSearch}
                  placeholder={t('extensions.search')}
                  className="min-w-48 flex-1"
                />
                <ContentLanguagePicker />
                <label
                  htmlFor="extensions-nsfw"
                  className="ml-auto flex items-center gap-2 text-sm text-muted-foreground"
                >
                  {t('extensions.filter.nsfw')}
                  <NsfwToggle id="extensions-nsfw" />
                </label>
                {tab === 'installed' && devFolders.length > 0 ? (
                  <Button variant="ghost" size="sm" disabled={reloadAll.isPending} onClick={() => reloadAll.mutate()}>
                    <RotateCw className={cn(reloadAll.isPending && 'animate-spin')} aria-hidden />
                    {t('extensions.reloadAll')}
                  </Button>
                ) : null}
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
                        repoList.length === 0
                          ? 'extensions.noRepos.description'
                          : 'extensions.noneAvailable.description',
                      )}
                      action={
                        repoList.length === 0 ? (
                          <Button onClick={() => setPanelOpen(true)}>{t('extensions.tabs.repositories')}</Button>
                        ) : undefined
                      }
                    />
                  ) : shownOffered.length === 0 ? (
                    <NoMatches />
                  ) : (
                    <AvailableList entries={shownOffered} onInstall={setInstalling} />
                  )
                ) : withUpdate.length === 0 ? (
                  <EmptyState
                    icon={CircleCheck}
                    title={t('extensions.noUpdates.title')}
                    description={t('extensions.noUpdates.description')}
                  />
                ) : shownUpdates.length === 0 ? (
                  <NoMatches />
                ) : (
                  <InstalledList extensions={shownUpdates} available={offered} onReinstall={setInstalling} />
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {panelOpen ? <RepositoriesPanel repos={repoList} onAdd={() => setAdding(true)} onClose={closePanel} /> : null}

      <AddRepoDialog
        open={adding}
        onOpenChange={(open) => (open ? setAdding(true) : closeAdd())}
        onAdded={(repo) => {
          closeAdd();
          if (repo.extensionCount > 0) setTab('available');
          else setPanelOpen(true);
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
