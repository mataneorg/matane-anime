import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import { availableQuery, extensionsQuery } from '@renderer/lib/catalog';
import { settingsQuery, useUpdateSettings } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/utils';
import { languageName, languageOptions, languagesInUse, toggleLanguage } from './helpers';

/** The language codes to offer: the usual ones, the ones sources use here, and what is already selected. */
function useLanguageOptions(): { options: string[]; selected: string[] } {
  const { data: settings } = useQuery(settingsQuery);
  const { data: extensions = [] } = useQuery(extensionsQuery);
  const { data: available = [] } = useQuery(availableQuery);
  const selected = settings?.contentLanguages ?? [];
  return { options: languageOptions(languagesInUse(extensions, available), selected), selected };
}

/** Content language as chips (Settings → General, mockup 10c). None selected means every language. */
export function LanguageChips() {
  const { t, i18n } = useTranslation();
  const update = useUpdateSettings();
  const { options, selected } = useLanguageOptions();
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="pb-1.5 text-xs leading-4 font-semibold">{t('settings.general.contentLanguage.title')}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((code) => {
          const on = selected.includes(code);
          return (
            <button
              key={code}
              type="button"
              aria-pressed={on}
              onClick={() => update.mutate({ contentLanguages: toggleLanguage(selected, code) })}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-full border border-border-strong px-3 text-[13px] transition-colors',
                on && 'border-accent bg-accent/16 font-semibold text-foreground',
              )}
            >
              {on ? <Check className="size-3.5" strokeWidth={2.25} aria-hidden /> : null}
              {languageName(code, i18n.language)}
            </button>
          );
        })}
      </div>
      <span className="text-xs leading-4">
        {t(
          selected.length === 0
            ? 'settings.general.contentLanguage.hintAll'
            : 'settings.general.contentLanguage.hintSome',
        )}
      </span>
    </fieldset>
  );
}

/** The Language filter on the Extensions page: a menu with the same choices as the chips, same setting. */
export function LanguageFilter() {
  const { t, i18n } = useTranslation();
  const update = useUpdateSettings();
  const { options, selected } = useLanguageOptions();
  const summary =
    selected.length === 0
      ? t('extensions.filter.allLanguages')
      : selected.map((code) => languageName(code, i18n.language)).join(', ');
  return (
    <div className="flex items-center gap-2">
      <span id="language-filter-label" className="text-xs leading-4">
        {t('extensions.filter.language')}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-labelledby="language-filter-label language-filter-value"
          className="inline-flex h-9 max-w-64 items-center gap-2 rounded-lg border border-border-strong bg-background px-3 text-foreground hover:bg-input/30"
        >
          <span id="language-filter-value" className="truncate">
            {summary}
          </span>
          <ChevronDown className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {options.map((code) => (
            <DropdownMenuCheckboxItem
              key={code}
              checked={selected.includes(code)}
              onCheckedChange={() => update.mutate({ contentLanguages: toggleLanguage(selected, code) })}
            >
              {languageName(code, i18n.language)}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
