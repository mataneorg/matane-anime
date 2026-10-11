import type { Filter, FilterState, SortValue } from '@matane-anime/extension-sdk';
import { ArrowDown, ArrowUp, Check, Minus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { type Field, appliedItems } from './filterState';

/** The filters that are on, as chips that can be taken off one by one, so the list never looks "short" without a reason. */
export function AppliedFilters({
  filters,
  value,
  onRemove,
  onClear,
}: {
  filters: readonly Filter[];
  value: FilterState;
  onRemove: (id: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const items = appliedItems(filters, value);
  if (items.length === 0) return null;

  const describe = (field: Field, raw: unknown): { text: string; icon?: 'include' | 'exclude' | 'up' | 'down' } => {
    switch (field.type) {
      case 'text':
        return { text: `${field.label}: ${String(raw)}` };
      case 'select': {
        const option = field.options.find((candidate) => candidate.value === raw);
        return { text: `${field.label}: ${option?.label ?? (raw === '' ? t('browse.filters.any') : String(raw))}` };
      }
      case 'checkbox':
        return { text: raw === true ? field.label : t('browse.filters.off', { label: field.label }) };
      case 'tristate':
        return { text: field.label, icon: raw === 'exclude' ? 'exclude' : 'include' };
      case 'sort': {
        const sort = raw as SortValue;
        const option = field.options.find((candidate) => candidate.value === sort.value);
        return { text: `${field.label}: ${option?.label ?? sort.value}`, icon: sort.ascending ? 'up' : 'down' };
      }
    }
  };

  return (
    <div role="group" aria-label={t('browse.filters.applied')} className="flex flex-wrap items-center gap-2">
      {items.map(({ field, value: raw }) => {
        const { text, icon } = describe(field, raw);
        const excluded = icon === 'exclude';
        return (
          <Badge key={field.id} variant={excluded ? 'danger' : 'primary'} className="h-6 gap-1.5 pr-1 pl-2">
            {icon === 'include' ? <Check aria-hidden /> : null}
            {excluded ? <Minus aria-hidden /> : null}
            {icon === 'up' ? <ArrowUp aria-hidden /> : null}
            {icon === 'down' ? <ArrowDown aria-hidden /> : null}
            <span className={excluded ? 'line-through decoration-1' : undefined}>{text}</span>
            {excluded ? <span className="sr-only">, {t('browse.filters.exclude')}</span> : null}
            <button
              type="button"
              aria-label={t('browse.filters.remove', { label: field.label })}
              title={t('browse.filters.remove', { label: field.label })}
              onClick={() => onRemove(field.id)}
              className="flex size-4 items-center justify-center rounded-sm hover:bg-foreground/10"
            >
              <X className="size-3" aria-hidden />
            </button>
          </Badge>
        );
      })}
      <Button variant="ghost" size="sm" onClick={onClear}>
        {t('browse.filters.clearAll')}
      </Button>
    </div>
  );
}
