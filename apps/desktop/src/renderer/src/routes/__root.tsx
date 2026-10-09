import { languageFromLocale } from '@matane-anime/shared/theme';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Outlet, createRootRoute, useRouter } from '@tanstack/react-router';
import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Toaster } from '@renderer/components/Toaster';
import { DownloadsHost } from '@renderer/features/downloads/DownloadsHost';
import { invalidateForTags, networkStatusQuery } from '@renderer/lib/catalog';
import { incognitoQuery } from '@renderer/lib/incognito';
import { osLocaleQuery, receiveSettings, settingsQuery, useIpcEvent } from '@renderer/lib/ipc';
import { useNetworkStore } from '@renderer/stores/network';
import { useUpdatesStore } from '@renderer/stores/updates';

export const Route = createRootRoute({ component: RootLayout });

function RootLayout() {
  const queryClient = useQueryClient();
  const router = useRouter();
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
  useIpcEvent(
    'incognito.changed',
    useCallback((on) => queryClient.setQueryData(incognitoQuery.queryKey, on), [queryClient]),
  );
  useIpcEvent('cloudflare.status', useNetworkStore.getState().setCloudflare);
  useIpcEvent('updates.status', useUpdatesStore.getState().setStatus);
  // A clicked notification or the tray asks to open a page.
  useIpcEvent(
    'app.navigate',
    useCallback(({ to }) => void router.navigate({ to }), [router]),
  );

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
  return (
    <>
      <Outlet />
      <DownloadsHost />
      <Toaster />
    </>
  );
}
