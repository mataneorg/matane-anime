import { join } from 'node:path';
import { DEFAULT_WINDOW_STATE, WINDOW_STATE_KEY, type WindowState, windowStateSchema } from '@matane-anime/shared';
import { BrowserWindow, app, screen, shell } from 'electron';
import type { SettingsRepository } from '../db/repositories/settings';
import { broadcast } from '../ipc/register';
import icon from '../../../resources/icon.png?asset';
import { devServerUrl } from './renderer-url';

/** Drop a saved position that no longer lands on any connected display. */
function isVisibleOnSomeDisplay(state: WindowState): boolean {
  if (state.x === undefined || state.y === undefined) return false;
  const { x, y, width, height } = state;
  return screen.getAllDisplays().some(({ workArea: a }) => {
    return x < a.x + a.width && x + width > a.x && y < a.y + a.height && y + height > a.y;
  });
}

function readWindowState(settings: SettingsRepository): WindowState {
  const parsed = windowStateSchema.safeParse(settings.getValue<unknown>(WINDOW_STATE_KEY, null));
  return parsed.success ? parsed.data : DEFAULT_WINDOW_STATE;
}

export interface MainWindowOptions {
  /** A start at login with a working tray: the window stays hidden until the tray opens it (UPD-9). */
  startHidden?: boolean;
  /** Closing hides the window instead of destroying it (close to tray). */
  shouldHideOnClose?: () => boolean;
}

export function createMainWindow(settings: SettingsRepository, options: MainWindowOptions = {}): BrowserWindow {
  const saved = readWindowState(settings);
  const bounds = isVisibleOnSomeDisplay(saved)
    ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
    : { width: saved.width, height: saved.height };
  const isMac = process.platform === 'darwin';

  const window = new BrowserWindow({
    ...bounds,
    minWidth: 960,
    minHeight: 600,
    show: false,
    // Custom title bar (docs/PRD.md UI-1); macOS keeps its native traffic lights.
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    // Mocha `base`, so the window never flashes white while the renderer loads.
    backgroundColor: '#1e1e2e',
    // macOS takes the icon from the app bundle.
    ...(isMac ? {} : { icon }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  if (saved.maximized) window.maximize();
  window.once('ready-to-show', () => {
    if (!options.startHidden) window.show();
  });

  const saveState = (): void => {
    if (window.isDestroyed()) return;
    const normal = window.getNormalBounds();
    const state: WindowState = {
      x: normal.x,
      y: normal.y,
      width: normal.width,
      height: normal.height,
      maximized: window.isMaximized(),
    };
    settings.setValue(WINDOW_STATE_KEY, state);
  };
  window.on('close', saveState);
  window.on('close', (event) => {
    if (!options.shouldHideOnClose?.()) return;
    event.preventDefault();
    window.hide();
  });

  window.on('maximize', () => broadcast('window.maximizeChanged', true));
  window.on('unmaximize', () => broadcast('window.maximizeChanged', false));

  // The renderer never navigates away or opens windows; external links go to the system browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-redirect', (event) => event.preventDefault());

  const devUrl = devServerUrl(process.env['ELECTRON_RENDERER_URL'], app.isPackaged);
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadFile(join(__dirname, '../renderer/index.html'));

  return window;
}
