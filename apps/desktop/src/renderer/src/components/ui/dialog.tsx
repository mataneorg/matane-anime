import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@renderer/lib/utils';

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/** A centered modal on a dimmed scrim (`popover` surface, 16 px radius). */
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
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/50" />
      <DialogPrimitive.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[min(520px,calc(100vw-48px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-2xl border bg-popover p-6 shadow-xl',
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <DialogPrimitive.Title className="text-lg leading-6 font-semibold">{title}</DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="text-xs leading-4">{description}</DialogPrimitive.Description>
            ) : null}
          </div>
          <DialogPrimitive.Close
            aria-label={closeLabel}
            className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-input/50"
          >
            <X className="size-4" strokeWidth={1.75} aria-hidden />
          </DialogPrimitive.Close>
        </div>
        <div className="min-h-0 overflow-y-auto">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
