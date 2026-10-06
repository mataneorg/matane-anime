import { createFileRoute } from '@tanstack/react-router';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@renderer/components/EmptyState';

export const Route = createFileRoute('/_app/updates')({ component: UpdatesPage });

function UpdatesPage() {
  const { t } = useTranslation();
  return <EmptyState icon={RefreshCw} title={t('empty.updates.title')} description={t('empty.updates.description')} />;
}
