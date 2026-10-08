import { AppError, type UpdateCheckResult, type UpdateScope, type UpdatesList } from '@matane-anime/shared';

/**
 * Finds new episodes of the library (docs/PRD.md UPD-1…8, docs/plans/fase-3-download-update-beta.md).
 * Milestone 3a only fixes the shape; the scheduler, the skip rules and the Updates query arrive in 3e.
 */
export class UpdateService {
  list(): UpdatesList {
    return { entries: [], lastCheckedAt: null, failed: [] };
  }

  count(): number {
    return 0;
  }

  check(_scope: UpdateScope, _requestId?: string): Promise<UpdateCheckResult> {
    return Promise.reject(new AppError('unsupported', 'Update checks are not available yet'));
  }
}
