import type { Filter, FilterState, FilterValue, SortValue } from '@matane-anime/extension-sdk';
import { ArrowDown, ArrowUp, ChevronDown, Loader2, X } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorState } from '@renderer/components/ErrorState';
import { Badge } from '@renderer/components/ui/badge';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Select } from '@renderer/components/ui/select';
import { Skeleton } from '@renderer/components/ui/skeleton';
import { Switch } from '@renderer/components/ui/switch';
import { AnimatePresence, collapse, m, slideInRight } from '@renderer/lib/motion';
import { cn } from '@renderer/lib/utils';
import { CheckChip, type Choice, ChoiceGroup, TriChip, choiceLayout } from './FilterControls';
import { countActive, countIn, isSet, resolve, sameFilters } from './filterState';

type Setter = (id: string, next: FilterValue | undefined) => void;

interface PanelProps {
  filters: Filter[];
  /** The filters of the source are still loading, failed, or are here. */
  status: 'pending' | 'error' | 'ready';
  error?: unknown;
  onRetry: () => void;
  /** What the panel holds: edited, not yet applied. */
  value: FilterState;
  /** What the listing is showing now (the address), to tell whether there is anything to apply. */
  applied: FilterState;
  /** Narrow window: the panel floats over the list instead of taking a column of its own. */
  overlay: boolean;
  /** The list is being fetched with the applied filters. */
  busy: boolean;
  onChange: (next: FilterState) => void;
  onApply: () => void;
  onReset: () => void;
  onClose: () => void;
}

const sectionTitle = 'text-[11px] font-semibold tracking-wider text-muted-foreground uppercase';
/** A run of chips longer than this folds behind "Show all". */
const CHIP_LIMIT = 12;

/**
 * The filters an extension declares, drawn without the extension knowing anything about the UI (EXT-14). A column
 * beside the list on a wide window, a drawer over it on a narrow one; either way it slides in from the right edge.
 */
export function FilterPanel({
  filters,
  status,
  error,
  onRetry,
  value,
  applied,
  overlay,
  busy,
  onChange,
  onApply,
  onReset,
  onClose,
}: PanelProps) {
  const { t } = useTranslation();
  const panel = useRef<HTMLDivElement>(null);
  // Opening the panel moves the keyboard into it; closing is handed back to the toggle by the page.
  useEffect(() => panel.current?.focus({ preventScroll: true }), []);

  const set: Setter = (id, next) => {
    const copy = { ...value };
    if (next === undefined) delete copy[id];
    else copy[id] = next;
    onChange(copy);
  };

  const ready = status === 'ready';
  const draftCount = countActive(filters, value);
  const appliedCount = countActive(filters, applied);
  const dirty = ready && !sameFilters(filters, value, applied);
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (dirty) onApply();
  };

  return (
    <m.aside
      aria-label={t('browse.filters.title')}
      variants={slideInRight}
      initial="hidden"
      animate="visible"
      exit="hidden"
      // In a drawer the aside takes no room (w-0); the panel hangs off its right edge and stays put while the list scrolls.
      className={cn('sticky top-0 z-20 h-[calc(100vh-2.5rem)] shrink-0 self-start', overlay ? 'w-0' : 'w-80')}
    >
      <div
        ref={panel}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
        }}
        className={cn(
          'flex h-full w-80 max-w-[100vw] flex-col border-l bg-sidebar outline-none',
          overlay && 'absolute top-0 right-0 shadow-2xl',
        )}
      >
        <div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <h2 className="text-sm font-semibold">{t('browse.filters.title')}</h2>
          {appliedCount > 0 ? (
            <Badge variant="primary" title={t('browse.filters.active', { count: appliedCount })}>
              {appliedCount}
            </Badge>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto"
            aria-label={t('browse.filters.close')}
            title={t('browse.filters.close')}
            onClick={onClose}
          >
            <X aria-hidden />
          </Button>
        </div>

        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-4 py-4">
            {status === 'pending' ? (
              <div role="status" aria-label={t('browse.filters.loading')} className="flex flex-col gap-5">
                {[0, 1, 2].map((row) => (
                  <div key={row} className="flex flex-col gap-2">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-9 w-full rounded-lg" />
                  </div>
                ))}
              </div>
            ) : status === 'error' ? (
              <ErrorState compact error={error} title={t('browse.filters.loadFailed')} onRetry={onRetry} />
            ) : filters.length === 0 ? (
              <p className="rounded-xl border border-dashed p-4 text-center text-muted-foreground">
                {t('browse.filters.none')}
              </p>
            ) : (
              <FilterList filters={filters} value={value} set={set} />
            )}
          </div>

          <div className="flex shrink-0 flex-col gap-2.5 border-t px-4 py-3">
            <p role="status" className="flex min-h-4 items-center gap-2 text-xs text-muted-foreground">
              {dirty ? (
                <>
                  <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                  <span className="text-foreground">{t('browse.filters.unapplied')}</span>
                </>
              ) : busy ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  {t('browse.refreshing')}
                </>
              ) : appliedCount > 0 ? (
                t('browse.filters.active', { count: appliedCount })
              ) : ready ? (
                t('browse.filters.noneSet')
              ) : null}
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                disabled={!ready || (draftCount === 0 && appliedCount === 0)}
                onClick={onReset}
              >
                {t('browse.filters.reset')}
              </Button>
              <Button type="submit" className="flex-1" disabled={!dirty}>
                {t('browse.filters.apply')}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </m.aside>
  );
}

