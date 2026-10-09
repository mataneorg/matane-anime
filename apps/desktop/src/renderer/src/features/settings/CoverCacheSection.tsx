import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/components/ui/button';
import { Select } from '@renderer/components/ui/select';
import { formatBytes } from '@renderer/features/downloads/format';
import { call } from '@renderer/lib/api';
import { describeError } from '@renderer/lib/errors';
import { settingsQuery, useUpdateSettings } from '@renderer/lib/ipc';
import { localQueryDefaults } from '@renderer/lib/query';
import { notify } from '@renderer/lib/toast';

const SIZES_MB = [256, 512, 1024, 2048, 5120];
const cacheSizeQuery = {
  queryKey: ['storage', 'cache'],
  queryFn: () => call('storage.cacheSize'),
  ...localQueryDefaults,
};

/** Settings → Data and storage: how much disk the browse covers may use, and a way to empty them. */
export function CoverCacheSection() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { data: settings } = useQuery(settingsQuery);
  const { data: used } = useQuery(cacheSizeQuery);
  const update = useUpdateSettings();
  const clear = useMutation({
    mutationFn: () => call('storage.clearCache'),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: cacheSizeQuery.queryKey }),
    onError: (error) => notify.error(t('settings.data.clearCacheFailed'), describeError(error, t)),
  });
  if (!settings) return null;
  const sizes = SIZES_MB.includes(settings.imageCacheSizeMb)
    ? SIZES_MB
    : [...SIZES_MB, settings.imageCacheSizeMb].sort((a, b) => a - b);

  return (
    <section className="flex flex-col gap-3" aria-labelledby="cover-cache-title">
      <h2 id="cover-cache-title" className="text-[15px] leading-[22px] font-semibold">
        {t('settings.data.coverCache')}
      </h2>
      <p className="text-xs leading-4">{t('settings.data.coverCacheHint')}</p>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="cover-cache-size" className="font-semibold">
          {t('settings.data.coverCacheLimit')}
        </label>
        <Select
          id="cover-cache-size"
          value={settings.imageCacheSizeMb}
          onChange={(event) => update.mutate({ imageCacheSizeMb: Number(event.target.value) })}
        >
          {sizes.map((mb) => (
            <option key={mb} value={mb}>
              {formatBytes(mb * 1024 * 1024, i18n.language)}
            </option>
          ))}
        </Select>
        <span className="font-mono text-xs leading-4 text-foreground">
          {t('settings.data.coverCacheUsed', { size: formatBytes(used ?? 0, i18n.language) })}
        </span>
        <Button variant="secondary" size="sm" disabled={clear.isPending || !used} onClick={() => clear.mutate()}>
          {t('settings.data.clearCache')}
        </Button>
      </div>
    </section>
  );
}
