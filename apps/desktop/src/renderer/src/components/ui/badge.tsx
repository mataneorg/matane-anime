import { type VariantProps, cva } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@renderer/lib/utils';

export const badgeVariants = cva(
  'inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap [&_svg]:size-3',
  {
    variants: {
      variant: {
        default: 'border-input bg-muted text-foreground',
        outline: 'border-transparent text-muted-foreground',
        primary: 'border-primary/40 bg-primary/15 text-primary-text',
        success: 'border-ctp-green/40 bg-ctp-green/10 text-success-text',
        warning: 'border-ctp-peach/40 bg-ctp-peach/10 text-warning-text',
        danger: 'border-destructive/40 bg-destructive/10 text-danger-text',
        info: 'border-ctp-blue/40 bg-ctp-blue/10 text-info-text',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

/** The older `tone` names, kept so existing call sites keep working; they map onto `variant`. */
const toneVariants = {
  neutral: 'default',
  accent: 'primary',
  warning: 'warning',
  danger: 'danger',
} as const;

/** A small label. Status is always a word too, never color alone. */
export function Badge({
  variant,
  tone,
  className,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { tone?: keyof typeof toneVariants }) {
  return (
    <span
      className={cn(badgeVariants({ variant: variant ?? (tone ? toneVariants[tone] : undefined) }), className)}
      {...props}
    />
  );
}
