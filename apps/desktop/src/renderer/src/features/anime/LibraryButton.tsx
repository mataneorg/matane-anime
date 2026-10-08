import type { AnimeDetail } from '@matane-anime/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, Library } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/components/ui/button';
import { CategoryDialog } from '@renderer/features/library/CategoryDialog';
import { call } from '@renderer/lib/api';
import { categoriesQuery } from '@renderer/lib/library';

/** "Add to library" (choose categories), and once in it, the menu to change them or leave (mockup 02, LIB-1). */
export function LibraryButton({ anime }: { anime: AnimeDetail }) {
  const { t } = useTranslation();
  const { data: categories = [] } = useQuery(categoriesQuery);
  const [open, setOpen] = useState(false);
  const add = useMutation({
    mutationFn: (categoryIds: number[]) => call('library.add', { animeId: anime.animeId, categoryIds }),
  });
  const set = useMutation({
    mutationFn: (categoryIds: number[]) => call('library.setCategories', { animeIds: [anime.animeId], categoryIds }),
  });
  const remove = useMutation({ mutationFn: () => call('library.remove', { animeId: anime.animeId }) });

  const names = categories
    .filter((category) => anime.categoryIds.includes(category.id))
    .map((category) => category.name);

  return (
    <>
      <Button variant="secondary" size="lg" onClick={() => setOpen(true)} aria-haspopup="dialog">
        {anime.inLibrary ? (
          <Check className="size-4" strokeWidth={1.75} aria-hidden />
        ) : (
          <Library className="size-4" strokeWidth={1.75} aria-hidden />
        )}
        {anime.inLibrary
          ? `${t('anime.inLibrary')}${names.length > 0 ? ` · ${names.join(', ')}` : ''}`
          : t('anime.addToLibrary')}
      </Button>
      <CategoryDialog
        open={open}
        onOpenChange={setOpen}
        title={anime.inLibrary ? t('anime.inLibrary') : t('anime.addToLibrary')}
        confirmLabel={anime.inLibrary ? t('common.save') : t('anime.addToLibrary')}
        initial={anime.categoryIds}
        onConfirm={(ids) => (anime.inLibrary ? set.mutate(ids) : add.mutate(ids))}
        onRemove={anime.inLibrary ? () => remove.mutate() : undefined}
      />
    </>
  );
}
