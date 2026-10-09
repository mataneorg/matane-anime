import type { Preference } from '@matane-anime/extension-sdk';
import type { ExtensionInfo } from '@matane-anime/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent } from '@renderer/components/ui/dialog';
import { Input } from '@renderer/components/ui/input';
import { Select } from '@renderer/components/ui/select';
import { Switch } from '@renderer/components/ui/switch';
import { call } from '@renderer/lib/api';
import { preferencesQuery } from '@renderer/lib/catalog';
import { describeError } from '@renderer/lib/errors';

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
      <DialogContent title={`${extension.name} · ${t('extensions.preferences')}`} closeLabel={t('extensions.save')}>
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

  if (state.isPending) return <p>…</p>;
  if (state.isError) return <p role="alert">{describeError(state.error, t)}</p>;
  const { preferences, values } = state.data;
  if (preferences.length === 0) return <p>{t('extensions.noPreferences')}</p>;

  return (
    <div className="flex flex-col gap-5">
      {preferences.map((preference) => (
        <Field
          key={preference.key}
          preference={preference}
          value={values[preference.key]}
          onSave={(value) => save.mutate({ key: preference.key, value })}
        />
      ))}
      {save.isError ? (
        <p role="alert" className="text-xs leading-4 text-danger-text">
          {describeError(save.error, t)}
        </p>
      ) : null}
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
