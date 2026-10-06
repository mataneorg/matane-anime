import { PLAYER_QUALITIES, type PlayerQuality } from '@matane-anime/shared';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Select } from '@renderer/components/ui/select';
import { Switch } from '@renderer/components/ui/switch';
import { settingsQuery, useUpdateSettings } from '@renderer/lib/ipc';

const SEEK_STEPS = [5, 10, 15, 30];

/** Settings → Player (docs/PRD.md UI-7). The threshold, shortcut editor and the rest arrive with phases 2 and 5. */
export function PlayerSettings() {
  const { t } = useTranslation();
  const { data: settings } = useQuery(settingsQuery);
  const update = useUpdateSettings();
  if (!settings) return null;

  return (
    <section className="flex flex-col gap-6" aria-labelledby="playback-title">
      <h2 id="playback-title" className="text-[15px] leading-[22px] font-semibold">
        {t('settings.player.playback')}
      </h2>

      <div className="flex items-center gap-4">
        <div className="flex-1">
          <label htmlFor="autoplay" className="block font-semibold">
            {t('settings.player.autoplay')}
          </label>
          <div className="text-xs leading-4">{t('settings.player.autoplayHint')}</div>
        </div>
        <Switch
          id="autoplay"
          checked={settings.playerAutoplay}
          onCheckedChange={(playerAutoplay) => update.mutate({ playerAutoplay })}
        />
      </div>

      <div className="flex max-w-72 flex-col gap-1.5">
        <label htmlFor="player-quality" className="font-semibold">
          {t('settings.player.quality')}
        </label>
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
        <div className="text-xs leading-4">{t('settings.player.qualityHint')}</div>
      </div>

      <div className="flex max-w-72 flex-col gap-1.5">
        <label htmlFor="seek-step" className="font-semibold">
          {t('settings.player.seek')}
        </label>
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
        <div className="text-xs leading-4">{t('settings.player.seekHint')}</div>
      </div>
    </section>
  );
}
