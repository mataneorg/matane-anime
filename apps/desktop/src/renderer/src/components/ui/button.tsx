import { type VariantProps, cva } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@renderer/lib/utils';

export const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-semibold whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        // One primary button per view (Design System, Accent).
        default: 'bg-accent text-on-accent hover:bg-accent/90',
        secondary: 'border border-border-strong bg-transparent hover:bg-input/50',
        ghost: 'bg-transparent hover:bg-input/50',
        destructive: 'bg-danger text-on-accent hover:bg-danger/90',
      },
      size: {
        sm: 'h-8 px-3 text-[13px]',
        md: 'h-9 px-4',
        lg: 'h-10 px-5',
        icon: 'size-9',
        'icon-sm': 'size-7',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
