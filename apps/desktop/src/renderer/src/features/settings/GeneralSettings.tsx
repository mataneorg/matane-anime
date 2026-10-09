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
import { Check } from 'lucide-react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { useTranslation } from 'react-i18next';
import { Select } from '@renderer/components/ui/select';
import { Switch } from '@renderer/components/ui/switch';
import { LanguageChips } from '@renderer/features/extensions/ContentControls';
import { settingsQuery, useUpdateSettings } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/utils';
import { usePrefersDark } from '@renderer/theme/ThemeProvider';
import { SettingRow, SettingsCard } from './parts';

/** A mini screen painted in the given flavor: the flavor class scopes the Catppuccin variables to the swatch. */
function ThemeSwatch({ flavor }: { flavor: string }) {
  return (
    <span className={cn(flavor, 'flex flex-1 items-end gap-1 bg-ctp-base p-1.5')}>
      <span className="h-5 w-3 rounded-sm bg-ctp-mantle" />
      <span className="h-2 flex-1 rounded-sm bg-ctp-surface0" />
      <span className="size-2 rounded-full bg-ctp-mauve" />
    </span>
  );
}

function ThemePreview({ mode }: { mode: ThemeMode }) {
  return (
    <span aria-hidden className="flex h-12 overflow-hidden rounded-md border">
      {mode === 'system' ? (
        <>
          <ThemeSwatch flavor="latte" />
          <ThemeSwatch flavor="mocha" />
        </>
      ) : (
        <ThemeSwatch flavor={mode} />
      )}
    </span>
  );
}

/** Appearance and language: the part of Settings that every user touches first (docs/ui mockup 10c). */
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
      <SettingsCard id="appearance-title" title={t('settings.general.appearance')}>
        <SettingRow label={<span id="theme-label">{t('settings.general.theme')}</span>} stacked>
          <RadioGroupPrimitive.Root
            value={settings.theme}
            onValueChange={(value) => update.mutate({ theme: value as ThemeMode })}
            aria-labelledby="theme-label"
            className="grid grid-cols-2 gap-3 sm:grid-cols-5"
          >
            {THEME_MODES.map((mode) => (
              <RadioGroupPrimitive.Item
                key={mode}
                value={mode}
                className="flex cursor-pointer flex-col gap-2 rounded-lg border p-2 text-left text-xs transition-colors hover:border-input data-[state=checked]:border-primary data-[state=checked]:ring-1 data-[state=checked]:ring-primary"
              >
                <ThemePreview mode={mode} />
                <span className={cn(settings.theme === mode && 'font-semibold text-primary-text')}>
                  {t(`settings.general.themes.${mode}`)}
                </span>
              </RadioGroupPrimitive.Item>
            ))}
          </RadioGroupPrimitive.Root>
        </SettingRow>

        <SettingRow label={t('settings.general.accent')} stacked>
          <div className="flex flex-col gap-2">
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
                    className={cn(
                      'flex size-8 items-center justify-center rounded-full text-ink transition-transform hover:scale-110',
                      selected && 'ring-2 ring-foreground ring-offset-2 ring-offset-background',
                    )}
                  >
                    {selected ? <Check className="size-4" strokeWidth={2.5} aria-hidden /> : null}
                  </button>
                );
              })}
            </div>
            <span className="text-xs leading-4 text-muted-foreground">
              {t(`settings.general.accents.${settings.accent}`)}
            </span>
          </div>
        </SettingRow>

        <SettingRow label={t('settings.general.amoled')} hint={t('settings.general.amoledHint')} htmlFor="amoled">
          <Switch
            id="amoled"
            checked={isAmoledActive(flavor, settings.amoled)}
            disabled={!amoledAvailable}
            onCheckedChange={(amoled) => update.mutate({ amoled })}
          />
        </SettingRow>
      </SettingsCard>

      <SettingsCard id="content-title" title={t('settings.general.content')}>
        <SettingRow
          label={t('settings.general.nsfw.title')}
          hint={t('settings.general.nsfw.description')}
          htmlFor="show-nsfw"
        >
          <Switch
            id="show-nsfw"
            checked={settings.showNsfw}
            onCheckedChange={(showNsfw) => update.mutate({ showNsfw })}
          />
        </SettingRow>
      </SettingsCard>

      <SettingsCard id="language-title" title={t('settings.general.language')}>
        <SettingRow label={t('settings.general.appLanguage')} htmlFor="app-language">
          <Select
            id="app-language"
            value={settings.language}
            onChange={(event) => update.mutate({ language: event.target.value as (typeof settings)['language'] })}
            className="w-60"
          >
            {(['system', ...LANGUAGES] as const).map((language) => (
              <option key={language} value={language}>
                {t(`settings.general.languages.${language}`)}
              </option>
            ))}
          </Select>
        </SettingRow>
        <div className="py-4 last:pb-0">
          <LanguageChips />
        </div>
      </SettingsCard>

      <SettingsCard id="system-title" title={t('settings.system.title')}>
        <SettingRow
          label={t('settings.system.runAtLogin')}
          hint={t('settings.system.runAtLoginHint')}
          htmlFor="run-at-login"
        >
          <Switch
            id="run-at-login"
            checked={settings.runAtLogin}
            onCheckedChange={(runAtLogin) => update.mutate({ runAtLogin })}
          />
        </SettingRow>
        <SettingRow
          label={t('settings.system.closeToTray')}
          hint={t('settings.system.closeToTrayHint')}
          htmlFor="close-to-tray"
        >
          <Switch
            id="close-to-tray"
            checked={settings.closeToTray}
            onCheckedChange={(closeToTray) => update.mutate({ closeToTray })}
          />
        </SettingRow>
      </SettingsCard>
    </div>
  );
}
