import { Link, createFileRoute } from '@tanstack/react-router';
import { LibraryBig, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@renderer/components/EmptyState';
import { buttonVariants } from '@renderer/components/ui/button';

export const Route = createFileRoute('/_app/library')({ component: LibraryPage });

function LibraryPage() {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={LibraryBig}
      title={t('empty.library.title')}
      description={t('empty.library.description')}
      action={
        <Link to="/browse/extensions" className={buttonVariants({ size: 'lg' })}>
          <Plus className="size-4" strokeWidth={1.75} aria-hidden />
          {t('empty.library.action')}
        </Link>
      }
    />
  );
}
