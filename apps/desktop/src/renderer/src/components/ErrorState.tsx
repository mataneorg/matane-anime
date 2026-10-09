import { RotateCw, ShieldCheck, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { describeError, isCloudflare } from '@renderer/lib/errors';
import { cn } from '@renderer/lib/utils';
import { Button } from './ui/button';

/**
 * What a failed list or page shows: what happened, in words, and what to do about it.
 *
 * Pass `error` (and `onRetry`) for a failure of a source call: the words come from `describeError`, and the button
 * says "Verify and try again" for a Cloudflare check (retrying opens the verification window) or "Try again"
 * otherwise. Pass `title`/`description`/`action` to say something else. `compact` is the inline version for a part
 * of a page.
 */
export function ErrorState({
  error,
  onRetry,
  title,
  description,
  action,
  compact = false,
  className,
}: {
  error?: unknown;
  onRetry?: () => void;
  title?: string;
  description?: string;
  /** Replaces the retry button. */
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const words = description ?? (error === undefined ? undefined : describeError(error, t));
  const cloudflare = error !== undefined && isCloudflare(error);
  const retry =
    action ??
    (onRetry ? (
      <Button variant={cloudflare ? 'default' : 'secondary'} onClick={onRetry}>
        {cloudflare ? <ShieldCheck aria-hidden /> : <RotateCw aria-hidden />}
        {cloudflare ? t('browse.verify') : t('browse.retry')}
      </Button>
    ) : null);
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-center gap-4 text-center', compact ? 'p-4' : 'p-8', className)}
    >
      {compact ? null : (
        <div className="flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <TriangleAlert className="size-7" strokeWidth={1.75} aria-hidden />
        </div>
      )}
      <div className="flex max-w-md flex-col gap-1.5">
        <h2 className="text-base font-semibold">{title ?? t('errors.title')}</h2>
        {words ? <p className="text-muted-foreground select-text">{words}</p> : null}
      </div>
      {retry}
    </div>
  );
}
