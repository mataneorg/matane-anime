import { createFileRoute } from '@tanstack/react-router';
import { Film } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@renderer/components/EmptyState';

export const Route = createFileRoute('/_app/anime/$animeId')({ component: AnimePage });

function AnimePage() {
  const { t } = useTranslation();
  return <EmptyState icon={Film} title={t('empty.anime.title')} description={t('empty.anime.description')} />;
}
