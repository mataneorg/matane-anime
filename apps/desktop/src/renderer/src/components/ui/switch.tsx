import { Switch as SwitchPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@renderer/lib/utils';

/** A 40×24 toggle: `border-strong` outline off, accent fill on (docs/ui/design-system.md). */
export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'relative h-6 w-10 shrink-0 cursor-pointer rounded-full border border-border-strong bg-background transition-colors',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4 translate-x-0.75 rounded-full bg-foreground transition-transform data-[state=checked]:translate-x-4.75 data-[state=checked]:bg-on-accent" />
    </SwitchPrimitive.Root>
  );
}
