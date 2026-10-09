import type { LibraryDisplay, LibraryItem } from '@matane-anime/shared';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useLayoutEffect, useRef } from 'react';
import { useScroller } from '@renderer/lib/useScroller';
import { LibraryCard } from './LibraryCard';
import { gridLayout } from './layout';
import type { PickEvent } from './selection';

/**
 * A grid of any size: only the rows in view are in the DOM (LIB-9). The column count follows the width and the
 * chosen cover size, and the row height follows the card width (see `gridLayout`), so no row has to be measured.
 */
export function LibraryGrid({
  items,
  display,
  coverSize,
  selecting,
  selected,
  onPick,
}: {
  items: LibraryItem[];
  display: LibraryDisplay;
  coverSize: number;
  selecting: boolean;
  selected: Set<number>;
  onPick: (event: PickEvent, animeId: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { scroller, margin, width } = useScroller(ref);
  const { columns, gap, rowHeight } = gridLayout(display, width, coverSize);
  const rowCount = Math.ceil(items.length / columns);

  // The compiler skips memoizing this component, which is fine: it only renders the rows in view.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scroller,
    estimateSize: () => rowHeight,
    overscan: 3,
    scrollMargin: margin,
  });

  // The virtualizer keeps the row sizes it computed, so a new layout (another display, cover size or width) needs
  // them again. The first card in view stays in view: its row is found again in the new column count.
  const layoutKey = `${columns}:${rowHeight}`;
  const settled = useRef({ key: layoutKey, width, firstItem: 0 });
  useLayoutEffect(() => {
    const before = settled.current;
    if (before.key === layoutKey) {
      settled.current = { key: layoutKey, width, firstItem: (virtualizer.range?.startIndex ?? 0) * columns };
      return;
    }
    virtualizer.measure();
    // Not for the first measurement of the width: the page restores its own scroll position then.
    if (before.width > 0 && width > 0 && before.firstItem > 0) {
      virtualizer.scrollToIndex(Math.floor(before.firstItem / columns), { align: 'start' });
    }
    settled.current = { ...before, key: layoutKey, width };
  });

  return (
    <div ref={ref} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
      {width > 0
        ? virtualizer.getVirtualItems().map((row) => (
            <div
              key={row.index}
              className="absolute top-0 left-0 grid w-full"
              style={{
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gap,
                height: rowHeight - gap,
                transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)`,
              }}
            >
              {items.slice(row.index * columns, row.index * columns + columns).map((item) => (
                <LibraryCard
                  key={item.animeId}
                  item={item}
                  display={display}
                  selecting={selecting}
                  selected={selected.has(item.animeId)}
                  onPick={(event) => onPick(event, item.animeId)}
                />
              ))}
            </div>
          ))
        : null}
    </div>
  );
}
