import { DOWNLOAD_QUALITIES, type DownloadQuality } from '@matane-anime/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type KeyboardEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@renderer/components/ui/input';
import { Select } from '@renderer/components/ui/select';
import { Switch } from '@renderer/components/ui/switch';
import { ChangeFolderButton } from '@renderer/features/downloads/ChangeFolderButton';
import { formatBytes } from '@renderer/features/downloads/format';
import { downloadStorageQuery } from '@renderer/lib/downloads';
import { settingsQuery, useUpdateSettings } from '@renderer/lib/ipc';
import { categoriesQuery } from '@renderer/lib/library';

const EPISODES_AT_ONCE = [1, 2, 3];
const SEGMENTS = [1, 2, 4, 6, 8, 12, 16];
const AHEAD_COUNTS = [1, 2, 3, 5, 10];
const DELETE_DELAYS = [0, 1, 2, 3, 5, 10];
const MIN_LIMIT_GB = 1;
const MAX_LIMIT_GB = 10_000;

/** The listed values, plus the stored one when it is none of them (a value set by an older build or by hand). */
const withCurrent = (options: number[], value: number): number[] =>
  options.includes(value) ? options : [...options, value].sort((a, b) => a - b);

/** Settings → Downloads (mockup 10e). The behavior behind "ahead" and "delete after watching" lives in main. */
export function DownloadsSettings() {
  const { t, i18n } = useTranslation();
  const { data: settings } = useQuery(settingsQuery);
  const { data: storage } = useQuery(downloadStorageQuery);
  const { data: categories = [] } = useQuery(categoriesQuery);
  const update = useUpdateSettings();
  const queryClient = useQueryClient();
  // What is typed in the size limit field, until it is saved with Enter or by leaving the field.
  const [limitDraft, setLimitDraft] = useState<string | null>(null);
  if (!settings) return null;

  const commitLimit = (): void => {
    const value = Number(limitDraft);
    setLimitDraft(null);
    if (limitDraft === null || !Number.isFinite(value)) return;
    const clamped = Math.min(MAX_LIMIT_GB, Math.max(MIN_LIMIT_GB, value));
    if (clamped === settings.downloadSizeLimitGb) return;
    // The storage numbers (the limit in bytes) come from main and would otherwise stay as they were.
    update.mutate(
      { downloadSizeLimitGb: clamped },
      { onSuccess: () => void queryClient.invalidateQueries({ queryKey: downloadStorageQuery.queryKey }) },
    );
  };
  const onLimitKey = (event: KeyboardEvent): void => {
    if (event.key === 'Enter') commitLimit();
    if (event.key === 'Escape') setLimitDraft(null);
  };
  const excluded = new Set(settings.deleteAfterWatchedExcludedCategories);
  const toggleExcluded = (id: number): void => {
    const next = new Set(excluded);
    if (!next.delete(id)) next.add(id);
    update.mutate({ deleteAfterWatchedExcludedCategories: [...next] });
  };

  const folder = storage?.folder ?? settings.downloadFolder ?? '';
  const free = storage?.freeBytes != null ? formatBytes(storage.freeBytes, i18n.language) : null;

  return (
    <div className="flex max-w-190 flex-col gap-6">
      <section className="flex flex-col gap-2" aria-labelledby="dl-folder-title">
        <h2 id="dl-folder-title" className="text-[15px] leading-[22px] font-semibold">
          {t('settings.downloads.folder')}
        </h2>
        <div className="flex gap-2">
          <div
            aria-label={t('settings.downloads.folder')}
            className="flex h-10 min-w-0 flex-1 items-center rounded-lg border border-border-strong bg-background px-3 font-mono text-foreground"
          >
            <span className="truncate" title={folder}>
              {folder}
            </span>
          </div>
          <ChangeFolderButton size="lg" />
        </div>
        <p className="text-xs leading-4">
          {free ? `${t('settings.downloads.free', { size: free })} ` : ''}
          {t('settings.downloads.folderHint')}
        </p>
      </section>

      <div className="grid grid-cols-1 gap-4 border-t pt-6 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="dl-quality" className="font-semibold">
            {t('settings.downloads.quality')}
          </label>
          <Select
            id="dl-quality"
            value={settings.downloadQuality}
            onChange={(event) => update.mutate({ downloadQuality: event.target.value as DownloadQuality })}
          >
            {DOWNLOAD_QUALITIES.map((quality) => (
              <option key={quality} value={quality}>
                {t(`settings.downloads.qualities.${quality}`)}
              </option>
            ))}
          </Select>
          <div className="text-xs leading-4">{t('settings.downloads.qualityHint')}</div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="dl-episodes" className="font-semibold">
            {t('settings.downloads.episodesAtOnce')}
          </label>
          <Select
            id="dl-episodes"
            value={settings.downloadParallelEpisodes}
            onChange={(event) => update.mutate({ downloadParallelEpisodes: Number(event.target.value) })}
          >
            {withCurrent(EPISODES_AT_ONCE, settings.downloadParallelEpisodes).map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </Select>
          <div className="text-xs leading-4">{t('settings.downloads.episodesAtOnceHint')}</div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="dl-segments" className="font-semibold">
            {t('settings.downloads.segments')}
          </label>
          <Select
            id="dl-segments"
            value={settings.downloadParallelSegments}
            onChange={(event) => update.mutate({ downloadParallelSegments: Number(event.target.value) })}
          >
            {withCurrent(SEGMENTS, settings.downloadParallelSegments).map((count) => (
              <option key={count} value={count}>
                {count}
              </option>
            ))}
          </Select>
          <div className="text-xs leading-4">{t('settings.downloads.segmentsHint')}</div>
        </div>
      </div>

      <section className="flex flex-col gap-5 border-t pt-6" aria-label={t('settings.downloads.automation')}>
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <label htmlFor="dl-ahead" className="block font-semibold">
              {t('settings.downloads.ahead')}
            </label>
            <div className="text-xs leading-4">{t('settings.downloads.aheadHint')}</div>
          </div>
          <Select
            aria-label={t('settings.downloads.aheadCount')}
            value={settings.downloadAheadCount}
            onChange={(event) => update.mutate({ downloadAheadCount: Number(event.target.value) })}
          >
            {withCurrent(AHEAD_COUNTS, settings.downloadAheadCount).map((count) => (
              <option key={count} value={count}>
                {t('settings.downloads.nextCount', { count })}
              </option>
            ))}
          </Select>
          <Switch
            id="dl-ahead"
            checked={settings.downloadAhead}
            onCheckedChange={(downloadAhead) => update.mutate({ downloadAhead })}
          />
        </div>

        <div className="flex items-center gap-4">
          <div className="flex-1">
            <label htmlFor="dl-delete" className="block font-semibold">
              {t('settings.downloads.deleteAfter')}
            </label>
            <div className="text-xs leading-4">{t('settings.downloads.deleteAfterHint')}</div>
          </div>
          <Select
            aria-label={t('settings.downloads.deleteDelay')}
            value={settings.deleteAfterWatchedDelay}
            onChange={(event) => update.mutate({ deleteAfterWatchedDelay: Number(event.target.value) })}
          >
            {withCurrent(DELETE_DELAYS, settings.deleteAfterWatchedDelay).map((count) => (
              <option key={count} value={count}>
                {count === 0 ? t('settings.downloads.afterNow') : t('settings.downloads.afterCount', { count })}
              </option>
            ))}
          </Select>
          <Switch
            id="dl-delete"
            checked={settings.deleteAfterWatched}
            onCheckedChange={(deleteAfterWatched) => update.mutate({ deleteAfterWatched })}
          />
        </div>

        {settings.deleteAfterWatched && categories.length > 0 ? (
          <fieldset className="flex flex-col gap-2 rounded-xl bg-card p-4">
            <legend className="sr-only">{t('settings.downloads.keepCategories')}</legend>
            <div className="font-semibold text-foreground" aria-hidden>
              {t('settings.downloads.keepCategories')}
            </div>
            <div className="text-xs leading-4">{t('settings.downloads.keepCategoriesHint')}</div>
            <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
              {categories.map((category) => (
                <label key={category.id} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-accent"
                    checked={excluded.has(category.id)}
                    onChange={() => toggleExcluded(category.id)}
                  />
                  {category.name}
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}
      </section>

      <section className="flex flex-col gap-2 border-t pt-6" aria-labelledby="dl-limit-title">
        <h2 id="dl-limit-title" className="text-[15px] leading-[22px] font-semibold">
          {t('settings.downloads.limit')}
        </h2>
        <div className="flex items-center gap-3">
          <Input
            type="number"
            inputMode="numeric"
            min={MIN_LIMIT_GB}
            max={MAX_LIMIT_GB}
            aria-label={t('settings.downloads.limit')}
            value={limitDraft ?? String(settings.downloadSizeLimitGb)}
            onChange={(event) => setLimitDraft(event.target.value)}
            onBlur={commitLimit}
            onKeyDown={onLimitKey}
            className="h-10 w-24 bg-background text-right font-mono"
          />
          <span>{t('settings.downloads.gb')}</span>
          {storage ? (
            <span className="font-mono text-xs leading-4 text-foreground">
              {t('settings.downloads.used', { size: formatBytes(storage.usedBytes, i18n.language) })}
            </span>
          ) : null}
        </div>
        <p className="text-xs leading-4">{t('settings.downloads.limitHint')}</p>
      </section>
    </div>
  );
}
