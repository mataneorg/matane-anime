import type { Filter, FilterState, FilterValue, SortValue } from '@matane-anime/extension-sdk';
import { ArrowDownUp, Check, Minus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Select } from '@renderer/components/ui/select';
import { cn } from '@renderer/lib/utils';

/** Drops what is unset (empty text, "Any") so the extension only sees filters the user touched. */
export function cleanFilters(state: FilterState): FilterState {
  return Object.fromEntries(Object.entries(state).filter(([, value]) => value !== '' && value !== false));
}

interface PanelProps {
  filters: Filter[];
  value: FilterState;
  onChange: (next: FilterState) => void;
  onApply: () => void;
  onReset: () => void;
  onClose: () => void;
}

/** The filters an extension declares, drawn without the extension knowing anything about the UI (EXT-14). */
export function FilterPanel({ filters, value, onChange, onApply, onReset, onClose }: PanelProps) {
  const { t } = useTranslation();
  const set = (id: string, next: FilterValue | undefined): void => {
    const copy = { ...value };
    if (next === undefined) delete copy[id];
    else copy[id] = next;
    onChange(copy);
  };

  const active = Object.keys(cleanFilters(value)).length;

  return (
    <aside
      aria-label={t('browse.filters.title')}
      className="sticky top-0 flex h-[calc(100vh-2.5rem)] w-80 self-start shrink-0 flex-col border-l bg-sidebar"
    >
      <div className="flex items-center gap-2 border-b px-5 py-3">
        <h2 className="text-sm font-semibold">{t('browse.filters.title')}</h2>
        {active > 0 ? (
          <span
            className="rounded-md bg-primary/20 px-1.5 text-[11px] font-medium text-primary-text"
            title={t('browse.filters.active', { count: active })}
          >
            {active}
          </span>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          aria-label={t('browse.filters.close')}
          title={t('browse.filters.close')}
          onClick={onClose}
        >
          <X aria-hidden />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
        {filters.length === 0 ? (
          <p className="text-muted-foreground">{t('browse.filters.none')}</p>
        ) : (
          <FilterList filters={filters} value={value} set={set} />
        )}
      </div>
      <div className="flex gap-2 border-t px-5 py-3">
        <Button variant="secondary" className="flex-1" onClick={onReset}>
          {t('browse.filters.reset')}
        </Button>
        <Button className="flex-1" onClick={onApply}>
          {t('browse.filters.apply')}
        </Button>
      </div>
    </aside>
  );
}

function FilterList({
  filters,
  value,
  set,
}: {
  filters: Filter[];
  value: FilterState;
  set: (id: string, next: FilterValue | undefined) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      {filters.map((filter, index) => {
        switch (filter.type) {
          case 'header':
            return (
              <h3 key={index} className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                {filter.label}
              </h3>
            );
          case 'separator':
            return <hr key={index} className="border-border" />;
          case 'text':
            return (
              <label key={filter.id} className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                {filter.label}
                <Input
                  value={typeof value[filter.id] === 'string' ? (value[filter.id] as string) : ''}
                  placeholder={filter.placeholder}
                  onChange={(event) => set(filter.id, event.target.value)}
                />
              </label>
            );
          case 'select':
            return (
              <label key={filter.id} className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
                {filter.label}
                <Select
                  value={typeof value[filter.id] === 'string' ? (value[filter.id] as string) : (filter.default ?? '')}
                  onChange={(event) => set(filter.id, event.target.value)}
                >
                  {filter.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </label>
            );
          case 'checkbox':
            return (
              <label key={filter.id} className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={value[filter.id] === true}
                  onChange={(event) => set(filter.id, event.target.checked)}
                />
                {filter.label}
              </label>
            );
          case 'tristate': {
            const state = value[filter.id];
            const next = state === 'include' ? 'exclude' : state === 'exclude' ? undefined : 'include';
            return (
              <button
                key={filter.id}
                type="button"
                role="checkbox"
                aria-checked={state === 'include' ? true : state === 'exclude' ? 'mixed' : false}
                onClick={() => set(filter.id, next)}
                className="flex items-center gap-2 text-left"
              >
                <span
                  className={cn(
                    'flex size-4 items-center justify-center rounded-sm border border-input',
                    state === 'include' && 'border-primary bg-primary text-primary-foreground',
                    state === 'exclude' && 'border-destructive bg-destructive text-destructive-foreground',
                  )}
                >
                  {state === 'include' ? <Check className="size-3" strokeWidth={3} aria-hidden /> : null}
                  {state === 'exclude' ? <Minus className="size-3" strokeWidth={3} aria-hidden /> : null}
                </span>
                <span className="flex-1">{filter.label}</span>
                {state ? <span className="text-xs text-muted-foreground">{t(`browse.filters.${state}`)}</span> : null}
              </button>
            );
          }
          case 'sort': {
            const current = (value[filter.id] as SortValue | undefined) ??
              filter.default ?? { value: filter.options[0]?.value ?? '', ascending: false };
            return (
              <div key={filter.id} className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{filter.label}</span>
                <div className="flex gap-2">
                  <Select
                    className="min-w-0 flex-1"
                    aria-label={filter.label}
                    value={current.value}
                    onChange={(event) => set(filter.id, { value: event.target.value, ascending: current.ascending })}
                  >
                    {filter.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="secondary"
                    size="icon"
                    aria-label={current.ascending ? t('browse.filters.ascending') : t('browse.filters.descending')}
                    title={current.ascending ? t('browse.filters.ascending') : t('browse.filters.descending')}
                    onClick={() => set(filter.id, { value: current.value, ascending: !current.ascending })}
                  >
                    <ArrowDownUp className="size-4" strokeWidth={1.75} aria-hidden />
                  </Button>
                </div>
              </div>
            );
          }
          case 'group':
            return (
              <fieldset key={filter.id} className="flex flex-col gap-2">
                <legend className="pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                  {filter.label}
                </legend>
                <FilterList filters={filter.filters} value={value} set={set} />
              </fieldset>
            );
        }
      })}
    </>
  );
}
