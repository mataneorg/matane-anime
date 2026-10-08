import type { RepoInfo, RepoPreview } from '@matane-anime/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Info, Loader2, TriangleAlert } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/components/ui/button';
import { Dialog, DialogContent } from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import { call } from '@renderer/lib/api';
import { describeError } from '@renderer/lib/errors';
import { notify } from '@renderer/lib/toast';

/** Add repository (mockup 06c): read the address first, show who signed it, add only after the user has seen that. */
export function AddRepoDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdded: (repo: RepoInfo) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('extensions.addRepo.title')}
        description={t('extensions.addRepo.description')}
        closeLabel={t('common.close')}
      >
        {open ? <AddRepoForm onCancel={() => onOpenChange(false)} onAdded={onAdded} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function AddRepoForm({ onCancel, onAdded }: { onCancel: () => void; onAdded: (repo: RepoInfo) => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<RepoPreview | null>(null);
  const [trustKey, setTrustKey] = useState(false);

  const read = useMutation({
    mutationFn: (address: string) => call('repos.preview', { url: address }),
    onSuccess: (result) => {
      setPreview(result);
      setTrustKey(false);
    },
    onError: () => setPreview(null),
  });
  const add = useMutation({
    mutationFn: (input: { url: string; trustKey: boolean }) => call('repos.add', input),
    onSuccess: (repo) => {
      void queryClient.invalidateQueries({ queryKey: ['repos'] });
      void queryClient.invalidateQueries({ queryKey: ['available'] });
      notify.success(t('extensions.toast.repoAdded', { name: repo.name ?? repo.url }));
      onAdded(repo);
    },
  });

  const error = add.error ?? read.error;
  const busy = read.isPending || add.isPending;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (busy || url.trim() === '') return;
    if (preview) add.mutate({ url: preview.url, trustKey: preview.trust === 'unverified' && trustKey });
    else read.mutate(url.trim());
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="repo-url" className="text-xs leading-4 font-semibold">
          {t('extensions.addRepo.address')}
        </label>
        <Input
          id="repo-url"
          value={url}
          autoFocus
          spellCheck={false}
          placeholder={t('extensions.addRepo.placeholder')}
          className="font-mono"
          onChange={(event) => {
            setUrl(event.target.value);
            // Another address is another repository: what was read for the old one no longer applies.
            setPreview(null);
            read.reset();
            add.reset();
          }}
        />
      </div>

      {error ? (
        <p role="alert" className="rounded-lg bg-danger/12 px-3 py-2 text-xs leading-4 text-foreground">
          {describeError(error, t)}
        </p>
      ) : null}

      {preview ? (
        <section className="flex flex-col gap-3" aria-label={t('extensions.addRepo.result')}>
          <p className="text-foreground">
            <span className="font-semibold">{preview.name ?? preview.url}</span>
            {' · '}
            {t('extensions.addRepo.count', { count: preview.extensionCount })}
          </p>
          {preview.trust === 'unverified' ? (
            <div className="flex flex-col gap-3 rounded-xl border border-warning/50 bg-warning/10 p-4">
              <p className="flex items-center gap-2 font-semibold text-foreground">
                <TriangleAlert className="size-4 shrink-0 text-warning" strokeWidth={1.75} aria-hidden />
                {t('extensions.addRepo.unverifiedTitle')}
              </p>
              <p className="text-foreground">{t('extensions.addRepo.unverifiedBody')}</p>
              <div className="flex items-center justify-between gap-3 rounded-lg bg-background px-3 py-2 text-xs leading-4">
                <span>{t('extensions.addRepo.signingKey')}</span>
                <span className="font-mono font-semibold text-foreground">{preview.fingerprint}</span>
              </div>
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-accent"
                  checked={trustKey}
                  onChange={(event) => setTrustKey(event.target.checked)}
                />
                <span className="flex flex-col">
                  <span className="font-semibold text-foreground">{t('extensions.addRepo.trustKey')}</span>
                  <span className="text-xs leading-4">{t('extensions.addRepo.trustKeyHint')}</span>
                </span>
              </label>
            </div>
          ) : (
            <div className="flex flex-col gap-2 rounded-xl border border-warning/50 bg-warning/10 p-4">
              <p className="flex items-center gap-2 font-semibold text-foreground">
                <TriangleAlert className="size-4 shrink-0 text-warning" strokeWidth={1.75} aria-hidden />
                {t('extensions.addRepo.unsignedTitle')}
              </p>
              <p className="text-foreground">{t('extensions.addRepo.unsignedBody')}</p>
            </div>
          )}
        </section>
      ) : null}

      <p className="flex items-start gap-2 text-xs leading-4">
        <Info className="mt-0.5 size-3.5 shrink-0 text-info" strokeWidth={1.75} aria-hidden />
        {t('extensions.addRepo.notice')}
      </p>

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={busy || url.trim() === ''}>
          {busy ? <Loader2 className="size-4 animate-spin" strokeWidth={1.75} aria-hidden /> : null}
          {preview ? t('extensions.addRepo.add') : t('extensions.addRepo.check')}
        </Button>
      </div>
    </form>
  );
}
