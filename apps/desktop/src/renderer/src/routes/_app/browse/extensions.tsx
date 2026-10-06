import { createFileRoute } from '@tanstack/react-router';
import { Package } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@renderer/components/EmptyState';

export const Route = createFileRoute('/_app/browse/extensions')({ component: ExtensionsPage });

function ExtensionsPage() {
  const { t } = useTranslation();
  return (
    <EmptyState icon={Package} title={t('empty.extensions.title')} description={t('empty.extensions.description')} />
  );
}
