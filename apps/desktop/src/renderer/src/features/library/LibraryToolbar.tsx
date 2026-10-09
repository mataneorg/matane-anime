import { LIBRARY_SORTS, type LibrarySettings, type LibrarySort, type SourceInfo } from '@matane-anime/shared';
import { ArrowDownUp, Check, ListFilter, SquareCheckBig, SlidersHorizontal } from 'lucide-react';
import { DropdownMenu, Popover } from 'radix-ui';
import { useTranslation } from 'react-i18next';
import { CoverViewControls } from '@renderer/components/CoverViewControls';
import { SearchField } from '@renderer/components/SearchField';
import { Button } from '@renderer/components/ui/button';
import { menuContentClass, menuItemClass } from '@renderer/components/ui/dropdown-menu';
import { cn } from '@renderer/lib/utils';
import { type LibraryFilters, NO_FILTERS, STATUSES, filterCount, toggleIn } from './filters';
import { FilterHeading, FilterToggle } from './FilterToggle';

/** The library's search, Filters popover, Sort menu, display controls and the Select toggle (docs/ui/screens/01-library). */
export function LibraryToolbar({
  query,
  onQuery,
  settings,
  filters,
  onChange,
  sources,
  selecting,
  onToggleSelecting,
}: {
  query: string;
  onQuery: (query: string) => void;
  settings: LibrarySettings;
  /** The filters in effect (the saved ones without sources that are gone). */
  filters: LibraryFilters;
  onChange: (patch: Partial<LibrarySettings>) => void;
  sources: Pick<SourceInfo, 'id' | 'name' | 'lang'>[];
  selecting: boolean;
  onToggleSelecting: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <SearchField value={query} onChange={onQuery} placeholder={t('library.filter')} className="w-56" />
      <FilterPopover settings={settings} filters={filters} onChange={onChange} sources={sources} />
      <SortMenu
        sort={settings.sort}
        reversed={settings.descending}
        onSort={(sort) => onChange({ sort })}
        onReversed={(descending) => onChange({ descending })}
      />
      <CoverViewControls display={settings.display} coverSize={settings.coverSize} onChange={onChange} />
      <Button
        variant={selecting ? 'default' : 'secondary'}
        size="sm"
        aria-pressed={selecting}
        onClick={onToggleSelecting}
      >
        <SquareCheckBig aria-hidden />
        {t('library.select')}
      </Button>
    </div>
  );
}

function FilterPopover({
  settings,
  filters,
  onChange,
  sources,
}: {
  settings: LibrarySettings;
  filters: LibraryFilters;
  onChange: (patch: Partial<LibrarySettings>) => void;
  sources: Pick<SourceInfo, 'id' | 'name' | 'lang'>[];
}) {
  const { t } = useTranslation();
  const active = filterCount(filters);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button
          variant="secondary"
          size="sm"
          aria-label={active > 0 ? t('library.filtersActive', { count: active }) : t('library.filters')}
          className={cn(active > 0 && 'border-primary text-primary-text')}
        >
          <SlidersHorizontal aria-hidden />
          {t('library.filters')}
          {active > 0 ? <span aria-hidden className="size-1.5 rounded-full bg-primary" /> : null}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={8}
          className="z-50 flex max-h-(--radix-popover-content-available-height) w-72 flex-col gap-1 overflow-y-auto rounded-lg border bg-popover p-2 text-popover-foreground shadow-xl"
        >
          <FilterToggle
            on={settings.unwatchedOnly}
            onClick={() => onChange({ unwatchedOnly: !settings.unwatchedOnly })}
          >
            {t('library.unwatchedOnly')}
          </FilterToggle>
          <FilterToggle on={settings.startedOnly} onClick={() => onChange({ startedOnly: !settings.startedOnly })}>
            {t('library.startedOnly')}
          </FilterToggle>
          <FilterToggle
            on={settings.downloadedOnly}
            onClick={() => onChange({ downloadedOnly: !settings.downloadedOnly })}
          >
            {t('library.downloadedOnly')}
          </FilterToggle>
          <FilterHeading>{t('library.status')}</FilterHeading>
          {STATUSES.map((status) => (
            <FilterToggle
              key={status}
              on={settings.status.includes(status)}
              onClick={() => onChange({ status: toggleIn(settings.status, status) })}
            >
              {status === 'unknown' ? t('library.statusUnknown') : t(`anime.status.${status}`)}
            </FilterToggle>
          ))}
          {sources.length > 0 ? (
            <>
              <FilterHeading>{t('library.source')}</FilterHeading>
              {sources.map((source) => (
                <FilterToggle
                  key={source.id}
                  on={settings.sourceIds.includes(source.id)}
                  onClick={() => onChange({ sourceIds: toggleIn(settings.sourceIds, source.id) })}
                >
                  <span className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate">{source.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{source.lang.toUpperCase()}</span>
                  </span>
                </FilterToggle>
              ))}
            </>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="mt-2"
            disabled={active === 0}
            onClick={() => onChange(NO_FILTERS)}
          >
            <ListFilter aria-hidden />
            {t('browse.filters.reset')}
          </Button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The sort field as radio items, then "Reverse order" (every field has a natural direction: A–Z, newest first). */
function SortMenu({
  sort,
  reversed,
  onSort,
  onReversed,
}: {
  sort: LibrarySort;
  reversed: boolean;
  onSort: (sort: LibrarySort) => void;
  onReversed: (reversed: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="secondary" size="sm">
          <ArrowDownUp aria-hidden />
          {t('library.sortLabel', { sort: t(`library.sort.${sort}`) })}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          aria-label={t('library.sortBy')}
          className={cn(menuContentClass, 'min-w-52')}
        >
          <DropdownMenu.RadioGroup
            value={sort}
            onValueChange={(value) => {
              const next = LIBRARY_SORTS.find((name) => name === value);
              if (next) onSort(next);
            }}
          >
            {LIBRARY_SORTS.map((name) => (
              <DropdownMenu.RadioItem key={name} value={name} className={menuItemClass}>
                <span className="flex size-4 items-center justify-center">
                  <DropdownMenu.ItemIndicator>
                    <Check className="size-4 text-primary-text" aria-hidden />
                  </DropdownMenu.ItemIndicator>
                </span>
                {t(`library.sort.${name}`)}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-border" />
          <DropdownMenu.CheckboxItem
            checked={reversed}
            onCheckedChange={onReversed}
            onSelect={(event) => event.preventDefault()}
            className={menuItemClass}
          >
            <span className="flex size-4 items-center justify-center">
              <DropdownMenu.ItemIndicator>
                <Check className="size-4 text-primary-text" aria-hidden />
              </DropdownMenu.ItemIndicator>
            </span>
            {t('library.sort.reverse')}
          </DropdownMenu.CheckboxItem>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
