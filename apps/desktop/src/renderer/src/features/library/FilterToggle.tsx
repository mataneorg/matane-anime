import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@renderer/lib/utils';

/** A small caps heading between groups of toggles in a filter popover. */
export function FilterHeading({ children }: { children: ReactNode }) {
  return (
    <p className="mt-2 px-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{children}</p>
  );
}

/** A checkbox row of a filter popover. */
export function FilterToggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      onClick={onClick}
      className="flex h-8 items-center gap-2.5 rounded-md px-2 text-left transition-colors hover:bg-accent"
    >
      <span
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded border border-input',
          on && 'border-primary bg-primary text-primary-foreground',
        )}
      >
        {on ? <Check className="size-3" strokeWidth={3} aria-hidden /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}
