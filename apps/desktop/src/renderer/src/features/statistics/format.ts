export const HOUR_MS = 60 * 60 * 1000;

/** Watch time in hours, or in minutes under an hour (so a short session never reads "0 h"). */
export function duration(ms: number): { value: number; unit: 'h' | 'min' } {
  return ms >= HOUR_MS ? { value: ms / HOUR_MS, unit: 'h' } : { value: Math.round(ms / 60_000), unit: 'min' };
}

/**
 * Nice round axis steps (1, 2, 5 × 10ⁿ) up to at least `max`. With `integer` the step is a whole number of at least
 * 1, for counts (there is no half an episode).
 */
export function niceTicks(
  max: number,
  { count = 4, integer = false }: { count?: number; integer?: boolean } = {},
): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  let step = [1, 2, 5, 10].map((factor) => factor * power).find((candidate) => candidate >= raw) ?? power * 10;
  if (integer) step = Math.max(1, Math.ceil(step));
  const ticks: number[] = [];
  for (let value = 0; value <= max + step * 0.001; value += step) ticks.push(Number(value.toFixed(6)));
  const last = ticks.at(-1) ?? 0;
  if (last < max) ticks.push(Number((last + step).toFixed(6)));
  return ticks;
}

/**
 * The unit a series of watch times is drawn in: minutes while even the longest bucket is under an hour (so a short
 * session is not "0.1 h"), hours otherwise.
 */
export function timeScale(maxMs: number): { unit: 'h' | 'min'; perUnitMs: number } {
  return maxMs < HOUR_MS ? { unit: 'min', perUnitMs: 60_000 } : { unit: 'h', perUnitMs: HOUR_MS };
}

/** Indexes of the x-axis labels: every `every`-th column counted back from the last one, so the last always has one. */
export function labelIndexes(length: number, every: number): number[] {
  const step = Math.max(1, Math.floor(every));
  const indexes: number[] = [];
  for (let i = length - 1; i >= 0; i -= step) indexes.push(i);
  return indexes.reverse();
}

/** Share of a total as a whole percent (0 when there is no total). */
export function percentOf(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}
