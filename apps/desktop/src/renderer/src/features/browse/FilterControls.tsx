import type { TriState } from '@matane-anime/extension-sdk';
import { Check, Minus } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { m, transition } from '@renderer/lib/motion';
import { cn } from '@renderer/lib/utils';

/** The small controls the filter panel is made of. Each is one tab stop that carries its own state in text, not colour. */

const chip =
  'inline-flex h-8 max-w-full items-center gap-1.5 rounded-lg border px-2.5 text-xs transition-colors [&_svg]:size-3.5 [&_svg]:shrink-0';
const chipIdle = 'border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground';
const chipOn = 'border-primary/40 bg-primary/15 font-medium text-primary-text';
const chipOff = 'border-destructive/40 bg-destructive/10 text-danger-text';

export interface Choice {
  value: string;
  label: string;
  icon?: ReactNode;
}

/** How a single choice is drawn: a segmented bar for two or three short options, chips up to eight, else a list. */
export function choiceLayout(options: readonly Choice[]): 'segmented' | 'chips' | 'list' {
  if (options.length <= 3 && options.reduce((sum, option) => sum + option.label.length, 0) <= 26) return 'segmented';
  return options.length <= 8 ? 'chips' : 'list';
}

/** A single choice as a radio group: arrow keys move it, one tab stop, the chosen option also shows a check or a thumb. */
export function ChoiceGroup({
  label,
  options,
  value,
  onChange,
  layout,
  disabled = false,
}: {
  label: string;
  options: readonly Choice[];
  value: string;
  onChange: (value: string) => void;
  layout: 'segmented' | 'chips';
  disabled?: boolean;
}) {
  const thumbId = useId();
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = options[(index + step + options.length) % options.length];
    if (next === undefined) return;
    onChange(next.value);
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    buttons?.[options.indexOf(next)]?.focus();
  };
  // Nothing chosen (a value the list does not know) still leaves the first option reachable by Tab.
  const stop = options.some((option) => option.value === value) ? value : options[0]?.value;
  const segmented = layout === 'segmented';

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={cn(
        disabled && 'opacity-50',
        segmented ? 'grid auto-cols-fr grid-flow-col rounded-lg border bg-background p-1' : 'flex flex-wrap gap-1.5',
      )}
    >
      {options.map((option, index) => {
        const chosen = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={chosen}
            disabled={disabled}
            tabIndex={option.value === stop ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => move(event, index)}
            className={cn(
              segmented
                ? 'relative isolate flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs transition-colors [&_svg]:size-3.5 [&_svg]:shrink-0'
                : cn(chip, chosen ? chipOn : chipIdle),
              segmented &&
                (chosen ? 'font-semibold text-primary-foreground' : 'text-muted-foreground hover:text-foreground'),
            )}
          >
            {segmented && chosen ? (
              <m.span
                layoutId={thumbId}
                transition={transition.layout}
                aria-hidden
                className="absolute inset-0 -z-10 rounded-md bg-primary"
              />
            ) : null}
            {!segmented && chosen ? <Check strokeWidth={2.5} aria-hidden /> : option.icon}
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** A boolean filter inside a group: a chip that is pressed or not. */
export function CheckChip({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(chip, checked ? chipOn : chipIdle)}
    >
      {checked ? <Check strokeWidth={2.5} aria-hidden /> : null}
      <span className="truncate">{label}</span>
    </button>
  );
}

/**
 * Include, exclude or ignore: one click cycles it. The state is an icon and a word for screen readers, and an excluded
 * label is struck through, so colour is never the only signal.
 */
export function TriChip({
  label,
  state,
  onChange,
}: {
  label: string;
  state: TriState | undefined;
  onChange: (next: TriState | undefined) => void;
}) {
  const { t } = useTranslation();
  const next = state === 'include' ? 'exclude' : state === 'exclude' ? undefined : 'include';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === 'include' ? true : state === 'exclude' ? 'mixed' : false}
      title={state ? t(`browse.filters.${state}`) : undefined}
      onClick={() => onChange(next)}
      className={cn(chip, state === 'include' ? chipOn : state === 'exclude' ? chipOff : chipIdle)}
    >
      {state === 'include' ? <Check strokeWidth={2.5} aria-hidden /> : null}
      {state === 'exclude' ? <Minus strokeWidth={2.5} aria-hidden /> : null}
      <span className={cn('truncate', state === 'exclude' && 'line-through decoration-1')}>{label}</span>
      {state ? <span className="sr-only">, {t(`browse.filters.${state}`)}</span> : null}
    </button>
  );
}
