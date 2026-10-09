import type { ComponentProps } from 'react';
import { cn } from '@renderer/lib/utils';

/** A pulsing placeholder block for content that is still loading. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}
