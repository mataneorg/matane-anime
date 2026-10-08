import { Check } from 'lucide-react';
import { DropdownMenu as MenuPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@renderer/lib/utils';

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;

export function DropdownMenuContent({ className, ...props }: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        align="end"
        sideOffset={6}
        className={cn('z-50 min-w-48 rounded-xl border bg-popover p-1 shadow-xl', className)}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof MenuPrimitive.Item>) {
  return (
    <MenuPrimitive.Item
      className={cn(
        'flex h-9 cursor-pointer items-center gap-2 rounded-lg px-3 text-foreground outline-none data-disabled:cursor-not-allowed data-disabled:opacity-50 data-highlighted:bg-input/60',
        className,
      )}
      {...props}
    />
  );
}

/** A menu item with a check mark that stays open while several are toggled. */
export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.CheckboxItem>) {
  return (
    <MenuPrimitive.CheckboxItem
      className={cn(
        'group flex h-9 cursor-pointer items-center gap-2 rounded-lg pr-3 pl-2 text-foreground outline-none data-highlighted:bg-input/60',
        className,
      )}
      onSelect={(event) => event.preventDefault()}
      {...props}
    >
      <span className="flex size-4 items-center justify-center rounded border border-border-strong group-data-[state=checked]:border-accent group-data-[state=checked]:bg-accent">
        <MenuPrimitive.ItemIndicator>
          <Check className="size-3 text-on-accent" strokeWidth={3} aria-hidden />
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}
