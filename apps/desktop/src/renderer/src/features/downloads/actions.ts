import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { call } from '@renderer/lib/api';
import { describeError } from '@renderer/lib/errors';
import { notify } from '@renderer/lib/toast';

/**
 * The controls of one download or of all. Main answers each with a `db.changed` event, which refreshes the
 * lists, so these only report what went wrong.
 */
export function useDownloadActions() {
  const { t } = useTranslation();
  const onError = (error: unknown): void => notify.error(t('downloads.actionFailed'), describeError(error, t));
  return {
    pause: useMutation({ mutationFn: (id: number) => call('downloads.pause', { id }), onError }),
    resume: useMutation({ mutationFn: (id: number) => call('downloads.resume', { id }), onError }),
    cancel: useMutation({ mutationFn: (id: number) => call('downloads.cancel', { id }), onError }),
    remove: useMutation({ mutationFn: (id: number) => call('downloads.remove', { id }), onError }),
    retry: useMutation({ mutationFn: (id: number) => call('downloads.retry', { id }), onError }),
    retryAll: useMutation({
      mutationFn: (ids: readonly number[]) => Promise.all(ids.map((id) => call('downloads.retry', { id }))),
      onError,
    }),
    pauseAll: useMutation({ mutationFn: () => call('downloads.pauseAll'), onError }),
    resumeAll: useMutation({ mutationFn: () => call('downloads.resumeAll'), onError }),
    clearFailed: useMutation({ mutationFn: () => call('downloads.clearFailed'), onError }),
  };
}
