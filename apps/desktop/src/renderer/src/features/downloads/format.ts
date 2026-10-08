const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** "412 MB", "14.2 GB", "6.2 MB": one decimal while the number is small, none once it is long enough. */
export function formatBytes(bytes: number, locale = 'en'): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  const decimals = unit === 0 ? 0 : value < (unit >= 3 ? 100 : 10) ? 1 : 0;
  const text = new Intl.NumberFormat(locale, { maximumFractionDigits: decimals });
  return `${text.format(value)} ${UNITS[unit]}`;
}

export const formatSpeed = (bytesPerSecond: number, locale = 'en'): string =>
  `${formatBytes(bytesPerSecond, locale)}/s`;

/** "03:12", or "1:02:10" past an hour. */
export function formatEta(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const two = (n: number): string => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${two(minutes)}:${two(secs)}` : `${two(minutes)}:${two(secs)}`;
}

/** 0 to 100, from segments when the stream has them and from bytes otherwise; null when nothing says how far. */
export function percentDone(item: {
  segmentsDone: number;
  segmentsTotal: number | null;
  bytesDone: number;
  sizeBytes: number | null;
}): number | null {
  if (item.segmentsTotal) return Math.min(100, (item.segmentsDone / item.segmentsTotal) * 100);
  if (item.sizeBytes) return Math.min(100, (item.bytesDone / item.sizeBytes) * 100);
  return null;
}

/** The share of the size limit in use, capped for the bar; `over` tells when it is passed. */
export function usageShare(usedBytes: number, limitBytes: number): { percent: number; over: boolean } {
  if (limitBytes <= 0) return { percent: 0, over: usedBytes > 0 };
  return { percent: Math.min(100, (usedBytes / limitBytes) * 100), over: usedBytes > limitBytes };
}
