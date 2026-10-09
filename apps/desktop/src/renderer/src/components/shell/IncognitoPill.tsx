import { EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIncognito, useSetIncognito } from '@renderer/lib/incognito';
import { cn } from '@renderer/lib/utils';

/** Shown while incognito is on, in the title bar and over the player (docs/PRD.md PRG-11, mockup 09b). Click turns it off. */
export function IncognitoPill({ className }: { className?: string }) {
  const { t } = useTranslation();
  const on = useIncognito();
  const set = useSetIncognito();
  if (!on) return null;
  return (
    <button
      type="button"
      title={t('incognito.pillHint')}
      aria-label={t('incognito.pillHint')}
      onClick={() => set.mutate(false)}
      className={cn(
        'no-drag flex h-6 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/15 px-2 text-xs leading-4 font-medium text-primary-text',
        className,
      )}
    >
      <EyeOff className="size-3.5" strokeWidth={1.75} aria-hidden />
      {t('incognito.pill')}
    </button>
  );
}
