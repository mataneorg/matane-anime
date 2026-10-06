import { languageFromLocale } from '@matane-anime/shared/theme';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Outlet, createRootRoute } from '@tanstack/react-router';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { invalidateForTags, networkStatusQuery } from '@renderer/lib/catalog';
import { osLocaleQuery, receiveSettings, settingsQuery, useIpcEvent } from '@renderer/lib/ipc';
import { useNetworkStore } from '@renderer/stores/network';

export const Route = createRootRoute({ component: RootLayout });

function RootLayout() {
  const queryClient = useQueryClient();
  const { i18n } = useTranslation();
  const { data: settings } = useQuery(settingsQuery);
  const { data: locale } = useQuery(osLocaleQuery);

  useIpcEvent(
    'settings.changed',
    useCallback((next) => receiveSettings(queryClient, next), [queryClient]),
  );

  useIpcEvent(
    'db.changed',
    useCallback((change) => invalidateForTags(queryClient, change.tags), [queryClient]),
  );
  useIpcEvent(
    'network.status',
    useCallback((status) => queryClient.setQueryData(networkStatusQuery.queryKey, status), [queryClient]),
  );
  useIpcEvent('cloudflare.status', useNetworkStore.getState().setCloudflare);

  const language = settings
    ? settings.language === 'system'
      ? languageFromLocale(locale ?? 'en')
      : settings.language
    : null;
  useEffect(() => {
    if (!language) return;
    void i18n.changeLanguage(language);
    document.documentElement.lang = language;
  }, [language, i18n]);

  // Wait for the stored settings so the first paint already has the right theme and language.
  if (!settings || (settings.language === 'system' && locale === undefined)) return null;
  return <Outlet />;
}
