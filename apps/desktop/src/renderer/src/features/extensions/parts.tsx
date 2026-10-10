import type { RepoTrust } from '@matane-anime/shared';
import { Shield, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@renderer/components/ui/badge';
import { cn } from '@renderer/lib/utils';
import { hue } from './helpers';

/** The extension's `icon.png` (served by main), or a letter avatar tinted by its id when it has none or fails to load. */
export function ExtensionIcon({ id, name, className }: { id: string; name: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  const base = 'flex shrink-0 items-center justify-center overflow-hidden rounded-lg';
  if (broken) {
    return (
      <span
        aria-hidden
        className={cn(base, 'font-bold text-black', className)}
        style={{ background: `hsl(${hue(id)} 65% 75%)` }}
      >
        {name.charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      alt=""
      aria-hidden
      src={`anime://icon/${encodeURIComponent(id)}`}
      className={cn(base, 'object-cover', className)}
      onError={() => setBroken(true)}
    />
  );
}

/** The languages of an extension's sources as badges: up to three, then "+n". */
export function LangBadges({ langs }: { langs: readonly string[] }) {
  const unique = [...new Set(langs.map((lang) => lang.toUpperCase()))];
  const shown = unique.slice(0, 3);
  return (
    <>
      {shown.map((lang) => (
        <Badge key={lang}>{lang}</Badge>
      ))}
      {unique.length > shown.length ? <Badge variant="outline">+{unique.length - shown.length}</Badge> : null}
    </>
  );
}

/** "<repository> · Trusted key" in calm text, "<repository> · Unverified repository" as a warning: icon and words. */
export function TrustLine({ trust, repoName }: { trust: RepoTrust; repoName: string | null }) {
  const { t } = useTranslation();
  const ok = trust === 'trusted';
  const Icon = ok ? Shield : ShieldAlert;
  const label = t(`extensions.trust.${trust}`);
  return (
    <span
      className={cn(
        'flex max-w-[60%] min-w-0 shrink-0 items-center gap-1',
        ok ? 'text-info-text' : 'text-warning-text',
      )}
    >
      <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
      <span className="truncate">{repoName ? `${repoName} · ${label}` : label}</span>
    </span>
  );
}
