import { createFileRoute } from '@tanstack/react-router';
import { Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@renderer/components/EmptyState';

export const Route = createFileRoute('/_app/browse/sources')({ component: SourcesPage });

function SourcesPage() {
  const { t } = useTranslation();
  return <EmptyState icon={Globe} title={t('empty.sources.title')} description={t('empty.sources.description')} />;
}
