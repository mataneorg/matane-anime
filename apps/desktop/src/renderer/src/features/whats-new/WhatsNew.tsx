import type { ChangelogEntry } from '@matane-anime/shared';
import { queryOptions, useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@renderer/components/ui/dialog';
import { call } from '@renderer/lib/api';
import { appInfoQuery, settingsQuery, useUpdateSettings } from '@renderer/lib/ipc';
import { localQueryDefaults } from '@renderer/lib/query';
import { RELEASES_URL, whatsNewDecision } from '@renderer/lib/version';

/** The changelog bundled with this version (the text is English; it ships with the app). */
const changelogQuery = queryOptions({
  queryKey: ['app', 'changelog'],
  queryFn: () => call('app.changelog'),
  ...localQueryDefaults,
});

/**
 * "What's new" after an update (docs/PRD.md UI-10): once per version, listing the changelog entries newer than the
 * one last seen. The first run only stores the version. Closing the dialog stores it too.
 */
export function WhatsNew() {
  const { t, i18n } = useTranslation();
  const { data: settings } = useQuery(settingsQuery);
  const { data: info } = useQuery(appInfoQuery);
  const { data: entries } = useQuery(changelogQuery);
  const { mutate: saveSettings } = useUpdateSettings();
  const [dismissed, setDismissed] = useState(false);
  const remembered = useRef(false);

  const decision = useMemo(
    () =>
      settings && info && entries
        ? whatsNewDecision({
            onboardingDone: settings.onboardingDone,
            lastSeen: settings.lastSeenVersion,
            current: info.version,
            entries,
          })
        : null,
    [settings, info, entries],
  );

  const current = info?.version;
  useEffect(() => {
    if (decision?.kind !== 'remember' || !current || remembered.current) return;
    remembered.current = true;
    saveSettings({ lastSeenVersion: current });
  }, [decision, current, saveSettings]);

  if (decision?.kind !== 'show' || dismissed || !current) return null;

  const close = (): void => {
    setDismissed(true);
    saveSettings({ lastSeenVersion: current });
  };
  const formatDate = (iso: string): string => {
    const date = new Date(`${iso}T00:00:00`);
    return Number.isNaN(date.getTime())
      ? iso
      : new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(date);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        title={t('whatsNew.title')}
        description={t('whatsNew.description')}
        closeLabel={t('common.close')}
        className="w-[min(560px,calc(100vw-48px))]"
      >
        <div className="flex flex-col gap-5">
          {decision.entries.map((entry: ChangelogEntry) => (
            <section key={entry.version} aria-label={t('whatsNew.version', { version: entry.version })}>
              <h3 className="flex items-baseline gap-2 text-sm leading-5 font-semibold text-foreground">
                {t('whatsNew.version', { version: entry.version })}
                <span className="font-mono text-xs leading-4 font-normal text-muted-foreground">
                  {formatDate(entry.date)}
                </span>
              </h3>
              <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 marker:text-primary-text">
                {entry.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          ))}
          <DialogFooter className="flex-wrap">
            <Button variant="secondary" onClick={() => void call('app.openExternal', RELEASES_URL)}>
              <ExternalLink className="size-4" strokeWidth={1.75} aria-hidden />
              {t('whatsNew.notes')}
            </Button>
            <Button onClick={close}>{t('whatsNew.gotIt')}</Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
