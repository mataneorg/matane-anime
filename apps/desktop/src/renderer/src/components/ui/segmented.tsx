import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '@renderer/lib/utils';

/**
 * A small single-choice switch (a period, a measure, a display mode): one row of buttons, the chosen one filled.
 * One tab stop for the group; the arrow keys move the choice (and the focus) like any radio group.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  format,
  optionLabel,
  icons = false,
  className,
}: {
  /** Names the group for screen readers. */
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  /** What an option shows: text, or an icon when `icons` is on. */
  format: (value: T) => ReactNode;
  /** The name of an option when `format` has no text (icons); also its tooltip. */
  optionLabel?: (value: T) => string;
  /** Square icon buttons instead of padded text ones. */
  icons?: boolean;
  className?: string;
}) {
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = options[(index + step + options.length) % options.length];
    if (next === undefined) return;
    onChange(next);
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    buttons?.[options.indexOf(next)]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex rounded-lg border', icons ? 'p-0.5' : 'p-1', className)}
    >
      {options.map((option, index) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={option === value}
          aria-label={optionLabel?.(option)}
          title={optionLabel?.(option)}
          tabIndex={option === value ? 0 : -1}
          onClick={() => onChange(option)}
          onKeyDown={(event) => move(event, index)}
          className={cn(
            'transition-colors',
            icons
              ? 'flex size-7 items-center justify-center rounded-md'
              : 'rounded-md px-3 py-1.5 text-xs whitespace-nowrap',
            option === value
              ? icons
                ? 'bg-primary/15 text-primary-text'
                : 'bg-primary font-semibold text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {format(option)}
        </button>
      ))}
    </div>
  );
}
