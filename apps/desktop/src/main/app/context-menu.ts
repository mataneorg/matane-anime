import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';

/** The part of Electron's `context-menu` event params that decides the menu, so tests need no Electron. */
export interface TextContextParams {
  isEditable: boolean;
  selectionText: string;
  editFlags: {
    canUndo: boolean;
    canRedo: boolean;
    canCut: boolean;
    canCopy: boolean;
    canPaste: boolean;
    canSelectAll: boolean;
  };
}

/**
 * The native menu for text: editing commands in a field, Copy for selected text elsewhere. An empty template means
 * "show nothing", which keeps the renderer's own menus (Radix, on cards and rows) from being doubled. Items are roles,
 * so the OS supplies labels and shortcuts; spell-check suggestions are out of scope.
 */
export function buildTextContextMenu({
  isEditable,
  selectionText,
  editFlags,
}: TextContextParams): MenuItemConstructorOptions[] {
  if (isEditable) {
    return [
      { role: 'undo', enabled: editFlags.canUndo },
      { role: 'redo', enabled: editFlags.canRedo },
      { type: 'separator' },
      { role: 'cut', enabled: editFlags.canCut },
      { role: 'copy', enabled: editFlags.canCopy },
      { role: 'paste', enabled: editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: editFlags.canSelectAll },
    ];
  }
  if (selectionText.trim() !== '') return [{ role: 'copy', enabled: editFlags.canCopy }];
  return [];
}

/**
 * Electron has no built-in context menu, so right-click in an input does nothing without this. A `contextmenu` the
 * renderer handles and `preventDefault`s never reaches here, and the builder stays silent for anything but text.
 */
export function attachTextContextMenu(window: BrowserWindow): void {
  window.webContents.on('context-menu', (_event, params) => {
    const template = buildTextContextMenu(params);
    if (template.length > 0) Menu.buildFromTemplate(template).popup({ window });
  });
}