function FilterList({
  filters,
  value,
  set,
  more,
}: {
  filters: readonly Filter[];
  value: FilterState;
  set: Setter;
  /** Inside a group: long runs of chips fold, and this says whether they are open. */
  more?: { open: boolean; toggle: () => void };
}) {
  const { t } = useTranslation();
  const nodes: ReactNode[] = [];
  // Tri-state filters (and the checkboxes of a group) are short labels: they sit together as one block of chips.
  let chips: { node: ReactNode; on: boolean }[] = [];
  const flush = (key: string): void => {
    if (chips.length === 0) return;
    const folds = more !== undefined && chips.length > CHIP_LIMIT;
    // A folded run still shows what is on, so nothing selected hides behind the button.
    const shown = folds && !more.open ? chips.filter((chip, index) => index < CHIP_LIMIT || chip.on) : chips;
    nodes.push(
      <div key={key} className="flex flex-wrap gap-1.5">
        {shown.map((chip) => chip.node)}
        {folds ? (
          <Button variant="ghost" size="sm" aria-expanded={more.open} onClick={more.toggle}>
            {more.open ? t('browse.filters.showFewer') : t('browse.filters.showAll', { count: chips.length })}
          </Button>
        ) : null}
      </div>,
    );
    chips = [];
  };

  filters.forEach((filter, index) => {
    if (filter.type === 'tristate') {
      const state = resolve(filter, value);
      chips.push({
        on: state !== undefined,
        node: (
          <TriChip
            key={filter.id}
            label={filter.label}
            state={state === 'include' || state === 'exclude' ? state : undefined}
            onChange={(next) => set(filter.id, next)}
          />
        ),
      });
      return;
    }
    if (filter.type === 'checkbox' && more) {
      chips.push({
        on: isSet(filter, value),
        node: (
          <CheckChip
            key={filter.id}
            label={filter.label}
            checked={resolve(filter, value) === true}
            onChange={(checked) => set(filter.id, checked)}
          />
        ),
      });
      return;
    }
    flush(`chips-${index}`);
    switch (filter.type) {
      case 'header':
        nodes.push(
          <h3 key={`header-${index}`} className={cn(sectionTitle, index > 0 && 'mt-1 border-t pt-4')}>
            {filter.label}
          </h3>,
        );
        break;
      case 'separator':
        // A title that follows draws its own rule.
        if (filters[index + 1]?.type !== 'header')
          nodes.push(<hr key={`separator-${index}`} className="border-border" />);
        break;
      case 'text':
        nodes.push(<TextField key={filter.id} filter={filter} value={value} set={set} />);
        break;
      case 'select':
        nodes.push(<SelectField key={filter.id} filter={filter} value={value} set={set} />);
        break;
      case 'checkbox':
        nodes.push(<SwitchField key={filter.id} filter={filter} value={value} set={set} />);
        break;
      case 'sort':
        nodes.push(<SortField key={filter.id} filter={filter} value={value} set={set} />);
        break;
      case 'group':
        nodes.push(<GroupSection key={filter.id} filter={filter} value={value} set={set} />);
        break;
    }
  });
  flush('chips-end');

  // One line of help where a click cycles three states, so nobody has to find out by trial.
  if (more && filters.some((filter) => filter.type === 'tristate')) {
    nodes.unshift(
      <p key="hint" className="text-xs text-muted-foreground">
        {t('browse.filters.tristateHint')}
      </p>,
    );
  }
  return <>{nodes}</>;
}

type Of<T extends Filter['type']> = Extract<Filter, { type: T }>;
interface FieldProps<T extends Filter['type']> {
  filter: Of<T>;
  value: FilterState;
  set: Setter;
}

/** A label above its control, with a dot once the user has set it. */
function Field({
  label,
  htmlFor,
  on,
  children,
}: {
  label: string;
  htmlFor?: string;
  on: boolean;
  children: ReactNode;
}) {
  const text = (
    <>
      {label}
      {on ? <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden /> : null}
    </>
  );
  const style = 'flex items-center gap-1.5 text-xs font-medium text-muted-foreground';
  return (
    <div className="flex flex-col gap-2">
      {htmlFor ? (
        <label htmlFor={htmlFor} className={style}>
          {text}
        </label>
      ) : (
        // The control names itself (a radio group); this is the same text for sighted users.
        <span aria-hidden className={style}>
          {text}
        </span>
      )}
      {children}
    </div>
  );
}

