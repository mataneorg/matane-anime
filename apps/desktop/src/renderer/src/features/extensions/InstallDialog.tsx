import type { InstallPreparation } from '@matane-anime/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Info, Loader2, TriangleAlert } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/components/ui/button';
import { Dialog, DialogContent } from '@renderer/components/ui/dialog';
import { call } from '@renderer/lib/api';
import { describeError } from '@renderer/lib/errors';
import { notify } from '@renderer/lib/toast';
import { TrustBadge } from './TrustBadge';
import { formatSize, hue, languageName, shortHash } from './helpers';

export interface InstallTarget {
  repoId: number;
  extensionId: string;
  /** What the dialog calls it while the package is still being checked. */
  name: string;
}

/** Install (mockup 06b): step one downloads and checks the package, step two writes it. */
export function InstallDialog({
  target,
  onClose,
  onInstalled,
}: {
  target: InstallTarget | null;
  onClose: () => void;
  onInstalled: (extensionId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={t('extensions.installDialog.title', { name: target?.name ?? '' })}
        closeLabel={t('common.close')}
      >
        {target ? (
          <InstallBody
            key={`${target.repoId}/${target.extensionId}`}
            target={target}
            onClose={onClose}
            onInstalled={onInstalled}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function InstallBody({
  target,
  onClose,
  onInstalled,
}: {
  target: InstallTarget;
  onClose: () => void;
  onInstalled: (extensionId: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  // A token is single-use and short-lived: any failed install is prepared again rather than retried with it.
  const [attempt, setAttempt] = useState(0);
  const prepared = useQuery({
    queryKey: ['prepare-install', target.repoId, target.extensionId, attempt],
    queryFn: () => call('extensions.prepareInstall', { repoId: target.repoId, extensionId: target.extensionId }),
    staleTime: 0,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const install = useMutation({
    mutationFn: (token: string) => call('extensions.install', { token }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['extensions'] });
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      void queryClient.invalidateQueries({ queryKey: ['available'] });
      notify.success(t('extensions.toast.installed', { name: prepared.data?.extension.name ?? target.name }));
      onInstalled(target.extensionId);
    },
  });

  const retry = (): void => {
    install.reset();
    setAttempt((value) => value + 1);
  };
  const data = prepared.data;
  const reinstall = data?.installedVersion !== null && data?.installedVersion !== undefined;

  if (prepared.isPending) {
    return (
      <p role="status" className="flex items-center gap-2">
        <Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden />
        {t('extensions.installDialog.checking')}
      </p>
    );
  }
  if (prepared.isError || !data) {
    return (
      <div className="flex flex-col gap-4">
        <p role="alert" className="rounded-lg bg-danger/12 px-3 py-2 text-xs leading-4 text-foreground">
          {describeError(prepared.error, t)}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={retry}>{t('extensions.installDialog.retry')}</Button>
        </div>
      </div>
    );
  }

  const { extension, repo } = data;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-lg font-bold text-black"
          style={{ background: `hsl(${hue(extension.id)} 65% 75%)` }}
        >
          {extension.name.charAt(0).toUpperCase()}
        </span>
        <p className="text-xs leading-4">
          {t('extensions.installDialog.version')} <span className="font-mono">{extension.version}</span>{' '}
          {t('extensions.installDialog.from', { repo: repo.name ?? t('extensions.installDialog.unnamed') })}
          {reinstall ? ` · ${t('extensions.installDialog.installedNow', { version: data.installedVersion })}` : ''}
        </p>
      </div>

      <dl className="flex flex-col">
        <Row label={t('extensions.installDialog.repository')}>
          <TrustBadge trust={repo.trust} className="font-semibold" />
        </Row>
        <Row label={t('extensions.installDialog.api')}>
          <span className="font-mono">
            {extension.apiVersion} · {t('extensions.installDialog.compatible')}
          </span>
        </Row>
        <Row label={t('extensions.installDialog.languages')}>
          {extension.langs.map((lang) => languageName(lang, i18n.language)).join(', ')}
        </Row>
        <Row label={t('extensions.installDialog.size')}>
          <span className="font-mono">{formatSize(extension.size)}</span>
        </Row>
        <Row label={t('extensions.installDialog.integrity')}>
          <span className="inline-flex items-center gap-1.5 font-mono" title={extension.sha256}>
            <Check className="size-3.5 text-success" strokeWidth={2.25} aria-hidden />
            {t('extensions.installDialog.verified')} · {shortHash(extension.sha256)}
          </span>
        </Row>
      </dl>

      <Warnings warnings={data.warnings} fingerprint={repo.fingerprint} />

      <p className="flex items-start gap-2 rounded-xl bg-card p-3 text-xs leading-4 text-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0 text-info" strokeWidth={1.75} aria-hidden />
        {t('extensions.installDialog.sandbox')}
      </p>

      {install.isError ? (
        <p role="alert" className="rounded-lg bg-danger/12 px-3 py-2 text-xs leading-4 text-foreground">
          {describeError(install.error, t)}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        {install.isError ? (
          <Button onClick={retry}>{t('extensions.installDialog.retry')}</Button>
        ) : (
          <Button disabled={install.isPending} onClick={() => install.mutate(data.token)}>
            {install.isPending ? <Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden /> : null}
            {reinstall ? t('extensions.reinstall') : t('extensions.install')}
          </Button>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-2.5 first:pt-0">
      <dt>{label}</dt>
      <dd className="text-right text-foreground">{children}</dd>
    </div>
  );
}

/** Shown every time: an unverified or unsigned repository never gets a quiet install (EXT-6). */
function Warnings({ warnings, fingerprint }: { warnings: InstallPreparation['warnings']; fingerprint: string | null }) {
  const { t } = useTranslation();
  if (warnings.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {warnings.map((warning) => (
        <div
          key={warning}
          role="note"
          className="flex flex-col gap-1 rounded-xl border border-warning/50 bg-warning/10 p-3 text-foreground"
        >
          <p className="flex items-center gap-2 font-semibold">
            <TriangleAlert className="size-4 shrink-0 text-warning" strokeWidth={1.75} aria-hidden />
            {t(`extensions.installDialog.warnings.${warning}.title`)}
          </p>
          <p className="text-xs leading-4">
            {t(`extensions.installDialog.warnings.${warning}.body`)}
            {warning === 'unverified' && fingerprint ? (
              <>
                {' '}
                <span className="font-mono">{fingerprint}</span>
              </>
            ) : null}
          </p>
        </div>
      ))}
    </div>
  );
}
