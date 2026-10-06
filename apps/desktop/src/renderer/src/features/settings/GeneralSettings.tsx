import {
  ACCENTS,
  LANGUAGES,
  THEME_MODES,
  type Accent,
  type ThemeMode,
  isAmoledActive,
  resolveFlavor,
} from '@matane-anime/shared/theme';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { RadioGroup, RadioOption } from '@renderer/components/ui/radio-group';
import { Switch } from '@renderer/components/ui/switch';
import { settingsQuery, useUpdateSettings } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/utils';
import { usePrefersDark } from '@renderer/theme/ThemeProvider';

/** The part of Settings that already works: appearance and language (docs/ui mockup 10c). */
export function GeneralSettings() {
  const { t } = useTranslation();
  const { data: settings } = useQuery(settingsQuery);
  const update = useUpdateSettings();
  const prefersDark = usePrefersDark();
  if (!settings) return null;

  const flavor = resolveFlavor(settings.theme, prefersDark);
  const amoledAvailable = flavor !== 'latte';

  return (
    <div className="flex max-w-[880px] flex-col gap-6">
      <section className="flex flex-col gap-4" aria-labelledby="appearance-title">
        <h2 id="appearance-title" className="text-[15px] leading-[22px] font-semibold">
          {t('settings.general.appearance')}
        </h2>

        <fieldset className="flex flex-col gap-2">
          <legend className="pb-2 text-xs leading-4 font-semibold">{t('settings.general.theme')}</legend>
          <RadioGroup
            value={settings.theme}
            onValueChange={(value) => update.mutate({ theme: value as ThemeMode })}
            aria-label={t('settings.general.theme')}
          >
            {THEME_MODES.map((mode) => (
              <RadioOption key={mode} value={mode}>
                {t(`settings.general.themes.${mode}`)}
              </RadioOption>
            ))}
          </RadioGroup>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="pb-2 text-xs leading-4 font-semibold">{t('settings.general.accent')}</legend>
          <div className="flex flex-wrap gap-2.5">
            {ACCENTS.map((accent: Accent) => {
              const selected = settings.accent === accent;
              return (
                <button
                  key={accent}
                  type="button"
                  aria-label={t(`settings.general.accents.${accent}`)}
                  aria-pressed={selected}
                  title={t(`settings.general.accents.${accent}`)}
                  onClick={() => update.mutate({ accent })}
                  style={{ background: `var(--catppuccin-color-${accent})` }}
                  className={cn('size-7 rounded-full', selected && 'outline-2 outline-offset-3 outline-foreground')}
                />
              );
            })}
          </div>
          <span className="text-xs leading-4">{t(`settings.general.accents.${settings.accent}`)}</span>
        </fieldset>

        <div className="flex items-center gap-4">
          <div className="flex-1">
            <label htmlFor="amoled" className="block font-semibold">
              {t('settings.general.amoled')}
            </label>
            <div className="text-xs leading-4">{t('settings.general.amoledHint')}</div>
          </div>
          <Switch
            id="amoled"
            checked={isAmoledActive(flavor, settings.amoled)}
            disabled={!amoledAvailable}
            onCheckedChange={(amoled) => update.mutate({ amoled })}
          />
        </div>
      </section>

      <section className="flex flex-col gap-4 border-t pt-5" aria-labelledby="language-title">
        <h2 id="language-title" className="text-[15px] leading-[22px] font-semibold">
          {t('settings.general.language')}
        </h2>
        <div className="flex max-w-60 flex-col gap-1.5">
          <label htmlFor="app-language" className="text-xs leading-4 font-semibold">
            {t('settings.general.appLanguage')}
          </label>
          <select
            id="app-language"
            value={settings.language}
            onChange={(event) => update.mutate({ language: event.target.value as (typeof settings)['language'] })}
            className="h-9 rounded-lg border border-border-strong bg-background px-2"
          >
            {(['system', ...LANGUAGES] as const).map((language) => (
              <option key={language} value={language}>
                {t(`settings.general.languages.${language}`)}
              </option>
            ))}
          </select>
        </div>
      </section>
    </div>
  );
}
