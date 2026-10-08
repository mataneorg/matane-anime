import type { LibraryItem } from '@matane-anime/shared';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { useScroller } from '@renderer/lib/useScroller';
import { LibraryCard } from './LibraryCard';

const GAP = 16;
const MIN_CARD = 170;
const TEXT = 56; // title (two lines) and subtitle under the cover

/**
 * A grid of any size: only the rows in view are in the DOM (LIB-9). The column count follows the width, and
 * the row height follows the card width (a 2:3 cover plus its text), so no row has to be measured.
 */
export function LibraryGrid({
  items,
  selecting,
  selected,
  onToggle,
}: {
  items: LibraryItem[];
  selecting: boolean;
  selected: Set<number>;
  onToggle: (animeId: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { scroller, margin, width } = useScroller(ref);
  const columns = Math.max(1, Math.floor((width + GAP) / (MIN_CARD + GAP)));
  const cardWidth = columns > 0 && width > 0 ? (width - GAP * (columns - 1)) / columns : MIN_CARD;
  const rowHeight = Math.round(cardWidth * 1.5 + TEXT + GAP);
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

  return (
    <div ref={ref} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
      {width > 0
        ? virtualizer.getVirtualItems().map((row) => (
            <div
              key={row.index}
              className="absolute top-0 left-0 grid w-full"
              style={{
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gap: GAP,
                height: rowHeight - GAP,
                transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)`,
              }}
            >
              {items.slice(row.index * columns, row.index * columns + columns).map((item) => (
                <LibraryCard
                  key={item.animeId}
                  item={item}
                  selecting={selecting}
                  selected={selected.has(item.animeId)}
                  onToggle={() => onToggle(item.animeId)}
                />
              ))}
            </div>
          ))
        : null}
    </div>
  );
}
