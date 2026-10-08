import { type AutoDownloadMode, type Category, UPDATE_INTERVALS, type UpdateInterval } from '@matane-anime/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Minus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@renderer/components/ui/input';
import { Select } from '@renderer/components/ui/select';
import { Switch } from '@renderer/components/ui/switch';
import { ariaCheckedOf, nextAutoDownloadMode } from '@renderer/features/updates/helpers';
import { call } from '@renderer/lib/api';
import { settingsQuery, useUpdateSettings } from '@renderer/lib/ipc';
import { categoriesQuery } from '@renderer/lib/library';
import { cn } from '@renderer/lib/utils';

/** What `updateSkipUnwatchedOver` becomes when the rule is switched on again. */
const DEFAULT_UNWATCHED_LIMIT = 10;

/** Settings → Library → new episode checks and automatic downloads (mockup 10d, docs/PRD.md UPD-1…3, DL-11). */
export function UpdateChecksSettings() {
  return (
    <>
      <ChecksSection />
      <AutoDownloadSection />
    </>
  );
}

function ChecksSection() {
  const { t } = useTranslation();
  const { data: settings } = useQuery(settingsQuery);
  const update = useUpdateSettings();
  const limit = settings?.updateSkipUnwatchedOver ?? null;
  // What is being typed; null shows the saved number.
  const [typed, setTyped] = useState<string | null>(null);
  const draft = typed ?? String(limit ?? DEFAULT_UNWATCHED_LIMIT);
  if (!settings) return null;

  const commit = (value: string): void => {
    const number = Number(value);
    if (Number.isInteger(number) && number >= 1 && number <= 1000) update.mutate({ updateSkipUnwatchedOver: number });
    setTyped(null);
  };

  return (
    <section className="flex flex-col gap-4" aria-labelledby="update-checks-title">
      <h2 id="update-checks-title" className="text-[15px] leading-[22px] font-semibold">
        {t('settings.library.updates')}
      </h2>

      <div className="flex items-center gap-4">
        <div className="flex-1">
          <label htmlFor="update-interval" className="block font-semibold text-foreground">
            {t('settings.library.updatesEvery')}
          </label>
          <div className="text-xs leading-4">{t('settings.library.updatesEveryHint')}</div>
        </div>
        <Select
          id="update-interval"
          value={settings.updateIntervalHours}
          onChange={(event) => update.mutate({ updateIntervalHours: Number(event.target.value) as UpdateInterval })}
        >
          {UPDATE_INTERVALS.map((hours) => (
            <option key={hours} value={hours}>
              {t(`settings.library.interval.${hours}`)}
            </option>
          ))}
        </Select>
      </div>

      <fieldset className="flex flex-col gap-3 rounded-xl bg-card p-4">
        <legend className="sr-only">{t('settings.library.updatesSkip')}</legend>
        <div className="font-semibold text-foreground" aria-hidden>
          {t('settings.library.updatesSkip')}
        </div>
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            className="size-4 accent-accent"
            checked={settings.updateSkipCompleted}
            onChange={(event) => update.mutate({ updateSkipCompleted: event.target.checked })}
          />
          {t('settings.library.skipCompleted')}
        </label>
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            className="size-4 accent-accent"
            checked={settings.updateSkipNotStarted}
            onChange={(event) => update.mutate({ updateSkipNotStarted: event.target.checked })}
          />
          {t('settings.library.skipNotStarted')}
        </label>
        <div className="flex items-center gap-3">
          <input
            id="skip-unwatched"
            type="checkbox"
            className="size-4 accent-accent"
            checked={limit !== null}
            onChange={(event) =>
              update.mutate({
                updateSkipUnwatchedOver: event.target.checked ? Number(draft) || DEFAULT_UNWATCHED_LIMIT : null,
              })
            }
          />
          <label htmlFor="skip-unwatched" className="cursor-pointer">
            {t('settings.library.skipUnwatchedBefore')}
          </label>
          <Input
            type="number"
            min={1}
            max={1000}
            value={draft}
            disabled={limit === null}
            aria-label={t('settings.library.skipUnwatchedNumber')}
            onChange={(event) => setTyped(event.target.value)}
            onBlur={(event) => commit(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && commit(event.currentTarget.value)}
            className="w-16 px-2 text-center font-mono"
          />
          <span>{t('settings.library.skipUnwatchedAfter')}</span>
        </div>
        <div className="text-xs leading-4">{t('settings.library.skipHint')}</div>
      </fieldset>
    </section>
  );
}

function AutoDownloadSection() {
  const { t } = useTranslation();
  const { data: settings } = useQuery(settingsQuery);
  const { data: categories = [] } = useQuery(categoriesQuery);
  const update = useUpdateSettings();
  const mark = useMutation({
    mutationFn: (input: { id: number; mode: AutoDownloadMode | null }) => call('categories.setAutoDownload', input),
  });
  if (!settings) return null;

  return (
    <section className="flex flex-col gap-4 border-t pt-5" aria-labelledby="auto-download-title">
      <div className="flex items-center gap-4">
        <div className="flex-1">
          <label id="auto-download-title" htmlFor="auto-download" className="block font-semibold text-foreground">
            {t('settings.library.autoDownload')}
          </label>
          <div className="text-xs leading-4">{t('settings.library.autoDownloadHint')}</div>
        </div>
        <Switch
          id="auto-download"
          checked={settings.autoDownload}
          onCheckedChange={(autoDownload) => update.mutate({ autoDownload })}
        />
      </div>

      {categories.length > 0 ? (
        <div className={cn('flex flex-col', !settings.autoDownload && 'opacity-60')}>
          <div className="pb-2 text-xs leading-4 font-medium text-foreground">
            {t('settings.library.autoDownloadCategories')}
          </div>
          <ul className="flex flex-col divide-y divide-border">
            {categories.map((category) => (
              <CategoryMark
                key={category.id}
                category={category}
                onChange={(mode) => mark.mutate({ id: category.id, mode })}
              />
            ))}
          </ul>
          <div className="pt-3 text-xs leading-4">{t('settings.library.autoDownloadRule')}</div>
        </div>
      ) : null}
    </section>
  );
}

/** A tri-state box: click cycles no mark → include → exclude → no mark. */
function CategoryMark({
  category,
  onChange,
}: {
  category: Category;
  onChange: (mode: AutoDownloadMode | null) => void;
}) {
  const { t } = useTranslation();
  const mode = category.autoDownload;
  return (
    <li className="flex items-center gap-3 py-2">
      <button
        type="button"
        role="checkbox"
        aria-checked={ariaCheckedOf(mode)}
        aria-label={category.name}
        onClick={() => onChange(nextAutoDownloadMode(mode))}
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded border border-border-strong bg-background text-on-accent',
          mode === 'include' && 'border-accent bg-accent',
          mode === 'exclude' && 'border-danger bg-danger',
        )}
      >
        {mode === 'include' ? <Check className="size-3" strokeWidth={3} aria-hidden /> : null}
        {mode === 'exclude' ? <Minus className="size-3" strokeWidth={3} aria-hidden /> : null}
      </button>
      <span className="flex-1 text-foreground">{category.name}</span>
      <span className="text-xs leading-4">
        {mode === null ? '' : t(mode === 'include' ? 'settings.library.include' : 'settings.library.exclude')}
      </span>
    </li>
  );
}
