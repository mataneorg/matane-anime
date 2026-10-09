import type { SourceInfo } from '@matane-anime/shared';

/**
 * The sources a global search asks: the ones picked (null, or a pick that matches no source any more, means
 * all of them), then only those in `language` ('all' for every language). Empty when the language leaves none.
 */
export function searchScope<T extends Pick<SourceInfo, 'id' | 'lang'>>(
  searchable: readonly T[],
  pickedIds: readonly string[] | null,
  language: string,
): T[] {
  const picked = pickedIds === null ? null : new Set(pickedIds);
  const chosen = picked === null ? searchable : searchable.filter((source) => picked.has(source.id));
  return (chosen.length > 0 ? chosen : searchable).filter((source) => language === 'all' || source.lang === language);
}
