import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Minus, Square, X } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { appInfoQuery, ipc, useIpcEvent, windowMaximizedQuery } from '@renderer/lib/ipc';

/** Minimize, maximize and close for the frameless window. macOS keeps its own traffic lights. */
export function WindowControls() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data: info } = useQuery(appInfoQuery);
  const { data: maximized } = useQuery(windowMaximizedQuery);

  useIpcEvent(
    'window.maximizeChanged',
    useCallback((value: boolean) => queryClient.setQueryData(windowMaximizedQuery.queryKey, value), [queryClient]),
  );

  if (info?.platform === 'darwin') return null;

  const buttonClass =
    'no-drag flex h-10 w-[46px] items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';
  return (
    <div className="flex">
      <button
        type="button"
        className={buttonClass}
        aria-label={t('titleBar.minimize')}
        onClick={() => void ipc.invoke('window.minimize')}
      >
        <Minus className="size-3.5" strokeWidth={1.75} aria-hidden />
      </button>
      <button
        type="button"
        className={buttonClass}
        aria-label={maximized ? t('titleBar.restore') : t('titleBar.maximize')}
        onClick={() => void ipc.invoke('window.toggleMaximize')}
      >
        {maximized ? (
          <Copy className="size-3.5" strokeWidth={1.75} aria-hidden />
        ) : (
          <Square className="size-3" strokeWidth={1.75} aria-hidden />
        )}
      </button>
      <button
        type="button"
        className={`${buttonClass} hover:bg-destructive hover:text-destructive-foreground`}
        aria-label={t('titleBar.close')}
        onClick={() => void ipc.invoke('window.close')}
      >
        <X className="size-3.5" strokeWidth={1.75} aria-hidden />
      </button>
    </div>
  );
}
