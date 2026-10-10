import type { Language } from '@matane-anime/shared';
import { type CatalogKey, en, id } from './catalog';

const catalogs: Record<Language, Record<CatalogKey, string>> = { en, id };

type PluralSuffix = '_one' | '_other';
/** A key as callers write it: the plural forms of `a_one` and `a_other` are asked for as `a`. */
export type MainKey = CatalogKey extends infer K ? (K extends `${infer Base}${PluralSuffix}` ? Base : K) : never;

export type MainParams = Record<string, string | number>;

/**
 * Looks `key` up in the catalog of `language` and fills in `{{name}}` placeholders. A `count` param picks the
 * plural form by the language's own rules. Nothing escapes: the text goes to the OS, not to HTML.
 */
export function mainT(language: Language, key: MainKey, params: MainParams = {}): string {
  const catalog = catalogs[language];
  const plural =
    typeof params.count === 'number'
      ? new Intl.PluralRules(language).select(params.count) === 'one'
        ? 'one'
        : 'other'
      : null;
  const template = plural === null ? undefined : catalog[`${key}_${plural}` as CatalogKey];
  const text = template ?? catalog[key as CatalogKey] ?? en[key as CatalogKey] ?? key;
  return text.replace(/\{\{(\w+)\}\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}
