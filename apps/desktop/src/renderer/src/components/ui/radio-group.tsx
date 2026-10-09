import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@renderer/lib/utils';

export function RadioGroup({ className, ...props }: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root className={cn('flex flex-wrap gap-2', className)} {...props} />;
}

/** A pill-shaped radio option: outlined, with a 2px accent border when selected. */
export function RadioOption({ className, children, ...props }: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        'flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-input bg-background px-3.5 transition-colors',
        'data-[state=checked]:border-2 data-[state=checked]:border-primary data-[state=checked]:px-[13px]',
        className,
      )}
      {...props}
    >
      <span className="flex size-4 items-center justify-center rounded-full border border-input data-[state=checked]:border-primary">
        <RadioGroupPrimitive.Indicator className="size-2 rounded-full bg-primary" />
      </span>
      {children}
    </RadioGroupPrimitive.Item>
  );
}
