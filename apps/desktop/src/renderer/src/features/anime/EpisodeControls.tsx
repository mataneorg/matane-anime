import { EPISODE_SORTS, type EpisodeRow, type EpisodeSortOrder } from '@matane-anime/shared';
import { ArrowDownUp, Check, Search } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { menuContentClass, menuItemClass } from '@renderer/components/ui/dropdown-menu';
import { cn } from '@renderer/lib/utils';

export type EpisodeSort = EpisodeSortOrder;
const SORTS = EPISODE_SORTS;

/** The row whose episode number is closest to `number`, or null when no episode has one. */
export function nearestEpisodeIndex(episodes: readonly EpisodeRow[], number: number): number | null {
  let best: number | null = null;
  let distance = Infinity;
  episodes.forEach((episode, index) => {
    if (episode.number === null) return;
    const away = Math.abs(episode.number - number);
    if (away < distance) {
      distance = away;
      best = index;
    }
  });
  return best;
}

/** "Jump to episode": type a number, Enter scrolls the list to it. */
export function JumpBox({ onJump }: { onJump: (number: number) => void }) {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const number = Number.parseFloat(value);
    if (Number.isFinite(number)) onJump(number);
  };
  return (
    <form onSubmit={submit} className="relative w-36" role="search">
      <Search
        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        strokeWidth={1.75}
        aria-hidden
      />
      <Input
        inputMode="decimal"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={t('anime.jump')}
        aria-label={t('anime.jump')}
        className="h-8 pl-8 text-xs"
      />
    </form>
  );
}

/** Newest or oldest first, as a menu (the trigger names the current choice). */
export function EpisodeSortMenu({ sort, onSort }: { sort: EpisodeSort; onSort: (sort: EpisodeSort) => void }) {
  const { t } = useTranslation();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="secondary" size="sm">
          <ArrowDownUp aria-hidden />
          {t(`anime.sort.${sort}`)}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className={cn(menuContentClass, 'min-w-44')}>
          <DropdownMenu.RadioGroup
            value={sort}
            onValueChange={(value) => {
              const next = SORTS.find((name) => name === value);
              if (next) onSort(next);
            }}
          >
            {SORTS.map((name) => (
              <DropdownMenu.RadioItem key={name} value={name} className={menuItemClass}>
                <span className="flex size-4 items-center justify-center">
                  <DropdownMenu.ItemIndicator>
                    <Check className="size-4 text-primary-text" aria-hidden />
                  </DropdownMenu.ItemIndicator>
                </span>
                {t(`anime.sort.${name}`)}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
