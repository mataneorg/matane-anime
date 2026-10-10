import { UPDATE_CHANNELS, type UpdateChannel } from '@matane-anime/shared';
import { useQuery } from '@tanstack/react-query';
import { Bug, ExternalLink, Play, RotateCcw, Sparkles } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/components/ui/button';
import { Select } from '@renderer/components/ui/select';
import { call } from '@renderer/lib/api';
import { describeError } from '@renderer/lib/errors';
import { appInfoQuery, settingsQuery, useUpdateSettings } from '@renderer/lib/ipc';
import { notify } from '@renderer/lib/toast';
import { RELEASES_URL, REPOSITORY_URL } from '@renderer/lib/version';
import { useWhatsNewStore } from '@renderer/stores/whatsNew';
import { SettingRow, SettingsCard } from './parts';

const LINKS: { key: 'releases' | 'repository' | 'issues'; url: string; icon: LucideIcon }[] = [
  { key: 'releases', url: RELEASES_URL, icon: Sparkles },
  { key: 'repository', url: REPOSITORY_URL, icon: ExternalLink },
  { key: 'issues', url: `${REPOSITORY_URL}/issues`, icon: Bug },
];

/** Settings → About: the version, what changed in it, the update channel, the license, and a way back into the first-run setup. */
export function AboutSettings() {
  const { t } = useTranslation();
  const { data: info } = useQuery(appInfoQuery);
  const { data: settings } = useQuery(settingsQuery);
  const update = useUpdateSettings();
  const showWhatsNew = useWhatsNewStore((state) => state.setOpen);
  if (!info || !settings) return null;

  return (
    <div className="flex max-w-[880px] flex-col gap-6">
      <section
        aria-labelledby="about-title"
        className="flex flex-wrap items-center gap-4 rounded-xl border bg-card/40 p-5"
      >
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Play className="size-5 fill-current" strokeWidth={2} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="about-title" className="text-sm font-semibold">
            {t('app.name')}
          </h2>
          <p className="font-mono text-xs leading-4 text-muted-foreground" data-testid="app-version">
            {t('settings.about.version', { version: info.version })}
          </p>
          <p className="text-xs leading-4 text-muted-foreground">
            {t('settings.about.runtime', {
              electron: info.electron,
              chrome: info.chrome,
              node: info.node,
              platform: info.platform,
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => showWhatsNew(true)}>
            <Sparkles aria-hidden />
            {t('settings.about.whatsNew')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => update.mutate({ onboardingDone: false })}>
            <RotateCcw aria-hidden />
            {t('settings.about.runSetup')}
          </Button>
        </div>
      </section>

      <SettingsCard id="about-updates-title" title={t('settings.about.updates')}>
        <SettingRow
          label={t('settings.about.channel')}
          hint={t('settings.about.channelHint')}
          htmlFor="update-channel"
        >
          <Select
            id="update-channel"
            data-testid="update-channel"
            value={settings.updateChannel}
            onChange={(event) =>
              update.mutate(
                { updateChannel: event.target.value as UpdateChannel },
                { onError: (error) => notify.error(t('settings.about.channelFailed'), describeError(error, t)) },
              )
            }
          >
            {UPDATE_CHANNELS.map((channel) => (
              <option key={channel} value={channel}>
                {t(`settings.about.channels.${channel}`)}
              </option>
            ))}
          </Select>
        </SettingRow>
      </SettingsCard>

      <SettingsCard id="about-links-title" title={t('settings.about.links')}>
        <div className="flex flex-wrap gap-2">
          {LINKS.map(({ key, url, icon: Icon }) => (
            <Button key={key} variant="secondary" size="sm" onClick={() => void call('app.openExternal', url)}>
              <Icon aria-hidden />
              {t(`settings.about.${key}`)}
            </Button>
          ))}
        </div>
      </SettingsCard>

      <SettingsCard
        id="about-license-title"
        title={t('settings.about.license')}
        description={t('settings.about.licenseBody')}
      >
        <SettingRow label={t('settings.about.licenseName')}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void call('app.openExternal', `${REPOSITORY_URL}/blob/main/LICENSE`)}
          >
            <ExternalLink aria-hidden />
            {t('settings.about.licenseText')}
          </Button>
        </SettingRow>
      </SettingsCard>
    </div>
  );
}
