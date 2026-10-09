import { type VariantProps, cva } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@renderer/lib/utils';

export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // One primary button per view (Design System, Accent).
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'border border-input bg-secondary text-secondary-foreground hover:bg-ctp-surface1',
        ghost: 'bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground',
        destructive: 'border border-destructive/40 text-danger-text hover:bg-destructive/10',
      },
      size: {
        default: 'h-9 px-4',
        // Kept for existing call sites: `md` is the default size, `lg` the taller one used for page-level actions.
        md: 'h-9 px-4',
        lg: 'h-10 px-5',
        sm: 'h-8 px-3 text-xs',
        icon: 'size-8',
        'icon-sm': "size-7 [&_svg:not([class*='size-'])]:size-3.5",
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

/** `asChild` renders the child (e.g. a router Link) with button styling. */
export function Button({ className, variant, size, type = 'button', asChild = false, ...props }: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);
  if (asChild) return <Slot.Root className={classes} {...props} />;
  return <button type={type} className={classes} {...props} />;
}
