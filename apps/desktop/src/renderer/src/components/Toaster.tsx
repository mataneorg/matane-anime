import type { CSSProperties } from 'react';
import { Toaster as Sonner } from 'sonner';

const colors = {
  '--normal-bg': 'var(--color-popover)',
  '--normal-text': 'var(--color-foreground)',
  '--normal-border': 'var(--color-border-strong)',
  '--success-bg': 'var(--color-popover)',
  '--success-text': 'var(--color-foreground)',
  '--success-border': 'var(--color-success)',
  '--error-bg': 'var(--color-popover)',
  '--error-text': 'var(--color-foreground)',
  '--error-border': 'var(--color-danger)',
} as CSSProperties;

/** The app's toasts, in the design system's colors (the flavor is on <html>, so the tokens follow it). */
export function Toaster() {
  return <Sonner position="bottom-right" style={colors} toastOptions={{ classNames: { toast: 'font-sans' } }} />;
}
