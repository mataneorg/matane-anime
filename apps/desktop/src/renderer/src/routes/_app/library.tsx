import { Link, createFileRoute } from '@tanstack/react-router';
import { Info, Package, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@renderer/components/EmptyState';
import { buttonVariants } from '@renderer/components/ui/button';

export const Route = createFileRoute('/_app/library')({ component: LibraryPage });

const STEPS = ['add', 'install', 'watch'] as const;

function LibraryPage() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center gap-3 px-6 pt-6">
        <h1 className="text-2xl leading-8 font-bold tracking-tight">{t('nav.library')}</h1>
        <span className="rounded-full bg-card px-2 py-0.5 text-xs leading-4 font-medium">
          {t('empty.library.count', { count: 0 })}
        </span>
      </header>
      <div className="flex flex-1 flex-col">
        <EmptyState
          icon={Package}
          title={t('empty.library.title')}
          description={t('empty.library.description')}
          action={
            <div className="flex gap-2">
              <Link to="/browse/extensions" className={buttonVariants({ size: 'lg' })}>
                <Plus className="size-4" strokeWidth={1.75} aria-hidden />
                {t('empty.library.action')}
              </Link>
              <Link to="/browse/sources" className={buttonVariants({ size: 'lg', variant: 'secondary' })}>
                {t('empty.library.secondary')}
              </Link>
            </div>
          }
        >
          <ol className="grid w-full max-w-[720px] grid-cols-1 gap-3 text-left sm:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step} className="flex flex-col gap-2 rounded-xl bg-card p-4">
                <span className="flex size-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-on-accent">
                  {index + 1}
                </span>
                <h3 className="text-sm leading-5 font-semibold">{t(`empty.library.steps.${step}.title`)}</h3>
                <p className="text-xs leading-4">{t(`empty.library.steps.${step}.body`)}</p>
              </li>
            ))}
          </ol>
          <p className="flex items-center gap-2 text-xs leading-4">
            <Info className="size-3.5 shrink-0 text-info" strokeWidth={1.75} aria-hidden />
            {t('empty.library.notice')}
          </p>
        </EmptyState>
      </div>
    </div>
  );
}
