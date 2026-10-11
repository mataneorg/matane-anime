import { Check } from 'lucide-react';
import { ContextMenu as MenuPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@renderer/lib/utils';
import { menuContentClass, menuItemClass } from './dropdown-menu';

// The right-click twin of `dropdown-menu.tsx`: same surface and rows, opened by the `contextmenu` event (or the
// Menu key / Shift+F10) on the element wrapped in `ContextMenuTrigger asChild`.

export const ContextMenu = MenuPrimitive.Root;
export const ContextMenuTrigger = MenuPrimitive.Trigger;

export function ContextMenuContent({ className, ...props }: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content collisionPadding={8} className={cn(menuContentClass, className)} {...props} />
    </MenuPrimitive.Portal>
  );
}

/** A menu row; `destructive` paints it as a removal, and such rows go last in the menu, after a separator. */
export function ContextMenuItem({
  className,
  destructive,
  ...props
}: ComponentProps<typeof MenuPrimitive.Item> & { destructive?: boolean }) {
  return (
    <MenuPrimitive.Item
      className={cn(menuItemClass, '[&_svg]:size-4 [&_svg]:shrink-0', destructive && 'text-danger-text', className)}
      {...props}
    />
  );
}

export function ContextMenuSeparator({ className, ...props }: ComponentProps<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}

export function ContextMenuLabel({ className, ...props }: ComponentProps<typeof MenuPrimitive.Label>) {
  return (
    <MenuPrimitive.Label
      className={cn('px-2 py-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase', className)}
      {...props}
    />
  );
}

/** A menu item with a check mark that stays open while several are toggled. */
export function ContextMenuCheckboxItem({
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
