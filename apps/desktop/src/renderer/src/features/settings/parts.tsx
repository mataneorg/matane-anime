import type { ReactNode } from 'react';
import { cn } from '@renderer/lib/utils';

// Building blocks shared by the Settings sections: a titled card and a labelled row.

/** A titled group of settings: `rounded-xl border bg-card/40 p-5`, rows divided by hairlines. */
export function SettingsCard({
  id,
  title,
  description,
  actions,
  children,
  className,
}: {
  /** Id of the heading, for the section's accessible name. */
  id: string;
  title: string;
  description?: ReactNode;
  /** Controls at the right of the heading. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn('rounded-xl border bg-card/40 p-5', className)}>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 id={id} className="text-sm font-semibold">
            {title}
          </h2>
          {description ? <div className="mt-1 text-xs leading-4 text-muted-foreground">{description}</div> : null}
        </div>
        {actions}
      </div>
      <div className="flex flex-col divide-y">{children}</div>
    </section>
  );
}

/** One setting: label and hint on the left, the control on the right (or under them when `stacked`). */
export function SettingRow({
  label,
  hint,
  htmlFor,
  stacked = false,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  /** Id of the control, so the label names it. */
  htmlFor?: string;
  /** The control goes under the label (wide controls in a narrow column). */
  stacked?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex gap-6 py-4 first:pt-0 last:pb-0',
        stacked ? 'flex-col gap-2.5' : 'items-center justify-between',
        className,
      )}
    >
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="block font-medium">
          {label}
        </label>
        {hint ? <div className="text-xs leading-4 text-muted-foreground">{hint}</div> : null}
      </div>
      <div className={cn(!stacked && 'shrink-0')}>{children}</div>
    </div>
  );
}
