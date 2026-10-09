import type { Category } from '@matane-anime/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import { call } from '@renderer/lib/api';
import { categoriesQuery } from '@renderer/lib/library';
import { UpdateChecksSettings } from './UpdateChecksSettings';

/** Settings → Library (mockup 10d): update checks, automatic downloads and the categories. */
export function LibrarySettings() {
  const { t } = useTranslation();
  const { data: categories = [] } = useQuery(categoriesQuery);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [deleting, setDeleting] = useState<Category | null>(null);

  const create = useMutation({
    mutationFn: (value: string) => call('categories.create', { name: value }),
    onSuccess: () => setName(''),
  });
  const rename = useMutation({
    mutationFn: (input: { id: number; name: string }) => call('categories.rename', input),
    onSuccess: () => setEditing(null),
  });
  const remove = useMutation({ mutationFn: (id: number) => call('categories.delete', { id }) });
  const reorder = useMutation({ mutationFn: (ids: number[]) => call('categories.reorder', { ids }) });

  const move = (index: number, delta: number): void => {
    const ids = categories.map((category) => category.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target] as number, ids[index] as number];
    reorder.mutate(ids);
  };
  const submitNew = (event: FormEvent): void => {
    event.preventDefault();
    if (name.trim()) create.mutate(name);
  };
  const submitRename = (event: FormEvent): void => {
    event.preventDefault();
    if (editing !== null && draft.trim()) rename.mutate({ id: editing, name: draft });
  };

  return (
    <div className="flex max-w-[880px] flex-col gap-6">
      <UpdateChecksSettings />

      <section className="flex flex-col gap-4 rounded-xl border bg-card/40 p-5" aria-labelledby="categories-title">
        <div className="flex items-center justify-between gap-4">
          <h2 id="categories-title" className="text-sm font-semibold">
            {t('settings.library.categories')}
          </h2>
        </div>
        <p className="text-muted-foreground">{t('settings.library.categoriesHint')}</p>
        <form onSubmit={submitNew} className="flex max-w-md gap-2">
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
        <ul className="flex flex-col gap-2">
          {categories.map((category, index) => (
            <li key={category.id} className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2">
              {editing === category.id ? (
                <form onSubmit={submitRename} className="flex flex-1 gap-2">
                  <Input
                    autoFocus
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    aria-label={t('settings.library.nameField')}
                    maxLength={50}
                    className="h-8"
                  />
                  <Button type="submit" size="sm" disabled={!draft.trim()}>
                    {t('common.save')}
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                    {t('common.cancel')}
                  </Button>
                </form>
              ) : (
                <>
                  <span className="flex-1 font-semibold text-foreground">{category.name}</span>
                  <span className="mr-2 font-mono text-xs leading-4">{category.count}</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('settings.library.moveUp', { name: category.name })}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp className="size-4" strokeWidth={1.75} aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('settings.library.moveDown', { name: category.name })}
                    disabled={index === categories.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown className="size-4" strokeWidth={1.75} aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('settings.library.rename', { name: category.name })}
                    onClick={() => {
                      setEditing(category.id);
                      setDraft(category.name);
                    }}
                  >
                    <Pencil className="size-4" strokeWidth={1.75} aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('settings.library.delete', { name: category.name })}
                    onClick={() => setDeleting(category)}
                  >
                    <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent
          title={t('settings.library.deleteTitle', { name: deleting?.name ?? '' })}
          description={t('settings.library.deleteBody')}
          closeLabel={t('common.close')}
        >
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleting) remove.mutate(deleting.id);
                setDeleting(null);
              }}
            >
              {t('settings.library.delete', { name: deleting?.name ?? '' })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
