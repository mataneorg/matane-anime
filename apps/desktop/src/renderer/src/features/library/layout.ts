import type { LibraryDisplay } from '@matane-anime/shared';

/** Height of one row in the list display. */
export const LIST_ROW_HEIGHT = 64;
/** Under a comfortable cover: the 8 px gap, a two-line title (2 × ~18 px) and the subtitle line (16 px). */
const TEXT_HEIGHT = 60;

/** The space between cards: the comfortable display breathes, the others pack tighter, the list has none. */
export const gridGap = (display: LibraryDisplay): number =>
  display === 'comfortable' ? 16 : display === 'list' ? 0 : 10;

/** How many cards of at least `size` px fit in `width`, with `gap` between them. */
export const columnCount = (width: number, size: number, gap: number): number =>
  Math.max(1, Math.floor((width + gap) / (size + gap)));

export interface GridLayout {
  columns: number;
  gap: number;
  /** One virtual row: the cards plus the gap below them. */
  rowHeight: number;
}

/**
 * The columns and row height of a grid `width` px wide. The row height follows the card width (a 2:3 cover plus
 * its text, if the display has any), so a virtualizer never has to measure a row.
 */
export function gridLayout(display: LibraryDisplay, width: number, size: number): GridLayout {
  const gap = gridGap(display);
  if (display === 'list') return { columns: 1, gap, rowHeight: LIST_ROW_HEIGHT };
  const columns = columnCount(width, size, gap);
  const cardWidth = width > 0 ? (width - gap * (columns - 1)) / columns : size;
  const text = display === 'comfortable' ? TEXT_HEIGHT : 0;
  return { columns, gap, rowHeight: Math.round(cardWidth * 1.5 + text + gap) };
}
