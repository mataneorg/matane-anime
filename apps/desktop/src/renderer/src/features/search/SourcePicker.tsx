import type { SourceInfo } from '@matane-anime/shared';
import { Layers } from 'lucide-react';
import { Popover } from 'radix-ui';
import { useTranslation } from 'react-i18next';
import { FilterToggle } from '@renderer/features/library/FilterToggle';
import { toggleIn } from '@renderer/features/library/filters';
import { Button } from '@renderer/components/ui/button';
import { cn } from '@renderer/lib/utils';

/**
 * Which sources a global search asks. `selected` null means every source; picking one narrows it to a list,
 * and unticking the last one (or "All sources") goes back to every source.
 */
export function SourcePicker({
  sources,
  selected,
  onChange,
}: {
  sources: Pick<SourceInfo, 'id' | 'name' | 'lang'>[];
  selected: string[] | null;
  onChange: (sourceIds: string[] | null) => void;
}) {
  const { t } = useTranslation();
  const chosen = selected === null ? null : sources.filter((source) => selected.includes(source.id));
  const all = chosen === null || chosen.length === 0;
  const toggle = (id: string): void => {
    const next = toggleIn(all ? sources.map((source) => source.id) : (selected ?? []), id);
    onChange(next.length === 0 || next.length === sources.length ? null : next);
  };
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button variant="secondary" size="sm" className={cn(!all && 'border-primary text-primary-text')}>
          <Layers aria-hidden />
          {all ? t('globalSearch.sourcesAll') : t('globalSearch.sourcesCustom', { count: chosen.length })}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={8}
          className="z-50 flex max-h-(--radix-popover-content-available-height) w-72 flex-col gap-1 overflow-y-auto rounded-lg border bg-popover p-2 text-popover-foreground shadow-xl"
        >
          <FilterToggle on={all} onClick={() => onChange(null)}>
            {t('globalSearch.sourcesAll')}
          </FilterToggle>
          {sources.map((source) => (
            <FilterToggle
              key={source.id}
              on={all || (chosen?.some((candidate) => candidate.id === source.id) ?? false)}
              onClick={() => toggle(source.id)}
            >
              <span className="flex min-w-0 items-center justify-between gap-2">
                <span className="truncate">{source.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{source.lang.toUpperCase()}</span>
              </span>
            </FilterToggle>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
