import type { ComponentProps } from 'react';
import { cn } from '@renderer/lib/utils';

type Tone = 'neutral' | 'accent' | 'warning' | 'danger';

const tones: Record<Tone, string> = {
  neutral: 'bg-card text-foreground',
  accent: 'bg-accent/16 text-foreground',
  warning: 'bg-warning/16 text-foreground',
  danger: 'bg-danger/16 text-foreground',
};

/** A small label. Status is always a word too, never color alone. */
export function Badge({ tone = 'neutral', className, ...props }: ComponentProps<'span'> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-full px-2 text-xs leading-4 font-medium',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