function TextField({ filter, value, set }: FieldProps<'text'>) {
  const { t } = useTranslation();
  const id = useId();
  const text = resolve(filter, value) as string;
  return (
    <Field label={filter.label} htmlFor={id} on={isSet(filter, value)}>
      <div className="relative">
        <Input
          id={id}
          value={text}
          placeholder={filter.placeholder}
          onChange={(event) => set(filter.id, event.target.value)}
          className={text !== '' ? 'pr-9' : undefined}
        />
        {text !== '' ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute top-1 right-1"
            aria-label={t('browse.filters.clearField', { label: filter.label })}
            title={t('browse.filters.clearField', { label: filter.label })}
            onClick={() => set(filter.id, undefined)}
          >
            <X aria-hidden />
          </Button>
        ) : null}
      </div>
    </Field>
  );
}

/** The options of a select, with "Any" in front when the extension gave no way to leave it unset. */
function withAny(options: readonly Choice[], label: string, unset: boolean): Choice[] {
  return unset && !options.some((option) => option.value === '') ? [{ value: '', label }, ...options] : [...options];
}

function SelectField({ filter, value, set }: FieldProps<'select'>) {
  const { t } = useTranslation();
  const id = useId();
  const current = resolve(filter, value) as string;
  const options = withAny(filter.options, t('browse.filters.any'), filter.default === undefined);
  const layout = choiceLayout(options);
  return (
    <Field label={filter.label} htmlFor={layout === 'list' ? id : undefined} on={isSet(filter, value)}>
      {layout === 'list' ? (
        <Select id={id} className="w-full" value={current} onChange={(event) => set(filter.id, event.target.value)}>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      ) : (
        <ChoiceGroup
          label={filter.label}
          options={options}
          value={current}
          layout={layout}
          onChange={(next) => set(filter.id, next)}
        />
      )}
    </Field>
  );
}

function SwitchField({ filter, value, set }: FieldProps<'checkbox'>) {
  const id = useId();
  return (
    <div className="flex min-h-9 items-center justify-between gap-3">
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        {filter.label}
      </label>
      <Switch id={id} checked={resolve(filter, value) === true} onCheckedChange={(next) => set(filter.id, next)} />
    </div>
  );
}

function SortField({ filter, value, set }: FieldProps<'sort'>) {
  const { t } = useTranslation();
  const id = useId();
  // Without a default there is a way to leave the order to the source.
  const current = resolve(filter, value) as SortValue | undefined;
  const options = withAny(filter.options, t('browse.filters.defaultOrder'), filter.default === undefined);
  const layout = choiceLayout(options);
  const choose = (next: string): void =>
    set(filter.id, next === '' ? undefined : { value: next, ascending: current?.ascending ?? false });
  const direction = [
    { value: 'descending', label: t('browse.filters.descending'), icon: <ArrowDown aria-hidden /> },
    { value: 'ascending', label: t('browse.filters.ascending'), icon: <ArrowUp aria-hidden /> },
  ];
  return (
    <Field label={filter.label} htmlFor={layout === 'list' ? id : undefined} on={isSet(filter, value)}>
      {layout === 'list' ? (
        <Select
          id={id}
          className="w-full"
          value={current?.value ?? ''}
          onChange={(event) => choose(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      ) : (
        <ChoiceGroup
          label={filter.label}
          options={options}
          value={current?.value ?? ''}
          layout={layout}
          onChange={choose}
        />
      )}
      <ChoiceGroup
        label={t('browse.filters.direction')}
        options={direction}
        value={current ? (current.ascending ? 'ascending' : 'descending') : ''}
        layout="segmented"
        disabled={current === undefined}
        onChange={(next) => current && set(filter.id, { value: current.value, ascending: next === 'ascending' })}
      />
    </Field>
  );
}

/** A titled group (genres, say) that folds away; its count shows what is on inside while it is shut. */
function GroupSection({ filter, value, set }: FieldProps<'group'>) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const [all, setAll] = useState(false);
  const id = useId();
  const on = countIn(filter.filters, value);
  return (
    <section className="rounded-xl border bg-card/40">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((next) => !next)}
          className="flex min-h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-sm font-semibold"
        >
          <span className="min-w-0 flex-1 truncate">{filter.label}</span>
          {on > 0 ? (
            <Badge variant="primary">
              {on}
              <span className="sr-only">{t('browse.filters.active', { count: on })}</span>
            </Badge>
          ) : null}
          <ChevronDown
            className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
            aria-hidden
          />
        </button>
      </h3>
      <AnimatePresence initial={false}>
        {open ? (
          <m.div
            id={id}
            variants={collapse}
            initial="hidden"
            animate="visible"
            exit="hidden"
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-3 px-3 pt-1 pb-3">
              <FilterList
                filters={filter.filters}
                value={value}
                set={set}
                more={{ open: all, toggle: () => setAll((next) => !next) }}
              />
            </div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
