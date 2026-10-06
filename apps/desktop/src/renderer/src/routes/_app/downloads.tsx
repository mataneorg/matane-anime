import { createFileRoute } from '@tanstack/react-router';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@renderer/components/EmptyState';

export const Route = createFileRoute('/_app/downloads')({ component: DownloadsPage });

function DownloadsPage() {
  const { t } = useTranslation();
  return (
    <EmptyState icon={Download} title={t('empty.downloads.title')} description={t('empty.downloads.description')} />
  );
}
