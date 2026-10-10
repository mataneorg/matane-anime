import {
  AUTOPLAY_COUNTDOWNS,
  type AutoplayCountdown,
  PLAYER_QUALITIES,
  type PlayerQuality,
  type ShortcutMap,
} from '@matane-anime/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Select } from '@renderer/components/ui/select';
import { Switch } from '@renderer/components/ui/switch';
import { settingsQuery, useUpdateSettings } from '@renderer/lib/ipc';
import { SettingRow, SettingsCard } from './parts';
import { ShortcutsCard } from './ShortcutsCard';

const SEEK_STEPS = [5, 10, 15, 30];

/** Settings → Player (docs/PRD.md UI-7): playback, the watched threshold and the keyboard shortcuts. */
export function PlayerSettings() {
  const { t } = useTranslation();
  const { data: settings } = useQuery(settingsQuery);
  const update = useUpdateSettings();
  if (!settings) return null;

  return (
    <div className="flex max-w-[880px] flex-col gap-6">
      <SettingsCard id="playback-title" title={t('settings.player.playback')}>
        <SettingRow label={t('settings.player.autoplay')} hint={t('settings.player.autoplayHint')} htmlFor="autoplay">
          <Switch
            id="autoplay"
            checked={settings.playerAutoplay}
            onCheckedChange={(playerAutoplay) => update.mutate({ playerAutoplay })}
          />
        </SettingRow>

        <SettingRow
          label={t('settings.player.countdown')}
          hint={t('settings.player.countdownHint')}
          htmlFor="autoplay-countdown"
        >
          <Select
            id="autoplay-countdown"
            value={settings.playerAutoplayCountdown}
            disabled={!settings.playerAutoplay}
            onChange={(event) =>
              update.mutate({ playerAutoplayCountdown: Number(event.target.value) as AutoplayCountdown })
            }
          >
            {AUTOPLAY_COUNTDOWNS.map((seconds) => (
              <option key={seconds} value={seconds}>
                {t('settings.player.countdownSeconds', { count: seconds })}
              </option>
            ))}
          </Select>
        </SettingRow>

        <SettingRow
          label={t('settings.player.quality')}
          hint={t('settings.player.qualityHint')}
          htmlFor="player-quality"
        >
          <Select
            id="player-quality"
            value={settings.playerQuality}
            onChange={(event) => update.mutate({ playerQuality: event.target.value as PlayerQuality })}
          >
            {PLAYER_QUALITIES.map((quality) => (
              <option key={quality} value={quality}>
                {t(`settings.player.qualities.${quality}`)}
              </option>
            ))}
          </Select>
        </SettingRow>

        <SettingRow
          label={t('settings.player.threshold')}
          hint={t('settings.player.thresholdHint')}
          htmlFor="watched-threshold"
        >
          <div className="flex w-72 items-center gap-3">
            <input
              id="watched-threshold"
              type="range"
              min={50}
              max={100}
              step={5}
              value={settings.playerWatchedThreshold}
              onChange={(event) => update.mutate({ playerWatchedThreshold: Number(event.target.value) })}
              className="flex-1 accent-primary"
            />
            <span className="w-24 text-right font-mono text-xs leading-4">
              {settings.playerWatchedThreshold === 100
                ? t('settings.player.thresholdEnd')
                : t('settings.player.thresholdPercent', { percent: settings.playerWatchedThreshold })}
            </span>
          </div>
        </SettingRow>

        <SettingRow label={t('settings.player.seek')} hint={t('settings.player.seekHint')} htmlFor="seek-step">
          <Select
            id="seek-step"
            value={settings.playerSeekSeconds}
            onChange={(event) => update.mutate({ playerSeekSeconds: Number(event.target.value) })}
          >
            {SEEK_STEPS.map((seconds) => (
              <option key={seconds} value={seconds}>
                {t('settings.player.seekSeconds', { count: seconds })}
              </option>
            ))}
          </Select>
        </SettingRow>
      </SettingsCard>

      <ShortcutsCard
        shortcuts={settings.playerShortcuts}
        onChange={(playerShortcuts: ShortcutMap) => update.mutate({ playerShortcuts })}
      />
    </div>
  );
}
