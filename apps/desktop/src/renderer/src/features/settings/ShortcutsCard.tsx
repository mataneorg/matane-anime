import {
  DEFAULT_SHORTCUTS,
  PLAYER_ACTIONS,
  type PlayerAction,
  type ShortcutMap,
  eventToCombo,
  findConflict,
  formatCombo,
} from '@matane-anime/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@renderer/components/ui/button';
import { SettingsCard } from './parts';

const sameAsDefaults = (map: ShortcutMap): boolean =>
  PLAYER_ACTIONS.every((a) => map[a].join() === DEFAULT_SHORTCUTS[a].join());

/** The keyboard shortcuts of the player (docs/PRD.md PLY-3): key chips per action, Change records one combination. */
export function ShortcutsCard({
  shortcuts,
  onChange,
}: {
  shortcuts: ShortcutMap;
  onChange: (map: ShortcutMap) => void;
}) {
  const { t } = useTranslation();
  const [recording, setRecording] = useState<PlayerAction | null>(null);
  const [conflict, setConflict] = useState<{ combo: string; action: PlayerAction } | null>(null);
  const label = (action: PlayerAction): string => t(`settings.player.shortcuts.actions.${action}`);

  // While recording, the next key press is taken (Esc cancels); nothing else on the page sees it.
  useEffect(() => {
    if (!recording) return;
    const onKey = (event: KeyboardEvent): void => {
      const combo = eventToCombo(event);
      if (!combo) return;
      event.preventDefault();
      event.stopPropagation();
      setRecording(null);
      if (combo === 'Escape') return;
      const other = findConflict(shortcuts, recording, combo);
      if (other) setConflict({ combo, action: other });
      else onChange({ ...shortcuts, [recording]: [combo] });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, shortcuts, onChange]);

  return (
    <SettingsCard
      id="shortcuts-title"
      title={t('settings.player.shortcuts.title')}
      description={t('settings.player.shortcuts.hint')}
      actions={
        <Button
          variant="secondary"
          size="sm"
          data-testid="shortcuts-reset"
          disabled={sameAsDefaults(shortcuts)}
          onClick={() => {
            setRecording(null);
            setConflict(null);
            onChange(DEFAULT_SHORTCUTS);
          }}
        >
          {t('settings.player.shortcuts.reset')}
        </Button>
      }
    >
      {/* Two columns only when the card itself is wide enough (a container query, not the window width). */}
      <div className="@container">
        <ul className="grid grid-cols-1 gap-x-8 @2xl:grid-cols-2">
          {PLAYER_ACTIONS.map((action) => (
            <li
              key={action}
              className="flex items-center justify-between gap-3 border-b py-2.5"
              data-testid={`shortcut-${action}`}
            >
              <span className="min-w-0">{label(action)}</span>
              <span className="flex shrink-0 items-center gap-1.5">
                {recording === action ? (
                  <span className="text-xs text-muted-foreground" role="status">
                    {t('settings.player.shortcuts.recording')}
                  </span>
                ) : (
                  shortcuts[action].map((combo) => (
                    <kbd
                      key={combo}
                      className="rounded-md border border-input px-2 py-0.5 font-mono text-xs leading-4 font-medium text-foreground"
                    >
                      {formatCombo(combo)}
                    </kbd>
                  ))
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-primary"
                  data-testid={`shortcut-change-${action}`}
                  aria-label={t('settings.player.shortcuts.changeAction', { action: label(action) })}
                  aria-pressed={recording === action}
                  onClick={() => {
                    setConflict(null);
                    setRecording(recording === action ? null : action);
                  }}
                >
                  {t('settings.player.shortcuts.change')}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      </div>
      {conflict ? (
        <p className="pt-3 text-xs leading-4 text-danger-text" role="alert" data-testid="shortcut-conflict">
          {t('settings.player.shortcuts.conflict', {
            combo: formatCombo(conflict.combo),
            action: label(conflict.action),
          })}
        </p>
      ) : null}
    </SettingsCard>
  );
}
