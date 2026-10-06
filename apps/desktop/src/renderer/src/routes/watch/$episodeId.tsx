import { Link, createFileRoute } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// Outside `_app`: the player is full screen, with no title bar or sidebar of the shell (docs/PRD.md PLY-1).
export const Route = createFileRoute('/watch/$episodeId')({ component: WatchPage });

function WatchPage() {
  const { t } = useTranslation();
  return (
    <div className="relative flex h-full flex-col items-center justify-center gap-2 bg-video-stage text-video-text">
      <Link
        to="/library"
        aria-label={t('titleBar.back')}
        className="absolute top-3 left-4 flex size-11 items-center justify-center rounded-full hover:bg-video-track/50"
      >
        <ArrowLeft className="size-5" strokeWidth={1.75} aria-hidden />
      </Link>
      <h1 className="text-lg font-semibold">{t('empty.watch.title')}</h1>
      <p className="text-video-muted">{t('empty.watch.description')}</p>
    </div>
  );
}
