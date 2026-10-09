import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/components/ui/button';
import { Dialog, DialogContent } from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import { call } from '@renderer/lib/api';

export function NewCategoryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: (value: string) => call('categories.create', { name: value }),
    onSuccess: () => {
      setName('');
      onOpenChange(false);
    },
  });
  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (name.trim()) create.mutate(name);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t('library.addCategory')} closeLabel={t('common.close')}>
        <form onSubmit={submit} className="flex gap-2">
          <Input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('library.newCategory')}
            aria-label={t('library.newCategory')}
            maxLength={50}
          />
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            {t('library.addCategory')}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
