import { BrowserWindow, Notification } from 'electron';
import type { UpdateNotification } from './service';

// Held until clicked or closed: a notification that is garbage collected never fires its events.
const open = new Set<Notification>();

/** The desktop notification for new episodes (UPD-7). Kept trivial: it only adapts Electron to the service. */
export function showUpdateNotification({ title, body, onClick }: UpdateNotification): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title, body });
  open.add(notification);
  notification.on('click', onClick);
  notification.on('close', () => open.delete(notification));
  notification.show();
}

export const isWindowFocused = (): boolean => BrowserWindow.getAllWindows().some((window) => window.isFocused());
