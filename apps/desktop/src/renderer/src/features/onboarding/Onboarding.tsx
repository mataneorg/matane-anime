import { LANGUAGES, languageFromLocale } from '@matane-anime/shared/theme';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, Info, Play } from 'lucide-react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { WindowControls } from '@renderer/components/shell/WindowControls';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Switch } from '@renderer/components/ui/switch';
import { ChangeFolderButton } from '@renderer/features/downloads/ChangeFolderButton';
import { formatBytes } from '@renderer/features/downloads/format';
import { LanguageChips } from '@renderer/features/extensions/LanguageChips';
import { downloadStorageQuery } from '@renderer/lib/downloads';
import { appInfoQuery, osLocaleQuery, settingsQuery, useUpdateSettings } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/utils';

const STEPS = ['language', 'content', 'folder', 'player'] as const;
type Step = (typeof STEPS)[number];

const MIN_LIMIT_GB = 1;
const MAX_LIMIT_GB = 10_000;

/** Mini screens for the theme cards: colors of the Catppuccin flavors, fixed so each card shows its own theme. */
const PREVIEW = {
  mocha: { side: '#11111b', page: '#181825', bar: '#b4befe', soft: '#6c7086', accent: '#cba6f7' },
  latte: { side: '#e6e9ef', page: '#eff1f5', bar: '#4c4f69', soft: '#9ca0b0', accent: '#8839ef' },
} as const;

