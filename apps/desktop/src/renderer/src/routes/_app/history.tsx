import { createFileRoute } from '@tanstack/react-router';
import { History } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@renderer/components/EmptyState';

export const Route = createFileRoute('/_app/history')({ component: HistoryPage });

function HistoryPage() {
  const { t } = useTranslation();
  return <EmptyState icon={History} title={t('empty.history.title')} description={t('empty.history.description')} />;
}
