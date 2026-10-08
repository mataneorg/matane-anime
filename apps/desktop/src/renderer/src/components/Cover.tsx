import { ImageOff } from 'lucide-react';
import { useState } from 'react';
import { coverSrc } from '@renderer/lib/catalog';
import { localCoverSrc } from '@renderer/lib/library';
import { cn } from '@renderer/lib/utils';

/** A cover loaded through `anime://cover`, with a quiet placeholder when there is none or it fails. */
export function Cover({
  sourceId,
  url,
  localAnimeId,
  className,
}: {
  sourceId: string;
  url: string | null;
  /** Set when the anime has a permanent cover on disk (library): it is used instead of the site's image. */
  localAnimeId?: number | undefined;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = localAnimeId !== undefined ? localCoverSrc(localAnimeId) : coverSrc(sourceId, url);
  return (
    <div className={cn('relative overflow-hidden bg-card', className)}>
      {src && !failed ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground">
          <ImageOff className="size-6" strokeWidth={1.5} aria-hidden />
        </div>
      )}
    </div>
  );
}
