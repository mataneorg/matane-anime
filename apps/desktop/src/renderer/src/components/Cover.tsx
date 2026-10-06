import { ImageOff } from 'lucide-react';
import { useState } from 'react';
import { coverSrc } from '@renderer/lib/catalog';
import { cn } from '@renderer/lib/utils';

/** A cover loaded through `anime://cover`, with a quiet placeholder when there is none or it fails. */
export function Cover({ sourceId, url, className }: { sourceId: string; url: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  const src = coverSrc(sourceId, url);
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
