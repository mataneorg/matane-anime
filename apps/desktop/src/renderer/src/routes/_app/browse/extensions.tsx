import type { ExtensionInfo } from '@matane-anime/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Info, Package, RefreshCw, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@renderer/components/EmptyState';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { LoadFolderButton } from '@renderer/features/extensions/LoadFolderButton';
import { PreferencesDialog } from '@renderer/features/extensions/PreferencesDialog';
import { call } from '@renderer/lib/api';
import { extensionsQuery } from '@renderer/lib/catalog';

export const Route = createFileRoute('/_app/browse/extensions')({ component: ExtensionsPage });

const hue = (text: string): number => [...text].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 360;

function ExtensionsPage() {
  const { t } = useTranslation();
  const { data: extensions = [], isPending } = useQuery(extensionsQuery);

  if (!isPending && extensions.length === 0) {
    return (
      <EmptyState
        icon={Package}
        title={t('extensions.emptyTitle')}
        description={t('extensions.emptyDescription')}
        action={<LoadFolderButton />}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5 p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl leading-8 font-bold tracking-tight">{t('extensions.title')}</h1>
        <LoadFolderButton />
      </header>
      <p className="flex items-center gap-3 rounded-xl border border-info/40 bg-info/10 px-4 py-3 text-foreground">
        <Info className="size-4 shrink-0 text-info" strokeWidth={1.75} aria-hidden />
        {t('extensions.devNotice')}
      </p>
      <ul className="flex flex-col gap-2">
        {extensions.map((extension) => (
          <ExtensionCard key={extension.folder} extension={extension} />
        ))}
      </ul>
    </div>
  );
}

function ExtensionCard({ extension }: { extension: ExtensionInfo }) {
  const { t } = useTranslation();
  const [prefsOpen, setPrefsOpen] = useState(false);
  const reload = useMutation({ mutationFn: () => call('extensions.reload', { folder: extension.folder }) });
  const remove = useMutation({ mutationFn: () => call('extensions.removeDevFolder', { folder: extension.folder }) });
  const failed = extension.status === 'error';

  return (
    <li className="flex flex-col gap-2 rounded-xl bg-card p-4">
      <div className="flex items-center gap-4">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-lg font-bold text-black"
          style={{ background: `hsl(${hue(extension.id)} 65% 75%)` }}
        >
          {extension.name.charAt(0).toUpperCase()}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold text-foreground">{extension.name}</span>
            {extension.version ? <span className="font-mono text-xs leading-4">{extension.version}</span> : null}
            <Badge tone="accent">{t('extensions.dev')}</Badge>
            {extension.nsfw ? <Badge tone="warning">18+</Badge> : null}
            {failed ? <Badge tone="danger">{t('extensions.failed')}</Badge> : null}
          </div>
          <span className="truncate font-mono text-xs leading-4" title={extension.folder}>
            {extension.folder}
          </span>
          {!failed ? (
            <span className="text-xs leading-4">
              {t('extensions.sources', { count: extension.sources.length })} ·{' '}
              {[...new Set(extension.sources.map((source) => source.lang.toUpperCase()))].join(', ')}
            </span>
          ) : null}
        </div>
        {extension.hasPreferences && !failed ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('extensions.preferences')}
            title={t('extensions.preferences')}
            onClick={() => setPrefsOpen(true)}
          >
            <SlidersHorizontal className="size-4" strokeWidth={1.75} aria-hidden />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('extensions.reload')}
          title={t('extensions.reload')}
          disabled={reload.isPending}
          onClick={() => reload.mutate()}
        >
          <RefreshCw className="size-4" strokeWidth={1.75} aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('extensions.remove')}
          title={t('extensions.remove')}
          onClick={() => remove.mutate()}
        >
          <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
        </Button>
      </div>
      {failed && extension.error ? (
        <p role="alert" className="rounded-lg bg-danger/12 px-3 py-2 font-mono text-xs leading-4 text-foreground">
          {extension.error}
        </p>
      ) : null}
      <PreferencesDialog extension={extension} open={prefsOpen} onOpenChange={setPrefsOpen} />
    </li>
  );
}
