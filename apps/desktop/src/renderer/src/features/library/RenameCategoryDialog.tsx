import type { Category } from '@matane-anime/shared';
import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/components/ui/button';
import { Dialog, DialogContent } from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import { call } from '@renderer/lib/api';

/** Renames the category of a library tab; a missing category means the dialog is closed. */
export function RenameCategoryDialog({ category, onClose }: { category: Category | null; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={category !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={t('contextMenu.library.renameTitle')} closeLabel={t('common.close')}>
        {category ? <Form category={category} close={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Form({ category, close }: { category: Category; close: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState(category.name);
  const rename = useMutation({
    mutationFn: (value: string) => call('categories.rename', { id: category.id, name: value }),
    onSuccess: close,
  });
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (name.trim()) rename.mutate(name);
  };
  return (
    <form onSubmit={submit} className="flex gap-2">
      <Input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        aria-label={t('settings.library.nameField')}
        maxLength={50}
      />
      <Button type="submit" disabled={!name.trim() || rename.isPending}>
        {t('common.save')}
      </Button>
    </form>
  );
}
