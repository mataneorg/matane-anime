import type { DownloadRefusal, EnqueueResult } from '@matane-anime/shared';

export interface EnqueueFeedback {
  queued: number;
  existing: number;
  /** Refused only because of the size limit: the user may still say yes (DL-10). */
  overLimit: number[];
  /** Refused for good reasons, counted per reason. */
  refused: { reason: Exclude<DownloadRefusal, 'size_limit'>; count: number }[];
}

/** What to tell the user about the answer to `downloads.enqueue`. */
export function summarizeEnqueue(result: EnqueueResult): EnqueueFeedback {
  const counts = new Map<Exclude<DownloadRefusal, 'size_limit'>, number>();
  const overLimit: number[] = [];
  for (const { episodeId, reason } of result.refused) {
    if (reason === 'size_limit') overLimit.push(episodeId);
    else counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return {
    queued: result.queued.length,
    existing: result.existing.length,
    overLimit,
    refused: [...counts].map(([reason, count]) => ({ reason, count })),
  };
}
