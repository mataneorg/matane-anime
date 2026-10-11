import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { createContext, useCallback, useContext, useState } from 'react';
import type { ComponentProps, ReactNode } from 'react';
import { AnimatePresence, fade, m, scaleIn } from '@renderer/lib/motion';
import { cn } from '@renderer/lib/utils';

/**
 * Whether the enclosing `Dialog` is open. The content parts need it to drive their own mount: Radix would unmount a
 * closing dialog at once, so they stay mounted (`forceMount`) and let `AnimatePresence` remove them after the exit.
 */
const DialogOpenContext = createContext(false);

/** Same props and behaviour as the Radix root; it only also tracks `open` (controlled or not) for the exit animation. */
export function Dialog({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  ...props
}: ComponentProps<typeof DialogPrimitive.Root>) {
  const [innerOpen, setInnerOpen] = useState(defaultOpen);
  const open = openProp ?? innerOpen;
  const handleOpenChange = useCallback(
    (next: boolean) => {
      setInnerOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  return (
    <DialogOpenContext.Provider value={open}>
      <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange} {...props} />
    </DialogOpenContext.Provider>
  );
}
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const overlayClass = 'fixed inset-0 z-40 bg-ctp-crust/70 backdrop-blur-sm';

/**
 * The shared shell of both content kinds: the scrim and the card, each mounted only while open and animated in and out.
 * The card sits in a full-screen flex `frame` that does the positioning (a CSS `translate` would fight the transform
 * motion writes). The frame ignores the pointer so a click beside the card reaches the scrim, which Radix treats as an
 * outside click, exactly as before.
 */
function AnimatedDialog({
  frameClass,
  contentClass,
  children,
  ...props
}: Omit<ComponentProps<typeof DialogPrimitive.Content>, 'title' | 'className'> & {
  frameClass: string;
  contentClass: string;
}) {
  const open = useContext(DialogOpenContext);
  return (
    <DialogPrimitive.Portal forceMount>
      <AnimatePresence>
        {open ? (
          <DialogPrimitive.Overlay key="overlay" forceMount asChild>
            <m.div className={overlayClass} variants={fade} initial="hidden" animate="visible" exit="hidden" />
          </DialogPrimitive.Overlay>
        ) : null}
        {open ? (
          <div key="frame" className={cn('pointer-events-none fixed inset-0 z-50 flex justify-center', frameClass)}>
            <DialogPrimitive.Content {...props} forceMount asChild>
              <m.div
                className={cn('pointer-events-auto', contentClass)}
                variants={scaleIn}
                initial="hidden"
                animate="visible"
                exit="hidden"
              >
                {children}
              </m.div>
            </DialogPrimitive.Content>
          </div>
        ) : null}
      </AnimatePresence>
    </DialogPrimitive.Portal>
  );
}

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
    <AnimatedDialog
      frameClass="items-center"
      contentClass={cn(
        'flex max-h-[85vh] w-[min(520px,calc(100vw-48px))] flex-col rounded-xl border bg-popover text-popover-foreground shadow-2xl',
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
    </AnimatedDialog>
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
    <AnimatedDialog
      frameClass="items-start pt-24"
      contentClass={cn(
        'flex max-h-[min(560px,calc(100vh-128px))] w-[min(640px,calc(100vw-48px))] flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl',
        className,
      )}
      aria-describedby={undefined}
      {...props}
    >
      <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
      {children}
    </AnimatedDialog>
  );
}
