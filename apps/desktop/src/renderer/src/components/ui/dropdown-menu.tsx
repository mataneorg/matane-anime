import { Check } from 'lucide-react';
import { DropdownMenu as MenuPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@renderer/lib/utils';

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;

/** The shared menu/popover surface: `rounded-lg border bg-popover p-1 shadow-xl`. */
export const menuContentClass = 'z-50 min-w-48 rounded-lg border bg-popover p-1 text-popover-foreground shadow-xl';
/** The shared menu row: 32 px, `accent` background while highlighted. */
export const menuItemClass =
  'flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-foreground outline-none data-disabled:cursor-not-allowed data-disabled:opacity-50 data-highlighted:bg-accent';

export function DropdownMenuContent({ className, ...props }: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content align="end" sideOffset={6} className={cn(menuContentClass, className)} {...props} />
    </MenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof MenuPrimitive.Item>) {
  return <MenuPrimitive.Item className={cn(menuItemClass, className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}

/** A menu item with a check mark that stays open while several are toggled. */
export function DropdownMenuCheckboxItem({
  className,
  children,
  ...props
}: ComponentProps<typeof MenuPrimitive.CheckboxItem>) {
  return (
    <MenuPrimitive.CheckboxItem
      className={cn('group', menuItemClass, className)}
      onSelect={(event) => event.preventDefault()}
      {...props}
    >
      <span className="flex size-4 items-center justify-center rounded border border-input group-data-[state=checked]:border-primary group-data-[state=checked]:bg-primary">
        <MenuPrimitive.ItemIndicator>
          <Check className="size-3 text-primary-foreground" strokeWidth={3} aria-hidden />
        </MenuPrimitive.ItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}
