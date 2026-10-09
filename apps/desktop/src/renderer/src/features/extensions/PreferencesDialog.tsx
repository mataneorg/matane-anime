import type { Preference } from '@matane-anime/extension-sdk';
import type { ExtensionInfo } from '@matane-anime/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorState } from '@renderer/components/ErrorState';
import { Dialog, DialogContent } from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import { Select } from '@renderer/components/ui/select';
import { Switch } from '@renderer/components/ui/switch';
import { call } from '@renderer/lib/api';
import { preferencesQuery } from '@renderer/lib/catalog';

/** The settings an extension declares, as a form the app builds for it (docs/PRD.md EXT-13). */
export function PreferencesDialog({
  extension,
  open,
  onOpenChange,
}: {
  extension: ExtensionInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`${extension.name} · ${t('extensions.preferences')}`}
        description={t('extensions.preferencesHint')}
        closeLabel={t('common.close')}
      >
        {open ? <Form extension={extension} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function Form({ extension }: { extension: ExtensionInfo }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const state = useQuery(preferencesQuery(extension.id));
  const save = useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      call('extensions.setPreference', { extensionId: extension.id, key, value }),
    onSuccess: (next) => {
      queryClient.setQueryData(preferencesQuery(extension.id).queryKey, next);
      // What the extension returns depends on its preferences, so what was fetched with the old ones is stale.
      void queryClient.invalidateQueries({ queryKey: ['browse'] });
    },
  });

  if (state.isPending) {
    return (
      <div role="status" className="flex justify-center p-8">
        <Loader2
          className="size-5 animate-spin text-primary-text"
          strokeWidth={1.75}
          aria-label={t('extensions.preferencesLoading')}
        />
      </div>
    );
  }
  if (state.isError) return <ErrorState compact error={state.error} onRetry={() => void state.refetch()} />;
  const { preferences, values } = state.data;
  if (preferences.length === 0) {
    return <p className="p-6 text-center text-muted-foreground">{t('extensions.noPreferences')}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="-my-4 divide-y">
        {preferences.map((preference) => (
          <li key={preference.key} className="py-4">
            <Field
              preference={preference}
              value={values[preference.key]}
              onSave={(value) => save.mutate({ key: preference.key, value })}
            />
          </li>
        ))}
      </ul>
      {save.isError ? <ErrorState compact error={save.error} /> : null}
    </div>
  );
}

function Field({
  preference,
  value,
  onSave,
}: {
  preference: Preference;
  value: unknown;
  onSave: (value: unknown) => void;
}) {
  const id = `pref-${preference.key}`;
  const label = (
    <>
      <label htmlFor={id} className="block font-medium">
        {preference.label}
      </label>
      {preference.description ? (
        <div className="text-xs leading-4 text-muted-foreground">{preference.description}</div>
      ) : null}
    </>
  );
  switch (preference.type) {
    case 'switch':
      return (
        <div className="flex items-center gap-4">
          <div className="flex-1">{label}</div>
          <Switch id={id} checked={value === true} onCheckedChange={onSave} />
        </div>
      );
    case 'text':
      return (
        <div className="flex flex-col gap-1.5">
          {label}
          <TextField id={id} value={typeof value === 'string' ? value : ''} onCommit={onSave} />
        </div>
      );
    case 'select':
      return (
        <div className="flex flex-col gap-1.5">
          {label}
          <Select
            id={id}
            value={typeof value === 'string' ? value : preference.default}
            onChange={(event) => onSave(event.target.value)}
          >
            {preference.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
      );
    case 'multiselect': {
      const selected = Array.isArray(value) ? (value as string[]) : preference.default;
      return (
        <fieldset className="flex flex-col gap-2">
          <legend className="pb-1">{label}</legend>
          {preference.options.map((option) => (
            <label key={option.value} className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={selected.includes(option.value)}
                onChange={(event) =>
                  onSave(
                    event.target.checked
                      ? [...selected, option.value]
                      : selected.filter((item) => item !== option.value),
                  )
                }
              />
              {option.label}
            </label>
          ))}
        </fieldset>
      );
    }
  }
}

/** Saves when the field loses focus or Enter is pressed, not on every key. */
function TextField({ id, value, onCommit }: { id: string; value: string; onCommit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const commit = (): void => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <Input
      id={id}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => event.key === 'Enter' && commit()}
    />
  );
}
