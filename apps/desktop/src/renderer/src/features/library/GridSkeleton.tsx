import type { LibraryDisplay } from '@matane-anime/shared';
import { Skeleton } from '@renderer/components/ui/skeleton';
import { gridGap } from './layout';

/** The shape of the grid while the library loads: the columns the chosen display and cover size would make. */
export function GridSkeleton({ display, coverSize }: { display: LibraryDisplay; coverSize: number }) {
  if (display === 'list') {
    return (
      <div aria-busy>
        {Array.from({ length: 8 }, (_, index) => (
          <div key={index} className="flex h-16 items-center gap-3 border-b px-2">
            <Skeleton className="aspect-[2/3] h-12 rounded" />
            <Skeleton className="h-3.5 w-1/3" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(${coverSize}px, 1fr))`,
        gap: gridGap(display),
      }}
      aria-busy
    >
      {Array.from({ length: 12 }, (_, index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="aspect-[2/3] w-full rounded-lg" />
          {display === 'comfortable' ? <Skeleton className="h-4 w-3/4" /> : null}
        </div>
      ))}
    </div>
  );
}
