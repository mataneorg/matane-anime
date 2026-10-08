import {
  AppError,
  type DownloadItem,
  type DownloadStorage,
  type EnqueueInput,
  type EnqueueResult,
} from '@matane-anime/shared';
import type { DownloadsRepository } from '../db/repositories/downloads';

export type EnqueueReason = 'manual' | 'auto' | 'ahead';

export interface DownloadServiceDeps {
  downloads: DownloadsRepository;
}

const notYet = (): never => {
  throw new AppError('unsupported', 'Downloading is not available yet');
};

/**
 * Owns the download queue and the files (docs/PRD.md DL-1…10, docs/plans/fase-3-download-update-beta.md).
 * Milestone 3a only fixes the shape other services call: the engine arrives in 3b.
 */
export class DownloadService {
  constructor(private readonly deps: DownloadServiceDeps) {}

  list(): DownloadItem[] {
    return this.deps.downloads.list();
  }

  /** `reason` tells manual downloads (which may pass the size limit once confirmed) from automatic ones. */
  enqueue(_input: EnqueueInput, _options: { reason: EnqueueReason } = { reason: 'manual' }): Promise<EnqueueResult> {
    return Promise.resolve(notYet());
  }

  pause(_id: number): void {
    notYet();
  }
  resume(_id: number): void {
    notYet();
  }
  pauseAll(): void {
    notYet();
  }
  resumeAll(): void {
    notYet();
  }
  cancel(_id: number): void {
    notYet();
  }
  remove(_id: number): void {
    notYet();
  }
  retry(_id: number): void {
    notYet();
  }
  reorder(_ids: number[]): void {
    notYet();
  }
  clearFailed(): void {
    notYet();
  }
  changeFolder(_folder: string, _move: boolean): Promise<void> {
    return Promise.resolve(notYet());
  }

  storage(): DownloadStorage {
    return notYet();
  }
}
