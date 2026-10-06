import type { ComponentProps } from 'react';
import { cn } from '@renderer/lib/utils';

/** A 36 px text field: `input` surface, `border-strong` outline, accent outline on focus. */
export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-9 w-full rounded-lg border border-border-strong bg-input px-3 text-foreground placeholder:text-muted-foreground',
        'focus-visible:border-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
