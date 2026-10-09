import { COVER_SIZE, LIBRARY_DISPLAYS, type LibraryDisplay } from '@matane-anime/shared';
import { Grid2x2, Grid3x3, Image, List, type LucideIcon, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Segmented } from '@renderer/components/ui/segmented';

const DISPLAY_ICONS: Record<LibraryDisplay, LucideIcon> = {
  comfortable: Grid2x2,
  compact: Grid3x3,
  cover: Image,
  list: List,
};

/** The display-mode switch and the cover size slider, shared by the library and the lists of Browse. */
export function CoverViewControls({
  display,
  coverSize,
  onChange,
}: {
  display: LibraryDisplay;
  coverSize: number;
  onChange: (patch: { display?: LibraryDisplay; coverSize?: number }) => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Segmented
        icons
        label={t('library.display.label')}
        options={LIBRARY_DISPLAYS}
        value={display}
        onChange={(mode) => onChange({ display: mode })}
        optionLabel={(mode) => t(`library.display.${mode}`)}
        format={(mode) => {
          const Icon = DISPLAY_ICONS[mode];
          return <Icon className="size-4" aria-hidden />;
        }}
      />
      {display !== 'list' ? (
        <CoverSizeSlider value={coverSize} onChange={(next) => onChange({ coverSize: next })} />
      ) : null}
    </>
  );
}

/** Idle time after the last key step before the size is saved (a held key steps every ~30 ms). */
const SAVE_DELAY_MS = 200;

/**
 * Follows the pointer or keys on its own and saves once they settle: on release for a drag, after a short pause
 * for keys. Steps build on what the slider shows, not on whatever the last save has reached.
 */
function CoverSizeSlider({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { t } = useTranslation();
  // What the slider shows while a change is on its way to being saved; null follows the saved value.
  const [local, setLocal] = useState<number | null>(null);
  if (local !== null && local === value) setLocal(null);
  const pending = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dragging = useRef(false);
  const save = useRef(onChange);
  const saved = useRef(value);
  useEffect(() => {
    save.current = onChange;
    saved.current = value;
  });

  const flush = (): void => {
    clearTimeout(timer.current);
    dragging.current = false;
    const next = pending.current;
    pending.current = null;
    if (next !== null && next !== saved.current) save.current(next);
  };
  // Leaving the page mid-drag still saves what was chosen.
  useEffect(() => flush, []);

  const step = (next: number): void => {
    setLocal(next);
    pending.current = next;
    clearTimeout(timer.current);
    if (!dragging.current) timer.current = setTimeout(flush, SAVE_DELAY_MS);
  };
  return (
    <label className="flex h-8 items-center gap-2 rounded-lg border px-2 text-muted-foreground">
      <ZoomOut className="size-3.5" aria-hidden />
      <input
        type="range"
        min={COVER_SIZE.min}
        max={COVER_SIZE.max}
        step={COVER_SIZE.step}
        value={local ?? value}
        aria-label={t('library.coverSize')}
        onChange={(event) => step(Number(event.target.value))}
        onPointerDown={() => (dragging.current = true)}
        onPointerUp={flush}
        onBlur={flush}
        className="w-24 accent-primary"
      />
      <ZoomIn className="size-3.5" aria-hidden />
    </label>
  );
}
