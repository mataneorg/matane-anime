import { createFileRoute } from '@tanstack/react-router';
import { ScanSearch } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@renderer/components/EmptyState';

export const Route = createFileRoute('/_app/browse/global-search')({ component: GlobalSearchPage });

function GlobalSearchPage() {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={ScanSearch}
      title={t('empty.globalSearch.title')}
      description={t('empty.globalSearch.description')}
    />
  );
}
