import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Languages } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@renderer/components/ui/dropdown-menu';
import { Switch } from '@renderer/components/ui/switch';
import { availableQuery, extensionsQuery } from '@renderer/lib/catalog';
import { settingsQuery, useUpdateSettings } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/utils';
import { languageName, languageOptions, languagesInUse, toggleLanguage } from './helpers';

// What the user wants to see: content languages and adult sources. Both are app settings (`contentLanguages`,
// `showNsfw`), the same ones as in Settings → General, so changing them here changes them there.

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
      <legend className="pb-1.5 text-xs font-medium text-muted-foreground">
        {t('settings.general.contentLanguage.title')}
      </legend>
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
                'inline-flex h-8 items-center gap-1.5 rounded-lg border border-input px-3 text-xs transition-colors hover:border-foreground/40',
                on && 'border-primary bg-primary/15 text-primary-text',
              )}
            >
              {on ? <Check className="size-3.5" strokeWidth={2.25} aria-hidden /> : null}
              {languageName(code, i18n.language)}
            </button>
          );
        })}
      </div>
      <span className="text-xs text-muted-foreground">
        {t(
          selected.length === 0
            ? 'settings.general.contentLanguage.hintAll'
            : 'settings.general.contentLanguage.hintSome',
        )}
      </span>
    </fieldset>
  );
}

/**
 * The content-language menu of the Extensions page (a button that opens a checklist). Same setting as the chips in
 * General. Its name starts with "Language" and ends with the choice ("Language: Japanese", "Language: All languages").
 */
export function ContentLanguagePicker({ className }: { className?: string }) {
  const { t, i18n } = useTranslation();
  const update = useUpdateSettings();
  const { options, selected } = useLanguageOptions();
  const summary =
    selected.length === 0
      ? t('extensions.filter.allLanguages')
      : selected.map((code) => languageName(code, i18n.language)).join(', ');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex h-8 max-w-64 items-center gap-2 rounded-lg border border-input bg-background px-3 text-xs text-foreground transition-colors hover:bg-accent',
          className,
        )}
      >
        <Languages className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
        <span className="truncate">{t('extensions.filter.languageValue', { langs: summary })}</span>
        <ChevronDown className="size-4 shrink-0 opacity-60" strokeWidth={1.75} aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto"
      >
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
  );
}

/** Show 18+ extensions and sources (`showNsfw`): a switch named "Show 18+ sources", the same setting as in General. */
export function NsfwToggle({ id }: { id?: string }) {
  const { t } = useTranslation();
  const { data: settings } = useQuery(settingsQuery);
  const update = useUpdateSettings();
  return (
    <Switch
      id={id}
      aria-label={t('extensions.filter.nsfw')}
      checked={settings?.showNsfw ?? false}
      disabled={!settings}
      onCheckedChange={(showNsfw) => update.mutate({ showNsfw })}
    />
  );
}
