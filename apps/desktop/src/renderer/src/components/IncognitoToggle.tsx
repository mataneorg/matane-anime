import { EyeOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIncognito, useSetIncognito } from '@renderer/lib/incognito';
import { cn } from '@renderer/lib/utils';

/**
 * The incognito switch of the title bar (docs/PRD.md PRG-11), always there. Off it is a quiet icon button; on it is a
 * labelled pill, so incognito is never on by accident.
 */
export function IncognitoToggle({ className }: { className?: string }) {
  const { t } = useTranslation();
  const on = useIncognito();
  const set = useSetIncognito();
  const label = on ? t('incognito.pillHint') : t('incognito.turnOn');
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={() => set.mutate(!on)}
      className={cn(
        'no-drag flex h-7 items-center gap-1.5 rounded-md text-xs font-medium transition-colors',
        on
          ? 'border border-primary/40 bg-primary/15 px-2 text-primary-text hover:bg-primary/25'
          : 'w-7 justify-center text-muted-foreground hover:bg-accent hover:text-foreground',
        className,
      )}
    >
      <EyeOff className="size-4" strokeWidth={1.75} aria-hidden />
      {on ? t('incognito.pill') : null}
    </button>
  );
}
