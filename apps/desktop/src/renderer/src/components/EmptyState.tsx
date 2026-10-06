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
    <div className="flex h-full min-h-80 flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-card">
        <Icon className="size-7" strokeWidth={1.75} aria-hidden />
      </div>
      <div className="flex max-w-lg flex-col gap-2">
        <h2 className="text-2xl leading-8 font-bold tracking-tight">{title}</h2>
        <p>{description}</p>
      </div>
      {action}
      {children}
    </div>
  );
}
