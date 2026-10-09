import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** Every list has an empty state: an icon, one line of explanation, and (optionally) one action. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  /** Extra content under the action, e.g. the library's three first steps. */
  children?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-80 flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-muted text-primary-text">
        <Icon className="size-7" strokeWidth={1.75} aria-hidden />
      </div>
      <div className="flex max-w-sm flex-col gap-1.5">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-muted-foreground">{description}</p>
      </div>
      {action}
      {children}
    </div>
  );
}
