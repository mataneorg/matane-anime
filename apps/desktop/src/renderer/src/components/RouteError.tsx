import { Link } from '@tanstack/react-router';
import log from 'electron-log/renderer';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorState } from './ErrorState';
import { Button } from './ui/button';

/** What a route that threw shows instead of a blank window; the rest of the app keeps working. */
export function RouteError({ error, reset }: { error: unknown; reset: () => void }) {
  const { t } = useTranslation();
  useEffect(() => log.error('a route crashed', error), [error]);
  return (
    <ErrorState
      className="min-h-full justify-center"
      description={t('errors.crash')}
      action={
        <div className="flex gap-2">
          <Button variant="secondary" onClick={reset}>
            {t('browse.retry')}
          </Button>
          <Button variant="ghost" onClick={() => window.location.reload()}>
            {t('errors.reload')}
          </Button>
        </div>
      }
    />
  );
}

export function RouteNotFound() {
  const { t } = useTranslation();
  return (
    <ErrorState
      className="min-h-full justify-center"
      title={t('errors.notFoundPage')}
      action={
        <Button asChild variant="secondary">
          <Link to="/library">{t('errors.backToLibrary')}</Link>
        </Button>
      }
    />
  );
}
