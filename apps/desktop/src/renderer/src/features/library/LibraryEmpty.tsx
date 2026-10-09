import { Link } from '@tanstack/react-router';
import { Info, Package, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@renderer/components/EmptyState';
import { buttonVariants } from '@renderer/components/ui/button';

const STEPS = ['add', 'install', 'watch'] as const;

/** A library with nothing in it yet: how to get started (mockup 01b). */
export function LibraryEmpty() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center gap-3 px-6 pt-5">
        <h1 className="flex items-center gap-3 text-xl font-semibold">
          {t('nav.library')}
          <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
            {t('empty.library.count', { count: 0 })}
          </span>
        </h1>
      </header>
      <div className="flex flex-1 flex-col">
        <EmptyState
          icon={Package}
          title={t('empty.library.title')}
          description={t('empty.library.description')}
          action={
            <div className="flex gap-2">
              <Link to="/browse/extensions" search={{ add: true }} className={buttonVariants({ size: 'lg' })}>
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
              <li key={step} className="flex flex-col gap-2 rounded-xl border bg-card/40 px-4 py-3.5">
                <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  {index + 1}
                </span>
                <h3 className="text-sm leading-5 font-semibold">{t(`empty.library.steps.${step}.title`)}</h3>
                <p className="text-xs leading-4">{t(`empty.library.steps.${step}.body`)}</p>
              </li>
            ))}
          </ol>
          <p className="flex items-center gap-2 text-xs leading-4">
            <Info className="size-3.5 shrink-0 text-ctp-blue" strokeWidth={1.75} aria-hidden />
            {t('empty.library.notice')}
          </p>
        </EmptyState>
      </div>
    </div>
  );
}
