import { ShieldCheck, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RepoTrust } from '@matane-anime/shared';
import { Badge } from '@renderer/components/ui/badge';
import { cn } from '@renderer/lib/utils';
import { trustView } from './helpers';

/** How far a repository is trusted, as an icon and a word (never color alone). `null` is a dev folder. */
export function TrustBadge({
  trust,
  short = false,
  className,
}: {
  trust: RepoTrust | null;
  /** The wording of the repository list ("Unverified") instead of an extension's ("Unverified repository"). */
  short?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const view = trustView(trust);
  if (view.label === 'dev') return <Badge tone="accent">{t('extensions.dev')}</Badge>;
  const Icon = view.tone === 'ok' ? ShieldCheck : TriangleAlert;
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs leading-4 text-foreground', className)}>
      <Icon
        className={cn('size-3.5 shrink-0', view.tone === 'ok' ? 'text-success' : 'text-warning')}
        strokeWidth={1.75}
        aria-hidden
      />
      {t(`extensions.${short ? 'repoTrust' : 'trust'}.${view.label}`)}
    </span>
  );
}