/** The first-run flow (docs/PRD.md UI-9, mockups 12 to 12d): four steps, and every choice is saved as it is made. */
export function Onboarding() {
  const { t } = useTranslation();
  const { data: info } = useQuery(appInfoQuery);
  const update = useUpdateSettings();
  const [index, setIndex] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const step: Step = STEPS[index] ?? 'language';
  const last = index === STEPS.length - 1;

  // A new step starts at its heading, so a screen reader reads it and the keyboard is next to the controls.
  useEffect(() => {
    if (index > 0) heading.current?.focus();
  }, [index]);

  const finish = (): void => update.mutate({ onboardingDone: true });

  return (
    <div className="flex h-full flex-col">
      <header
        className={cn(
          'drag-region flex h-10 shrink-0 items-center gap-3 border-b bg-sidebar',
          info?.platform === 'darwin' ? 'pl-20' : 'pl-3',
        )}
      >
        <span className="flex-1 text-xs leading-4 whitespace-nowrap text-muted-foreground">
          {t('app.name')}
          <span className="px-1">/</span>
          <span className="text-foreground">{t('onboarding.crumb')}</span>
        </span>
        <WindowControls />
      </header>

      <main className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-8">
        <div className="grid w-full max-w-[1040px] grid-cols-1 items-center gap-12 md:grid-cols-[260px_1fr]">
          <aside className="flex flex-col gap-6">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Play className="size-5 fill-current" strokeWidth={0} aria-hidden />
              </span>
              <span className="text-lg leading-6 font-semibold text-foreground">{t('app.name')}</span>
            </div>
            <ol aria-label={t('onboarding.stepsLabel')} className="flex flex-col gap-1">
              {STEPS.map((name, position) => {
                const current = position === index;
                const done = position < index;
                return (
                  <li
                    key={name}
                    aria-current={current ? 'step' : undefined}
                    className={cn(
                      'flex h-11 items-center gap-3 rounded-lg border-l-2 px-3',
                      current
                        ? 'border-primary bg-primary/15 font-semibold text-primary-text'
                        : 'border-transparent text-muted-foreground',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-6 shrink-0 items-center justify-center rounded-full border border-input font-mono text-xs leading-4',
                        (current || done) && 'border-primary bg-primary text-primary-foreground',
                      )}
                    >
                      {done ? <Check className="size-3.5" strokeWidth={2.5} aria-hidden /> : position + 1}
                    </span>
                    {t(`onboarding.steps.${name}`)}
                  </li>
                );
              })}
            </ol>
            <p className="text-xs leading-4 text-muted-foreground">{t('onboarding.saved')}</p>
          </aside>

          <section aria-labelledby="onboarding-title" className="flex flex-col gap-6 rounded-xl border bg-card/40 p-8">
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-xs leading-4 text-muted-foreground">
                {t('onboarding.stepOf', { current: index + 1, total: STEPS.length })}
              </span>
              <h1
                id="onboarding-title"
                ref={heading}
                tabIndex={-1}
                className="text-xl leading-7 font-semibold outline-none"
              >
                {t(`onboarding.${step}.title`)}
              </h1>
              <p className="text-sm text-muted-foreground">{t(`onboarding.${step}.description`)}</p>
            </div>

            {step === 'language' ? <LanguageStep /> : null}
            {step === 'content' ? <ContentStep /> : null}
            {step === 'folder' ? <FolderStep /> : null}
            {step === 'player' ? <PlayerStep /> : null}

            <div className="flex items-center gap-2 pt-2">
              {last ? null : (
                <Button variant="ghost" className="mr-auto" onClick={finish}>
                  {t('onboarding.skip')}
                </Button>
              )}
              {last ? <span className="mr-auto" /> : null}
              {index > 0 ? (
                <Button variant="secondary" onClick={() => setIndex(index - 1)}>
                  {t('onboarding.back')}
                </Button>
              ) : null}
              {last ? (
                <Button onClick={finish}>
                  <Play className="size-4 fill-current" strokeWidth={0} aria-hidden />
                  {t('onboarding.finish')}
                </Button>
              ) : (
                <Button onClick={() => setIndex(index + 1)}>
                  {t('onboarding.next')}
                  <ChevronRight className="size-4" strokeWidth={1.75} aria-hidden />
                </Button>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

/** A big radio card: the radio dot and its label, with room for a preview above. */
function RadioCard({ value, children, preview }: { value: string; children: ReactNode; preview?: ReactNode }) {
  return (
    <RadioGroupPrimitive.Item
      value={value}
      className={cn(
        'flex cursor-pointer flex-col gap-3 rounded-xl border bg-background p-3 text-left transition-colors hover:border-input',
        'data-[state=checked]:border-primary data-[state=checked]:ring-1 data-[state=checked]:ring-primary',
      )}
    >
      {preview}
      <span className="flex items-center gap-2.5">
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full border border-input">
          <RadioGroupPrimitive.Indicator className="size-2 rounded-full bg-primary" />
        </span>
        {children}
      </span>
    </RadioGroupPrimitive.Item>
  );
}

function ThemePreview({ flavor }: { flavor: keyof typeof PREVIEW }) {
  const colors = PREVIEW[flavor];
  return (
    <span aria-hidden className="flex h-18 overflow-hidden rounded-lg" style={{ background: colors.page }}>
      <span className="w-1/5" style={{ background: colors.side }} />
      <span className="flex flex-1 flex-col justify-center gap-1.5 px-3">
        <span className="h-2 w-3/4 rounded-full" style={{ background: colors.bar }} />
        <span className="h-2 w-1/2 rounded-full" style={{ background: colors.soft }} />
        <span className="h-2.5 w-2/5 rounded-full" style={{ background: colors.accent }} />
      </span>
    </span>
  );
}

function SystemThemePreview() {
  return (
    <span aria-hidden className="flex h-18 overflow-hidden rounded-lg">
      <span className="flex w-1/2 flex-col justify-center gap-1.5 px-3" style={{ background: PREVIEW.mocha.page }}>
        <span className="h-2 w-3/4 rounded-full" style={{ background: PREVIEW.mocha.bar }} />
        <span className="h-2.5 w-1/2 rounded-full" style={{ background: PREVIEW.mocha.accent }} />
      </span>
      <span className="flex w-1/2 flex-col justify-center gap-1.5 px-3" style={{ background: PREVIEW.latte.page }}>
        <span className="h-2 w-3/4 rounded-full" style={{ background: PREVIEW.latte.bar }} />
        <span className="h-2.5 w-1/2 rounded-full" style={{ background: PREVIEW.latte.accent }} />
      </span>
    </span>
  );
}

/** Step 1: language and theme, written to the real settings so the window changes as you choose. */
function LanguageStep() {
  const { t } = useTranslation();
  const { data: settings } = useQuery(settingsQuery);
  const { data: locale } = useQuery(osLocaleQuery);
  const update = useUpdateSettings();
  if (!settings) return null;

  const followsSystem = settings.language === 'system';
  const language = followsSystem ? languageFromLocale(locale ?? 'en') : settings.language;
  const theme =
    settings.theme === 'mocha' || settings.theme === 'latte' || settings.theme === 'system' ? settings.theme : '';

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 id="onboarding-language" className="font-semibold text-foreground">
          {t('onboarding.language.appLanguage')}
        </h2>
        <RadioGroupPrimitive.Root
          aria-labelledby="onboarding-language"
          value={language}
          onValueChange={(value) => update.mutate({ language: value as (typeof LANGUAGES)[number] })}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
        >
          {LANGUAGES.map((code) => (
            <RadioCard key={code} value={code}>
              <span className="flex flex-col">
                <span className="font-semibold text-foreground">{t(`onboarding.language.options.${code}.title`)}</span>
                <span className="text-xs leading-4 text-muted-foreground">
                  {followsSystem && code === language
                    ? t('onboarding.language.followsSystem')
                    : t(`onboarding.language.options.${code}.name`)}
                </span>
              </span>
            </RadioCard>
          ))}
        </RadioGroupPrimitive.Root>
      </div>

      <div className="flex flex-col gap-2">
        <h2 id="onboarding-theme" className="font-semibold text-foreground">
          {t('onboarding.language.theme')}
        </h2>
        <RadioGroupPrimitive.Root
          aria-labelledby="onboarding-theme"
          value={theme}
          onValueChange={(value) => update.mutate({ theme: value as 'mocha' | 'latte' | 'system' })}
          className="grid grid-cols-1 gap-3 sm:grid-cols-3"
        >
          {(['mocha', 'latte', 'system'] as const).map((mode) => (
            <RadioCard
              key={mode}
              value={mode}
              preview={mode === 'system' ? <SystemThemePreview /> : <ThemePreview flavor={mode} />}
            >
              <span className="flex items-baseline gap-2">
                <span className="font-semibold text-foreground">{t(`onboarding.language.themes.${mode}.name`)}</span>
                <span className="text-xs leading-4 text-muted-foreground">
                  {t(`onboarding.language.themes.${mode}.hint`)}
                </span>
              </span>
            </RadioCard>
          ))}
        </RadioGroupPrimitive.Root>
      </div>
    </div>
  );
}

/** Step 2: content language (the same chips as Settings, General) and the 18+ switch. */
function ContentStep() {
  const { t } = useTranslation();
  const { data: settings } = useQuery(settingsQuery);
  const update = useUpdateSettings();
  if (!settings) return null;
  return (
    <div className="flex flex-col gap-5">
      <LanguageChips />
      <div className="flex items-center gap-4 rounded-xl border bg-background px-4 py-3">
        <div className="flex-1">
          <label htmlFor="onboarding-nsfw" className="block font-semibold text-foreground">
            {t('settings.general.nsfw.title')}
          </label>
          <div className="text-xs leading-4 text-muted-foreground">{t('settings.general.nsfw.description')}</div>
        </div>
        <Switch
          id="onboarding-nsfw"
          checked={settings.showNsfw}
          onCheckedChange={(showNsfw) => update.mutate({ showNsfw })}
        />
      </div>
      <p className="flex items-center gap-2 text-xs leading-4 text-muted-foreground">
        <Info className="size-4 shrink-0 text-ctp-blue" strokeWidth={1.75} aria-hidden />
        {t('onboarding.content.noSources')}
      </p>
    </div>
  );
}

/** Step 3: the download folder, how much room there is, and the size limit. */
function FolderStep() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { data: settings } = useQuery(settingsQuery);
  const { data: storage } = useQuery(downloadStorageQuery);
  const update = useUpdateSettings();
  // What is typed in the limit field, until Enter or leaving the field saves it.
  const [draft, setDraft] = useState<string | null>(null);
  if (!settings) return null;

  const commit = (): void => {
    const value = Number(draft);
    setDraft(null);
    if (draft === null || draft.trim() === '' || !Number.isFinite(value)) return;
    const clamped = Math.min(MAX_LIMIT_GB, Math.max(MIN_LIMIT_GB, value));
    if (clamped === settings.downloadSizeLimitGb) return;
    update.mutate(
      { downloadSizeLimitGb: clamped },
      { onSuccess: () => void queryClient.invalidateQueries({ queryKey: downloadStorageQuery.queryKey }) },
    );
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Enter') commit();
    if (event.key === 'Escape') setDraft(null);
  };

  const folder = storage?.folder ?? settings.downloadFolder ?? '';
  const root = folder.split(/[\\/]/).filter(Boolean).at(-1) ?? '';
  const free = storage?.freeBytes != null ? formatBytes(storage.freeBytes, i18n.language) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h2 id="onboarding-folder" className="font-semibold text-foreground">
          {t('settings.downloads.folder')}
        </h2>
        <div className="flex gap-2">
          <div
            role="group"
            aria-labelledby="onboarding-folder"
            className="flex h-10 min-w-0 flex-1 items-center rounded-lg border border-input bg-background px-3 font-mono text-foreground"
          >
            <span className="truncate" title={folder}>
              {folder}
            </span>
          </div>
          <ChangeFolderButton size="lg" />
        </div>
        {free ? (
          <p className="flex items-center gap-2 text-xs leading-4 text-muted-foreground">
            <Check className="size-3.5 text-ctp-green" strokeWidth={2.25} aria-hidden />
            <span>{t('onboarding.folder.free', { size: free })}</span>
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-4 rounded-xl border bg-background px-4 py-3">
        <div className="flex-1">
          <label htmlFor="onboarding-limit" className="block font-semibold text-foreground">
            {t('onboarding.folder.limit')}
          </label>
          <div className="text-xs leading-4 text-muted-foreground">{t('onboarding.folder.limitHint')}</div>
        </div>
        <Input
          id="onboarding-limit"
          type="number"
          inputMode="numeric"
          min={MIN_LIMIT_GB}
          max={MAX_LIMIT_GB}
          value={draft ?? String(settings.downloadSizeLimitGb)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={onKey}
          className="h-10 w-24 text-right font-mono"
        />
        <span>{t('settings.downloads.gb')}</span>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border bg-background px-4 py-3">
        <h2 className="text-xs leading-4 font-semibold text-foreground">{t('onboarding.folder.layout')}</h2>
        <pre className="font-mono text-xs leading-[18px] text-foreground" translate="no">
          {[
            `${root}/`,
            `  ${t('onboarding.folder.source')}/`,
            `    ${t('onboarding.folder.anime')}/`,
            `      ${t('onboarding.folder.episode')}/`,
          ].join('\n')}
        </pre>
      </div>
    </div>
  );
}

/** Step 4: the shortcuts the player answers to (PLY-3), the autoplay switch and the watched threshold. */
function PlayerStep() {
  const { t } = useTranslation();
  const { data: settings } = useQuery(settingsQuery);
  const update = useUpdateSettings();
  if (!settings) return null;

  const seek = settings.playerSeekSeconds;
  const shortcuts: { keys: string[]; label: string }[] = [
    { keys: ['Space'], label: t('onboarding.player.playPause') },
    { keys: ['←', '→'], label: t('onboarding.player.jump', { count: seek }) },
    { keys: ['J', 'L'], label: t('onboarding.player.jump', { count: seek * 2 }) },
    { keys: ['F'], label: t('onboarding.player.fullscreen') },
    { keys: ['Shift N'], label: t('onboarding.player.nextEpisode') },
    { keys: ['[', ']'], label: t('onboarding.player.speed') },
  ];

  return (
    <div className="flex flex-col gap-5">
      <ul
        aria-label={t('onboarding.player.shortcutsLabel')}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      >
        {shortcuts.map((shortcut) => (
          <li
            key={shortcut.keys.join('+')}
            className="flex items-center gap-3 rounded-xl border bg-background px-3.5 py-3.5"
          >
            <span className="flex gap-1.5">
              {shortcut.keys.map((key) => (
                <kbd
                  key={key}
                  className="rounded-md border border-input px-2 py-0.5 font-mono text-xs leading-4 font-medium text-foreground"
                >
                  {key}
                </kbd>
              ))}
            </span>
            <span className="text-foreground">{shortcut.label}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-3 rounded-xl border bg-background px-4 py-3">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <label htmlFor="onboarding-autoplay" className="block font-semibold text-foreground">
              {t('settings.player.autoplay')}
            </label>
            <div className="text-xs leading-4 text-muted-foreground">{t('settings.player.autoplayHint')}</div>
          </div>
          <Switch
            id="onboarding-autoplay"
            checked={settings.playerAutoplay}
            onCheckedChange={(playerAutoplay) => update.mutate({ playerAutoplay })}
          />
        </div>
        <p className="text-xs leading-4 text-muted-foreground">
          {settings.playerWatchedThreshold === 100 ? (
            t('onboarding.player.thresholdEnd')
          ) : (
            <Trans
              i18nKey="onboarding.player.thresholdAt"
              values={{ percent: settings.playerWatchedThreshold }}
              components={{ strong: <strong className="text-foreground" /> }}
            />
          )}
        </p>
      </div>
    </div>
  );
}
