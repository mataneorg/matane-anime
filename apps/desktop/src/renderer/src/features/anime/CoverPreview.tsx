import { useTranslation } from 'react-i18next';
import { Cover } from '@renderer/components/Cover';
import { Dialog, DialogContent } from '@renderer/components/ui/dialog';

/** The cover at full size, from the anime page's cover button. */
export function CoverPreview({
  title,
  sourceId,
  url,
  localAnimeId,
  open,
  onOpenChange,
}: {
  title: string;
  sourceId: string;
  url: string | null;
  localAnimeId?: number | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} closeLabel={t('common.close')} className="w-[min(480px,calc(100vw-48px))]">
        <Cover
          sourceId={sourceId}
          url={url}
          localAnimeId={localAnimeId}
          className="mx-auto aspect-[2/3] max-h-[70vh] rounded-lg border"
        />
      </DialogContent>
    </Dialog>
  );
}
