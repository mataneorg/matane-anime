import { resolveFlavor } from '@matane-anime/shared/theme';
import { useQuery } from '@tanstack/react-query';
import { settingsQuery } from '@renderer/lib/ipc';
import { usePrefersDark } from '@renderer/theme/ThemeProvider';

/** Whether the chosen flavor is light (Latte) or dark: chart colors are picked per scheme. */
export function useColorScheme(): 'light' | 'dark' {
  const { data: settings } = useQuery(settingsQuery);
  const prefersDark = usePrefersDark();
  return settings && resolveFlavor(settings.theme, prefersDark) === 'latte' ? 'light' : 'dark';
}
