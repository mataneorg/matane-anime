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
  const src = localAnimeId !== undefined ? localCoverSrc(localAnimeId) : coverSrc(sourceId, url);
  // Remount when the cover changes so the load state starts over (details just filled it in, say).
  return <CoverImage key={src ?? ''} src={src} className={className} />;
}

function CoverImage({ src, className }: { src: string | null; className?: string }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>(src ? 'loading' : 'failed');
  return (
    <div className={cn('relative overflow-hidden bg-muted', className)}>
      {src && state !== 'failed' ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
          className={cn(
            'size-full object-cover transition-opacity duration-200',
            state === 'loaded' ? 'opacity-100' : 'opacity-0',
          )}
        />
      ) : null}
      {state === 'loading' ? <div aria-hidden className="absolute inset-0 animate-pulse bg-muted" /> : null}
      {state === 'failed' ? (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <ImageOff className="size-6" strokeWidth={1.5} aria-hidden />
        </div>
      ) : null}
    </div>
  );
}
