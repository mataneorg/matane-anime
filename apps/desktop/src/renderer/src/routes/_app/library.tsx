import { LIBRARY_SORTS, type LibraryQuery, type LibrarySort } from '@matane-anime/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { Check, Info, ListFilter, Package, Plus, Search, SquareCheckBig, Trash2, X } from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@renderer/components/EmptyState';
import { Button, buttonVariants } from '@renderer/components/ui/button';
import { Dialog, DialogContent } from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import { Select } from '@renderer/components/ui/select';
import { CategoryDialog } from '@renderer/features/library/CategoryDialog';
import { LibraryGrid } from '@renderer/features/library/LibraryGrid';
import { call } from '@renderer/lib/api';
import { sourcesQuery } from '@renderer/lib/catalog';
import { categoriesQuery, libraryCountQuery, libraryQuery } from '@renderer/lib/library';
import { usePersistedState } from '@renderer/lib/storage';
import { cn } from '@renderer/lib/utils';

export const Route = createFileRoute('/_app/library')({ component: LibraryPage });

const STATUSES = ['ongoing', 'completed', 'hiatus', 'cancelled', 'unknown'] as const;
const STEPS = ['add', 'install', 'watch'] as const;

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function LibraryPage() {
  const { t } = useTranslation();
  const { data: count } = useQuery(libraryCountQuery);
  const { data: categories = [] } = useQuery(categoriesQuery);
  const { data: sources = [] } = useQuery(sourcesQuery);

  const [sort, setSort] = usePersistedState<LibrarySort>('matane-anime.librarySort', 'lastWatched', LIBRARY_SORTS);
  const [tab, setTab] = useState<'all' | number>('all');
  const [draft, setDraft] = useState('');
  const search = useDebounced(draft.trim(), 200);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [unwatchedOnly, setUnwatchedOnly] = useState(false);
  const [startedOnly, setStartedOnly] = useState(false);
  const [status, setStatus] = useState<(typeof STATUSES)[number] | ''>('');
  const [sourceId, setSourceId] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [moving, setMoving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [creating, setCreating] = useState(false);

  // Only what the user switched on is sent: the query is also the cache key.
  const query = useMemo<LibraryQuery>(
    () => ({
      sort,
      ...(tab !== 'all' && { category: tab }),
      ...(search && { search }),
      ...(unwatchedOnly && { unwatchedOnly: true }),
      ...(startedOnly && { startedOnly: true }),
      ...(status && { status }),
      ...(sourceId && { sourceId }),
    }),
    [sort, tab, search, unwatchedOnly, startedOnly, status, sourceId],
  );
  const list = useQuery(libraryQuery(query));
  const items = list.data ?? [];
  const filtered = search !== '' || unwatchedOnly || startedOnly || status !== '' || sourceId !== '';
  const activeFilters = Number(unwatchedOnly) + Number(startedOnly) + Number(status !== '') + Number(sourceId !== '');

  const markWatched = useMutation({
    mutationFn: () => call('library.markWatched', { animeIds: [...selected], watched: true }),
  });
  const move = useMutation({
    mutationFn: (categoryIds: number[]) => call('library.setCategories', { animeIds: [...selected], categoryIds }),
  });
  const remove = useMutation({
    mutationFn: async () => {
      for (const animeId of selected) await call('library.remove', { animeId });
    },
  });

  const stopSelecting = (): void => {
    setSelecting(false);
    setSelected(new Set());
  };
  const toggle = (animeId: number): void =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(animeId)) next.add(animeId);
      return next;
    });
  const resetFilters = (): void => {
    setUnwatchedOnly(false);
    setStartedOnly(false);
    setStatus('');
    setSourceId('');
  };

  if (count === 0 && !filtered && tab === 'all') return <LibraryEmpty />;

  return (
    <div className="flex min-h-full flex-col gap-4 p-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl leading-8 font-bold tracking-tight">{t('nav.library')}</h1>
        <span className="rounded-full bg-card px-2 py-0.5 text-xs leading-4 font-medium">
          {t('empty.library.count', { count: count ?? 0 })}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              strokeWidth={1.75}
              aria-hidden
            />
            <Input
              type="search"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t('library.filter')}
              aria-label={t('library.filter')}
              className="h-10 w-56 pl-9"
            />
          </div>
          <Select
            aria-label={t('library.sortBy')}
            value={sort}
            onChange={(event) => setSort(event.target.value as LibrarySort)}
            className="h-10"
          >
            {LIBRARY_SORTS.map((name) => (
              <option key={name} value={name}>
                {t(`library.sort.${name}`)}
              </option>
            ))}
          </Select>
          <Button
            variant="secondary"
            size="icon"
            className="size-10"
            aria-pressed={filtersOpen}
            aria-label={t('library.filters')}
            title={t('library.filters')}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <ListFilter className="size-4" strokeWidth={1.75} aria-hidden />
            {activeFilters > 0 ? <span className="sr-only">{activeFilters}</span> : null}
          </Button>
          <Button
            variant={selecting ? 'default' : 'secondary'}
            size="md"
            className="h-10"
            aria-pressed={selecting}
            onClick={() => (selecting ? stopSelecting() : setSelecting(true))}
          >
            <SquareCheckBig className="size-4" strokeWidth={1.75} aria-hidden />
            {t('library.select')}
          </Button>
        </div>
      </header>

      <div role="tablist" aria-label={t('nav.library')} className="flex flex-wrap items-center gap-1 border-b">
        <TabButton active={tab === 'all'} onClick={() => setTab('all')} label={t('library.all')} count={count ?? 0} />
        {categories.map((category) => (
          <TabButton
            key={category.id}
            active={tab === category.id}
            onClick={() => setTab(category.id)}
            label={category.name}
            count={category.count}
          />
        ))}
        <button
          type="button"
          aria-label={t('library.addCategory')}
          title={t('library.addCategory')}
          onClick={() => setCreating(true)}
          className="mb-1 ml-1 flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-input/50"
        >
          <Plus className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
      </div>

      {filtersOpen ? (
        <div className="flex flex-wrap items-center gap-4 rounded-xl bg-card px-4 py-3">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-accent"
              checked={unwatchedOnly}
              onChange={(event) => setUnwatchedOnly(event.target.checked)}
            />
            {t('library.unwatchedOnly')}
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-accent"
              checked={startedOnly}
              onChange={(event) => setStartedOnly(event.target.checked)}
            />
            {t('library.startedOnly')}
          </label>
          <label className="flex items-center gap-2">
            {t('library.status')}
            <Select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
              <option value="">{t('browse.filters.any')}</option>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {value === 'unknown' ? t('library.statusUnknown') : t(`anime.status.${value}`)}
                </option>
              ))}
            </Select>
          </label>
          <label className="flex items-center gap-2">
            {t('library.source')}
            <Select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
              <option value="">{t('browse.filters.any')}</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </Select>
          </label>
          <Button variant="ghost" size="sm" onClick={resetFilters} disabled={activeFilters === 0}>
            {t('browse.filters.reset')}
          </Button>
        </div>
      ) : null}

      {list.isPending ? null : items.length === 0 ? (
        <EmptyState
          icon={Search}
          title={t(filtered ? 'library.noResults.title' : 'library.emptyCategory.title')}
          description={t(filtered ? 'library.noResults.description' : 'library.emptyCategory.description')}
        />
      ) : (
        <LibraryGrid items={items} selecting={selecting} selected={selected} onToggle={toggle} />
      )}

      {selecting ? (
        <div
          role="toolbar"
          aria-label={t('library.selection')}
          className="sticky bottom-4 z-20 mt-auto flex flex-wrap items-center gap-2 self-center rounded-2xl border bg-popover px-4 py-3 shadow-xl"
        >
          <span className="mr-2 font-semibold text-foreground">{t('library.selected', { count: selected.size })}</span>
          <Button variant="secondary" size="sm" disabled={selected.size === 0} onClick={() => setMoving(true)}>
            {t('library.moveToCategory')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={selected.size === 0 || markWatched.isPending}
            onClick={() => markWatched.mutate()}
          >
            <Check className="size-4" strokeWidth={1.75} aria-hidden />
            {t('library.markWatched')}
          </Button>
          <Button variant="secondary" size="sm" disabled title={t('anime.comingSoon')}>
            {t('anime.download')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="text-danger"
            disabled={selected.size === 0}
            onClick={() => setRemoving(true)}
          >
            <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
            {t('library.removeFromLibrary')}
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={t('common.cancel')} onClick={stopSelecting}>
            <X className="size-4" strokeWidth={1.75} aria-hidden />
          </Button>
        </div>
      ) : null}

      <CategoryDialog
        open={moving}
        onOpenChange={setMoving}
        title={t('library.moveToCategory')}
        confirmLabel={t('common.save')}
        initial={[]}
        onConfirm={(ids) => move.mutate(ids)}
      />
      <Dialog open={removing} onOpenChange={setRemoving}>
        <DialogContent
          title={t('library.removeTitle', { count: selected.size })}
          description={t('library.removeBody')}
          closeLabel={t('common.close')}
        >
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRemoving(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                remove.mutate();
                setRemoving(false);
                stopSelecting();
              }}
            >
              {t('library.removeFromLibrary')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <NewCategoryDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        '-mb-px flex h-10 items-center gap-1.5 border-b-2 border-transparent px-3 text-muted-foreground transition-colors hover:text-foreground',
        active && 'border-accent font-semibold text-foreground',
      )}
    >
      {label}
      <span className="font-mono text-xs leading-4">{count}</span>
    </button>
  );
}

function NewCategoryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: (value: string) => call('categories.create', { name: value }),
    onSuccess: () => {
      setName('');
      onOpenChange(false);
    },
  });
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (name.trim()) create.mutate(name);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('library.addCategory')} closeLabel={t('common.close')}>
        <form onSubmit={submit} className="flex gap-2">
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('library.newCategory')}
            aria-label={t('library.newCategory')}
            maxLength={50}
          />
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            {t('library.addCategory')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A library with nothing in it yet: how to get started (mockup 01b). */
function LibraryEmpty() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center gap-3 px-6 pt-6">
        <h1 className="text-2xl leading-8 font-bold tracking-tight">{t('nav.library')}</h1>
        <span className="rounded-full bg-card px-2 py-0.5 text-xs leading-4 font-medium">
          {t('empty.library.count', { count: 0 })}
        </span>
      </header>
      <div className="flex flex-1 flex-col">
        <EmptyState
          icon={Package}
          title={t('empty.library.title')}
          description={t('empty.library.description')}
          action={
            <div className="flex gap-2">
              <Link to="/browse/extensions" className={buttonVariants({ size: 'lg' })}>
                <Plus className="size-4" strokeWidth={1.75} aria-hidden />
                {t('empty.library.action')}
              </Link>
              <Link to="/browse/sources" className={buttonVariants({ size: 'lg', variant: 'secondary' })}>
                {t('empty.library.secondary')}
              </Link>
            </div>
          }
        >
          <ol className="grid w-full max-w-[720px] grid-cols-1 gap-3 text-left sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step} className="flex flex-col gap-2 rounded-xl bg-card p-4">
                <span className="flex size-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-on-accent">
                  {index + 1}
                </span>
                <h3 className="text-sm leading-5 font-semibold">{t(`empty.library.steps.${step}.title`)}</h3>
                <p className="text-xs leading-4">{t(`empty.library.steps.${step}.body`)}</p>
              </li>
            ))}
          </ol>
          <p className="flex items-center gap-2 text-xs leading-4">
            <Info className="size-3.5 shrink-0 text-info" strokeWidth={1.75} aria-hidden />
            {t('empty.library.notice')}
          </p>
        </EmptyState>
      </div>
    </div>
  );
}
