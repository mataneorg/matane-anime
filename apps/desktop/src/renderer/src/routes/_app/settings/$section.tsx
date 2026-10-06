import { Link, createFileRoute } from '@tanstack/react-router';
import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@renderer/components/EmptyState';
import { AdvancedSettings } from '@renderer/features/settings/AdvancedSettings';
import { GeneralSettings } from '@renderer/features/settings/GeneralSettings';

export const Route = createFileRoute('/_app/settings/$section')({ component: SettingsPage });

const SECTIONS = [
  'general',
  'library',
  'player',
  'downloads',
  'extensions',
  'network',
  'data',
  'advanced',
  'about',
] as const;

function SettingsPage() {
  const { t } = useTranslation();
  const { section } = Route.useParams();
  const active = (SECTIONS as readonly string[]).includes(section) ? section : 'general';

  return (
    <div className="flex min-h-full flex-wrap">
      <nav aria-label={t('settings.sectionsLabel')} className="flex w-50 shrink-0 flex-col gap-0.5 px-3 py-6">
        {SECTIONS.map((name) => (
          <Link
            key={name}
            to="/settings/$section"
            params={{ section: name }}
            className="flex h-8 items-center rounded-lg px-3 text-muted-foreground transition-colors hover:bg-input/50"
            activeProps={{ className: 'bg-accent/16 font-semibold text-foreground', 'aria-current': 'page' }}
          >
            {t(`settings.sections.${name}`)}
          </Link>
        ))}
      </nav>
      <div className="min-w-0 flex-1 basis-120 py-6 pr-8 pl-3">
        <h1 className="mb-6 text-2xl leading-8 font-bold tracking-tight">{t(`settings.sections.${active}`)}</h1>
        {active === 'general' ? (
          <GeneralSettings />
        ) : active === 'advanced' ? (
          <AdvancedSettings />
        ) : (
          <EmptyState
            icon={SlidersHorizontal}
            title={t('settings.unavailable.title')}
            description={t('settings.unavailable.description')}
          />
        )}
      </div>
    </div>
  );
}
