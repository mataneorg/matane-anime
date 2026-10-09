import type { ComponentProps } from 'react';
import { cn } from '@renderer/lib/utils';

/** A 36 px text field: `background` surface, `input` outline, `primary` outline on focus. */
export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      className={cn(
        'h-9 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-foreground placeholder:text-muted-foreground',
        'focus-visible:border-primary focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
