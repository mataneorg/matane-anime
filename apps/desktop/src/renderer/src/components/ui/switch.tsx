import { Switch as SwitchPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@renderer/lib/utils';

/** A 44×24 toggle: `input` outline off, `primary` fill on. */
export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'relative h-6 w-11 shrink-0 cursor-pointer rounded-full border border-input bg-background transition-colors',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4.5 translate-x-0.5 rounded-full bg-foreground transition-transform data-[state=checked]:translate-x-5.5 data-[state=checked]:bg-primary-foreground" />
    </SwitchPrimitive.Root>
  );
}
