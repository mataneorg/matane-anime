import { ShieldCheck, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { RepoTrust } from '@matane-anime/shared';
import { Badge } from '@renderer/components/ui/badge';
import { trustView } from './helpers';

/** How far a repository is trusted, as an icon and a word (never color alone). `null` is a dev folder. */
export function TrustBadge({
  trust,
  short = false,
}: {
  trust: RepoTrust | null;
  /** The wording of the repository list ("Unverified") instead of an extension's ("Unverified repository"). */
  short?: boolean;
}) {
  const { t } = useTranslation();
  const view = trustView(trust);
  if (view.label === 'dev') return <Badge variant="primary">{t('extensions.dev')}</Badge>;
  const ok = view.tone === 'ok';
  const Icon = ok ? ShieldCheck : TriangleAlert;
  return (
    <Badge variant={ok ? 'success' : 'warning'}>
      <Icon strokeWidth={1.75} aria-hidden />
      {t(`extensions.${short ? 'repoTrust' : 'trust'}.${view.label}`)}
    </Badge>
  );
}
