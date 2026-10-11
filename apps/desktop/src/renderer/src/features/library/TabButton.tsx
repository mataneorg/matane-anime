import type { Category } from '@matane-anime/shared';
import { ArrowLeft, ArrowRight, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@renderer/components/ui/context-menu';
import { cn } from '@renderer/lib/utils';
import type { TabMenuAction } from './menu';

/** What a category tab's right-click menu needs: the category, where it sits among the others, and what to do. */
export interface TabMenu {
  category: Category;
  first: boolean;
  last: boolean;
  onAction: (action: TabMenuAction) => void;
}

export function TabButton({
  active,
  onClick,
  label,
  count,
  menu,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  /** Only the tabs of real categories have a menu ("All" and "Default" do not). */
  menu?: TabMenu;
}) {
  const { t } = useTranslation();
  const button = (
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
  if (!menu) return button;

  const { category, first, last, onAction } = menu;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{button}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => onAction('rename')}>
          <Pencil aria-hidden />
          {t('contextMenu.library.rename')}
        </ContextMenuItem>
        {/* The mark has a third state (excluded) that only Settings sets; here the box is on when it is included. */}
        <ContextMenuCheckboxItem
          checked={category.autoDownload === 'include'}
          onSelect={() => onAction('autoDownload')}
        >
          {t('contextMenu.library.autoDownload')}
        </ContextMenuCheckboxItem>
        <ContextMenuItem disabled={first} onSelect={() => onAction('moveLeft')}>
          <ArrowLeft aria-hidden />
          {t('contextMenu.library.moveLeft')}
        </ContextMenuItem>
        <ContextMenuItem disabled={last} onSelect={() => onAction('moveRight')}>
          <ArrowRight aria-hidden />
          {t('contextMenu.library.moveRight')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem destructive onSelect={() => onAction('delete')}>
          <Trash2 aria-hidden />
          {t('contextMenu.library.deleteCategory')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
