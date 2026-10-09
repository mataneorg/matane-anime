import { cn } from '@renderer/lib/utils';

export function TabButton({
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
        '-mb-px flex h-9 shrink-0 items-center gap-2 border-b-2 border-transparent px-2 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-offset-[-2px]',
        active && 'border-primary font-semibold text-foreground',
      )}
    >
      <span className="max-w-48 truncate">{label}</span>
      <span
        className={cn(
          'rounded-md bg-muted px-1.5 text-[11px] font-medium text-foreground',
          active && 'bg-primary/20 text-primary-text',
        )}
      >
        {count}
      </span>
    </button>
  );
}
