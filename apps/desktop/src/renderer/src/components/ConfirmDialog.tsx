import { AlertDialog } from 'radix-ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AnimatePresence, fade, m, scaleIn } from '@renderer/lib/motion';
import { Button } from './ui/button';

/**
 * Asks before something is taken away (or before a costly action): a title, what happens, optional extra content
 * (e.g. a summary of a backup) and Cancel / confirm. `destructive` makes the confirm button the red outline.
 *
 * Built on AlertDialog, so the focus starts on Cancel and a click outside does not dismiss it. The role stays
 * `dialog` (not `alertdialog`) because the pages and specs already address their confirmations by that role.
 *
 * It animates like `ui/dialog.tsx`: the scrim and the card stay mounted (`forceMount`) until `AnimatePresence` has
 * played their exit, and a full-screen flex frame centres the card so no CSS `translate` fights the motion transform.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive = true,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal forceMount>
        <AnimatePresence>
          {open ? (
            <AlertDialog.Overlay key="overlay" forceMount asChild>
              <m.div
                className="fixed inset-0 z-40 bg-ctp-crust/70 backdrop-blur-sm"
                variants={fade}
                initial="hidden"
                animate="visible"
                exit="hidden"
              />
            </AlertDialog.Overlay>
          ) : null}
          {open ? (
            <div key="frame" className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
              <AlertDialog.Content
                role="dialog"
                // Without a description Radix would look for one that is not there and warn.
                {...(description ? {} : { 'aria-describedby': undefined })}
                forceMount
                asChild
              >
                <m.div
                  className="pointer-events-auto flex max-h-[85vh] w-[min(28rem,calc(100vw-48px))] flex-col gap-3 overflow-y-auto rounded-xl border bg-popover p-5 text-popover-foreground shadow-2xl"
                  variants={scaleIn}
                  initial="hidden"
                  animate="visible"
                  exit="hidden"
                >
                  <AlertDialog.Title className="text-base leading-6 font-semibold">{title}</AlertDialog.Title>
                  {description ? (
                    <AlertDialog.Description className="text-muted-foreground">{description}</AlertDialog.Description>
                  ) : null}
                  {children}
                  <div className="mt-2 flex justify-end gap-2">
                    <AlertDialog.Cancel asChild>
                      <Button variant="secondary">{t('common.cancel')}</Button>
                    </AlertDialog.Cancel>
                    <AlertDialog.Action asChild>
                      <Button variant={destructive ? 'destructive' : 'default'} onClick={onConfirm}>
                        {confirmLabel}
                      </Button>
                    </AlertDialog.Action>
                  </div>
                </m.div>
              </AlertDialog.Content>
            </div>
          ) : null}
        </AnimatePresence>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
