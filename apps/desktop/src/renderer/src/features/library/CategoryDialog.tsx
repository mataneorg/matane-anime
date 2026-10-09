import { useMutation, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import { call } from '@renderer/lib/api';
import { categoriesQuery } from '@renderer/lib/library';

/** Choose the categories of one or more anime (any number, or none), and make a new one on the spot (LIB-1). */
export function CategoryDialog({
  open,
  onOpenChange,
  title,
  confirmLabel,
  initial,
  onConfirm,
  onRemove,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  confirmLabel: string;
  initial: number[];
  onConfirm: (categoryIds: number[]) => void;
  /** Offered when the anime is already in the library. */
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} closeLabel={t('common.close')}>
        {open ? (
          <Form
            initial={initial}
            confirmLabel={confirmLabel}
            onConfirm={onConfirm}
            onRemove={onRemove}
            close={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Form({
  initial,
  confirmLabel,
  onConfirm,
  onRemove,
  close,
}: {
  initial: number[];
  confirmLabel: string;
  onConfirm: (ids: number[]) => void;
  onRemove: (() => void) | undefined;
  close: () => void;
}) {
  const { t } = useTranslation();
  const { data: categories = [] } = useQuery(categoriesQuery);
  const [selected, setSelected] = useState<number[]>(initial);
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: (value: string) => call('categories.create', { name: value }),
    onSuccess: (category) => {
      setSelected((ids) => [...ids, category.id]);
      setName('');
    },
  });
  const toggle = (id: number): void =>
    setSelected((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  const submitNew = (event: FormEvent): void => {
    event.preventDefault();
    if (name.trim()) create.mutate(name);
  };

  return (
    <div className="flex flex-col gap-4">
      {categories.length === 0 ? <p className="text-muted-foreground">{t('library.noCategories')}</p> : null}
      <ul className="flex flex-col gap-1">
        {categories.map((category) => (
          <li key={category.id}>
            <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-accent">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={selected.includes(category.id)}
                onChange={() => toggle(category.id)}
              />
              <span className="flex-1">{category.name}</span>
              <span className="font-mono text-xs leading-4 text-muted-foreground">{category.count}</span>
            </label>
          </li>
        ))}
      </ul>
      <form onSubmit={submitNew} className="flex gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('library.newCategory')}
          aria-label={t('library.newCategory')}
          maxLength={50}
        />
        <Button type="submit" variant="secondary" disabled={!name.trim() || create.isPending}>
          <Plus className="size-4" strokeWidth={1.75} aria-hidden />
          {t('library.addCategory')}
        </Button>
      </form>
      <DialogFooter className="justify-between">
        {onRemove ? (
          <Button
            variant="ghost"
            className="text-danger-text"
            onClick={() => {
              onRemove();
              close();
            }}
          >
            {t('library.removeFromLibrary')}
          </Button>
        ) : (
          <span />
        )}
        <Button
          onClick={() => {
            onConfirm(selected);
            close();
          }}
        >
          {confirmLabel}
        </Button>
      </DialogFooter>
    </div>
  );
}
