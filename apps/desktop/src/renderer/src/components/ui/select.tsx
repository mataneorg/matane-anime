import type { ComponentProps } from 'react';
import { cn } from '@renderer/lib/utils';

/** The platform's own select, styled like the other controls (it keeps keyboard and accessibility for free). */
export function Select({ className, ...props }: ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'h-9 rounded-lg border border-input bg-background px-2 text-foreground',
        'focus-visible:border-primary focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}
