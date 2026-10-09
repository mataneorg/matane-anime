import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@renderer/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const overlayClass = 'fixed inset-0 z-40 bg-ctp-crust/70 backdrop-blur-sm';

/**
 * A centered modal on a dimmed, blurred scrim. The header (title, description, close button) is separated by a
 * border; the children scroll in the body. Put the buttons in a `DialogFooter` as the last child.
 */
export function DialogContent({
  title,
  description,
  children,
  className,
  closeLabel,
  ...props
}: Omit<ComponentProps<typeof DialogPrimitive.Content>, 'title'> & {
  title: ReactNode;
  description?: ReactNode;
  closeLabel: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayClass} />
      <DialogPrimitive.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[min(520px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border bg-popover text-popover-foreground shadow-2xl',
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div className="flex min-w-0 flex-col gap-1">
            <DialogPrimitive.Title className="text-base leading-6 font-semibold">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-xs leading-4 text-muted-foreground">
                {description}
              </DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close
            aria-label={closeLabel}
            className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" strokeWidth={1.75} aria-hidden />
          </DialogPrimitive.Close>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 py-4">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** The action row at the bottom of a dialog: bordered on top, buttons on the right. Use as the last child. */
export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn('-mx-5 mt-4 -mb-4 flex items-center justify-end gap-2 border-t px-5 py-4', className)}
      {...props}
    />
  );
}

/**
 * A modal without the header and close button, for content that draws its own (the command palette). `title` is
 * only for screen readers.
 */
export function DialogBareContent({
  title,
  children,
  className,
  ...props
}: Omit<ComponentProps<typeof DialogPrimitive.Content>, 'title'> & { title: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={overlayClass} />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        className={cn(
          'fixed top-24 left-1/2 z-50 flex max-h-[min(560px,calc(100vh-128px))] w-[min(640px,calc(100vw-48px))] -translate-x-1/2 flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl',
          className,
        )}
        {...props}
      >
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
