import { Menu, Tray, nativeImage } from 'electron';
import type { TrayAction, TrayHandle, TrayMenuItem } from './system';
import icon from '../../../resources/icon.png?asset';

/**
 * The OS tray icon (docs/PRD.md UPD-9). Only adapts Electron to `SystemIntegration`; throws where the platform
 * has no tray, which the caller catches. On Linux creation usually succeeds even without an AppIndicator host,
 * so nothing may rely on the icon being visible.
 */
export function createElectronTray(onAction: (action: TrayAction) => void): TrayHandle {
  const size = process.platform === 'darwin' ? 18 : 22;
  const tray = new Tray(nativeImage.createFromPath(icon).resize({ width: size, height: size }));
  // Windows and macOS emit `click`; Linux appindicators do not, hence the menu's "Open" item.
  tray.on('click', () => onAction('open'));
  return {
    update(tooltip: string, items: TrayMenuItem[]): void {
      tray.setToolTip(tooltip);
      tray.setContextMenu(
        Menu.buildFromTemplate(
          items.map((item) =>
            item.type === 'separator'
              ? { type: 'separator' as const }
              : { label: item.label, click: () => onAction(item.id) },
          ),
        ),
      );
    },
    destroy(): void {
      if (!tray.isDestroyed()) tray.destroy();
    },
  };
}
