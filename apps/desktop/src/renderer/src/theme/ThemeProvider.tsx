import { type ThemeFlavor, THEME_FLAVORS, isAmoledActive, resolveFlavor } from '@matane-anime/shared/theme';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { settingsQuery } from '@renderer/lib/ipc';

const DARK_QUERY = '(prefers-color-scheme: dark)';

export function usePrefersDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia(DARK_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const onChange = (event: MediaQueryListEvent): void => setDark(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return dark;
}

/** Paints the chosen flavor, AMOLED and accent on <html>; the CSS in styles.css does the rest. */
export function applyTheme(root: HTMLElement, flavor: ThemeFlavor, amoled: boolean, accent: string): void {
  for (const name of THEME_FLAVORS) root.classList.toggle(name, name === flavor);
  root.classList.toggle('amoled', isAmoledActive(flavor, amoled));
  root.dataset['accent'] = accent;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { data: settings } = useQuery(settingsQuery);
  const prefersDark = usePrefersDark();

  useEffect(() => {
    if (!settings) return;
    applyTheme(document.documentElement, resolveFlavor(settings.theme, prefersDark), settings.amoled, settings.accent);
  }, [settings, prefersDark]);

  return children;
}
