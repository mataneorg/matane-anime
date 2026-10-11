import type { Filter, FilterState, FilterValue, SortValue } from '@matane-anime/extension-sdk';

/*
 * What a filter holds, in one place, so that what the panel shows is what the extension receives.
 *
 * A filter has a baseline: its declared `default`, else "nothing" ('' for text and selects, false for a checkbox, no
 * sort, no tri-state). A state (the draft in the panel, the `filters` of the address) holds only what differs from
 * the baseline: the address stays short, and "N filters on" counts what the user changed. An explicit '' or false
 * is a change when the default is something else (a checkbox that is on by default, turned off).
 *
 * The request is the state plus the defaults that are not empty (`requestFilters`): the extension is told about a
 * default the panel shows as chosen, and about an explicit false or '' where the user switched a default off.
 */

/** The filters that carry a value, at any depth. */
export type Field = Exclude<Filter, { type: 'header' | 'separator' | 'group' }>;

export function fieldsOf(filters: readonly Filter[]): Field[] {
  return filters.flatMap((filter): Field[] => {
    if (filter.type === 'group') return fieldsOf(filter.filters);
    if (filter.type === 'header' || filter.type === 'separator') return [];
    return [filter];
  });
}

const isSort = (value: unknown): value is SortValue =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as SortValue).value === 'string' &&
  typeof (value as SortValue).ascending === 'boolean';

/** What the filter is when the user has not touched it. */
export function baseline(field: Field): FilterValue | undefined {
  switch (field.type) {
    case 'text':
      return '';
    case 'select':
      return field.default ?? '';
    case 'checkbox':
      return field.default ?? false;
    case 'sort':
      return field.default;
    case 'tristate':
      return undefined;
  }
}

/** `value` if it is the kind of value this filter holds (an address can be edited by hand), else undefined. */
function typed(field: Field, value: FilterValue | undefined): FilterValue | undefined {
  switch (field.type) {
    case 'text':
    case 'select':
      return typeof value === 'string' ? value : undefined;
    case 'checkbox':
      return typeof value === 'boolean' ? value : undefined;
    case 'tristate':
      return value === 'include' || value === 'exclude' ? value : undefined;
    case 'sort':
      return isSort(value) ? value : undefined;
  }
}

function sameValue(a: FilterValue | undefined, b: FilterValue | undefined): boolean {
  if (isSort(a) && isSort(b)) return a.value === b.value && a.ascending === b.ascending;
  return a === b;
}

/** What the panel shows for a filter: what the state holds, else the baseline. */
export function resolve(field: Field, state: FilterState): FilterValue | undefined {
  return typed(field, state[field.id]) ?? baseline(field);
}

/** Whether the state moves this filter off its baseline. */
export function isSet(field: Field, state: FilterState): boolean {
  const value = typed(field, state[field.id]);
  return value !== undefined && !sameValue(value, baseline(field));
}

/** Without a declaration to compare with: drops what is plainly unset (empty text, "Any", an unchecked box). */
export function cleanFilters(state: FilterState): FilterState {
  return Object.fromEntries(Object.entries(state).filter(([, value]) => value !== '' && value !== false));
}

/** The state reduced to what differs from the baselines; ids the filters do not declare follow `cleanFilters`. */
export function normalize(filters: readonly Filter[], state: FilterState): FilterState {
  const byId = new Map(fieldsOf(filters).map((field) => [field.id, field]));
  const out: FilterState = {};
  for (const [id, raw] of Object.entries(state)) {
    const field = byId.get(id);
    if (!field) {
      if (raw !== '' && raw !== false) out[id] = raw;
    } else if (isSet(field, state)) {
      out[id] = typed(field, raw) as FilterValue;
    }
  }
  return out;
}

/** How many filters are on. */
export function countActive(filters: readonly Filter[], state: FilterState): number {
  return Object.keys(normalize(filters, state)).length;
}

/** Whether two states mean the same to the extension. */
export function sameFilters(filters: readonly Filter[], a: FilterState, b: FilterState): boolean {
  const left = normalize(filters, a);
  const right = normalize(filters, b);
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => sameValue(left[key], right[key]));
}

/** How many of the filters declared in `filters` (a group, say) are on, looking inside nested groups. */
export function countIn(filters: readonly Filter[], state: FilterState): number {
  return fieldsOf(filters).filter((field) => isSet(field, state)).length;
}

/** What is sent to the extension: the state, plus every declared default that is not empty. */
export function requestFilters(filters: readonly Filter[], state: FilterState): FilterState {
  const out = normalize(filters, state);
  for (const field of fieldsOf(filters)) {
    if (field.id in out) continue;
    const base = baseline(field);
    if (base !== undefined && base !== '' && base !== false) out[field.id] = base;
  }
  return out;
}

/** The filters that are on, with their declarations, in the order the extension declared them. */
export function appliedItems(filters: readonly Filter[], state: FilterState): { field: Field; value: FilterValue }[] {
  return fieldsOf(filters).flatMap((field) => {
    const value = isSet(field, state) ? typed(field, state[field.id]) : undefined;
    return value === undefined ? [] : [{ field, value }];
  });
}
