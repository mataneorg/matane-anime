import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

/** What a failed list or page shows: what happened, in words, and what to do about it. */
export function ErrorState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div role="alert" className="flex flex-col items-center gap-4 p-8 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <TriangleAlert className="size-7" strokeWidth={1.75} aria-hidden />
      </div>
      <div className="flex max-w-md flex-col gap-1.5">
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? <p className="text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
