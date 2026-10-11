import { describe, expect, it } from 'vitest';
import { type TextContextParams, buildTextContextMenu } from './context-menu';

const allowed = { canUndo: true, canRedo: true, canCut: true, canCopy: true, canPaste: true, canSelectAll: true };
const none = { canUndo: false, canRedo: false, canCut: false, canCopy: false, canPaste: false, canSelectAll: false };

function params(overrides: Partial<TextContextParams>): TextContextParams {
  return { isEditable: false, selectionText: '', editFlags: none, ...overrides };
}

describe('buildTextContextMenu', () => {
  it('offers the editing commands in an editable field', () => {
    const template = buildTextContextMenu(params({ isEditable: true, editFlags: allowed }));
    expect(template.map((item) => item.role ?? item.type)).toEqual([
      'undo',
      'redo',
      'separator',
      'cut',
      'copy',
      'paste',
      'separator',
      'selectAll',
    ]);
    expect(template.filter((item) => item.role).every((item) => item.enabled)).toBe(true);
  });

  it('enables each command from the edit flags', () => {
    const template = buildTextContextMenu(
      params({ isEditable: true, editFlags: { ...none, canPaste: true, canSelectAll: true } }),
    );
    const enabled = Object.fromEntries(template.filter((item) => item.role).map((item) => [item.role, item.enabled]));
    expect(enabled).toEqual({ undo: false, redo: false, cut: false, copy: false, paste: true, selectAll: true });
  });

  it('still shows the field menu with a selection inside it', () => {
    const template = buildTextContextMenu(params({ isEditable: true, selectionText: 'abc', editFlags: allowed }));
    expect(template).toHaveLength(8);
  });

  it('offers Copy for selected text outside a field', () => {
    const template = buildTextContextMenu(params({ selectionText: 'Frieren', editFlags: allowed }));
    expect(template).toEqual([{ role: 'copy', enabled: true }]);
  });

  it('shows nothing without a field or a selection', () => {
    expect(buildTextContextMenu(params({ editFlags: allowed }))).toEqual([]);
  });

  it('ignores a whitespace-only selection', () => {
    expect(buildTextContextMenu(params({ selectionText: ' \n ', editFlags: allowed }))).toEqual([]);
  });
});
