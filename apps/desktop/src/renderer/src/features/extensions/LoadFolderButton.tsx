import { useMutation } from '@tanstack/react-query';
import { FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/components/ui/button';
import { call } from '@renderer/lib/api';

/** Picks a folder and loads the extension in it (its `dist/` or `manifest.json` + `index.js`). */
export function LoadFolderButton({ variant = 'default' }: { variant?: 'default' | 'secondary' }) {
  const { t } = useTranslation();
  const load = useMutation({
    mutationFn: async () => {
      const folder = await call('dialog.pickFolder');
      return folder ? call('extensions.loadDevFolder', { folder }) : null;
    },
  });
  return (
    <Button variant={variant} onClick={() => load.mutate()} disabled={load.isPending}>
      <FolderOpen className="size-4" strokeWidth={1.75} aria-hidden />
      {t('extensions.loadFolder')}
    </Button>
  );
}
