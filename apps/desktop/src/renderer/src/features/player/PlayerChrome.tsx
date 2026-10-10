import type { EpisodeRow, PlaybackSession, StreamOption } from '@matane-anime/shared';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Info,
  ListVideo,
  Maximize,
  Minimize,
  Pause,
  Play,
  RefreshCw,
  Server,
  SkipBack,
  SkipForward,
  TriangleAlert,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { type PointerEvent as ReactPointerEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { episodesQuery } from '@renderer/lib/catalog';
import { cn } from '@renderer/lib/utils';
import { episodeTitle } from '@renderer/features/anime/EpisodeList';
import { type PlayerError, formatTime, usePlayerStore } from './store';

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const iconButton =
  'flex size-11 items-center justify-center rounded-full text-video-text transition-colors hover:bg-video-track/50 focus-visible:outline-2 focus-visible:outline-video-accent';

// ------------------------------------------------------------------ seek bar

/** A seek bar that shows what is buffered. Keys are handled by the player's shortcuts. */
export function SeekBar({ onSeek }: { onSeek: (seconds: number) => void }) {
  const { t } = useTranslation();
  const { currentTime, duration, bufferedEnd } = usePlayerStore();
  const bar = useRef<HTMLDivElement>(null);
  const pct = (value: number): number => (duration > 0 ? Math.min(100, (value / duration) * 100) : 0);

  const seekFrom = (event: ReactPointerEvent): void => {
    const rect = bar.current?.getBoundingClientRect();
    if (!rect || duration <= 0) return;
    onSeek(Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) * duration);
  };

  return (
    <div
      ref={bar}
      role="slider"
      tabIndex={0}
      aria-label={t('player.seek')}
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(currentTime)}
      aria-valuetext={`${formatTime(currentTime)} / ${formatTime(duration)}`}
      className="group relative flex h-5 min-w-0 flex-1 cursor-pointer items-center"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        seekFrom(event);
      }}
      onPointerMove={(event) => event.buttons === 1 && seekFrom(event)}
    >
      <div className="relative h-1 w-full rounded-full bg-video-track group-hover:h-1.5">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-video-buffered/60"
          style={{ width: `${pct(bufferedEnd)}%` }}
        />
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-video-accent"
          style={{ width: `${pct(currentTime)}%` }}
        />
        <div
          className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-video-accent"
          style={{ left: `${pct(currentTime)}%` }}
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ bars

export interface ChromeActions {
  togglePlay(): void;
  seek(seconds: number): void;
  setVolume(volume: number): void;
  toggleMute(): void;
  cycleSpeed(): void;
  toggleFullscreen(): void;
  goBack(): void;
  goTo(episodeId: number): void;
  togglePanel(panel: 'servers' | 'episodes'): void;
}

export function TopBar({
  session,
  actions,
  visible,
}: {
  session: PlaybackSession | null;
  actions: ChromeActions;
  visible: boolean;
}) {
  const { t } = useTranslation();
  const { fullscreen, panel } = usePlayerStore();
  const active = session?.streams[session.activeIndex];
  return (
    <div
      className={cn(
        'absolute inset-x-0 top-0 z-10 flex items-center gap-3 border-b border-video-track/60 bg-video-scrim px-4 py-2 transition-opacity',
        !visible && 'pointer-events-none opacity-0',
      )}
    >
      <button type="button" className={iconButton} aria-label={t('player.back')} onClick={actions.goBack}>
        <ArrowLeft className="size-5" strokeWidth={1.75} aria-hidden />
      </button>
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{session?.animeTitle ?? ''}</div>
        <div className="truncate text-xs text-video-muted">
          {session
            ? [
                session.episodeNumber !== null ? t('anime.episodeNumber', { number: session.episodeNumber }) : null,
                session.episodeName,
                session.sourceName,
              ]
                .filter(Boolean)
                .join(' · ')
            : ''}
        </div>
      </div>
      {session ? (
        <>
          <button
            type="button"
            aria-expanded={panel === 'servers'}
            onClick={() => actions.togglePanel('servers')}
            className="flex h-9 items-center gap-2 rounded-lg border border-video-track px-3 text-video-text hover:bg-video-track/50"
          >
            <Server className="size-4" strokeWidth={1.75} aria-hidden />
            <span>
              {active ? `${active.server}${active.quality ? ` · ${active.quality}p` : ''}` : t('player.servers')}
            </span>
            <ChevronDown className="size-4" strokeWidth={1.75} aria-hidden />
          </button>
          <button
            type="button"
            className={iconButton}
            aria-label={t('player.episodes')}
            aria-expanded={panel === 'episodes'}
            onClick={() => actions.togglePanel('episodes')}
          >
            <ListVideo className="size-5" strokeWidth={1.75} aria-hidden />
          </button>
        </>
      ) : null}
      <button
        type="button"
        className={iconButton}
        aria-label={fullscreen ? t('player.exitFullscreen') : t('player.fullscreen')}
        onClick={actions.toggleFullscreen}
      >
        {fullscreen ? (
          <Minimize className="size-5" strokeWidth={1.75} aria-hidden />
        ) : (
          <Maximize className="size-5" strokeWidth={1.75} aria-hidden />
        )}
      </button>
    </div>
  );
}

export function BottomBar({
  session,
  actions,
  visible,
  volume,
  muted,
  speed,
}: {
  session: PlaybackSession | null;
  actions: ChromeActions;
  visible: boolean;
  volume: number;
  muted: boolean;
  speed: number;
}) {
  const { t } = useTranslation();
  const { paused, currentTime, duration } = usePlayerStore();
  return (
    <div
      className={cn(
        'absolute inset-x-0 bottom-0 z-10 flex items-center gap-3 bg-video-scrim px-4 py-3 transition-opacity',
        !visible && 'pointer-events-none opacity-0',
      )}
    >
      <button
        type="button"
        className={cn(iconButton, 'disabled:opacity-40')}
        aria-label={t('player.previous')}
        disabled={!session?.previous}
        onClick={() => session?.previous && actions.goTo(session.previous.episodeId)}
      >
        <SkipBack className="size-5" strokeWidth={1.75} aria-hidden />
      </button>
      <button
        type="button"
        className="flex size-12 items-center justify-center rounded-full bg-video-accent text-video-on-accent hover:brightness-110"
        aria-label={paused ? t('player.play') : t('player.pause')}
        onClick={actions.togglePlay}
      >
        {paused ? (
          <Play className="size-5" strokeWidth={2} aria-hidden />
        ) : (
          <Pause className="size-5" strokeWidth={2} aria-hidden />
        )}
      </button>
      <button
        type="button"
        className={cn(iconButton, 'disabled:opacity-40')}
        aria-label={t('player.next')}
        disabled={!session?.next}
        onClick={() => session?.next && actions.goTo(session.next.episodeId)}
      >
        <SkipForward className="size-5" strokeWidth={1.75} aria-hidden />
      </button>

      <button
        type="button"
        className={iconButton}
        aria-label={muted ? t('player.unmute') : t('player.mute')}
        onClick={actions.toggleMute}
      >
        {muted || volume === 0 ? (
          <VolumeX className="size-5" strokeWidth={1.75} aria-hidden />
        ) : (
          <Volume2 className="size-5" strokeWidth={1.75} aria-hidden />
        )}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={muted ? 0 : volume}
        aria-label={t('player.volume')}
        onChange={(event) => actions.setVolume(Number(event.target.value))}
        className="h-1 w-24 shrink-0 accent-video-accent"
      />

      <SeekBar onSeek={actions.seek} />
      <span className="shrink-0 font-mono text-xs text-video-muted">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
      <button
        type="button"
        onClick={actions.cycleSpeed}
        aria-label={t('player.speed')}
        title={t('player.speed')}
        className="h-9 shrink-0 rounded-lg border border-video-track px-2 font-mono text-xs hover:bg-video-track/50"
      >
        {t('player.speedValue', { speed })}
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ panels

export function ServerMenu({ session, onPick }: { session: PlaybackSession; onPick: (index: number) => void }) {
  const { t } = useTranslation();
  const qualities = [
    ...new Set(session.streams.map((stream) => stream.quality).filter((q): q is number => q !== null)),
  ].sort((a, b) => b - a);
  const active = session.streams[session.activeIndex];
  /** The best-ranked stream with a quality: streams arrive in ranking order. */
  const firstWith = (quality: number): number | undefined =>
    session.streams.find((stream) => stream.quality === quality && stream.status !== 'failed')?.index;

  return (
    <div
      role="dialog"
      aria-label={t('player.servers')}
      className="absolute top-16 right-4 z-20 flex w-80 flex-col gap-4 rounded-xl border border-video-track bg-video-stage p-4 shadow-xl"
    >
      {qualities.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-[11px] font-semibold tracking-wider text-video-muted uppercase">{t('player.quality')}</h3>
          <div className="flex flex-wrap gap-2">
            {qualities.map((quality) => (
              <button
                key={quality}
                type="button"
                aria-pressed={active?.quality === quality}
                onClick={() => {
                  const index = firstWith(quality);
                  if (index !== undefined) onPick(index);
                }}
                className={cn(
                  'h-8 rounded-full border border-video-track px-3 text-xs',
                  active?.quality === quality && 'border-video-accent bg-video-accent text-video-on-accent',
                )}
              >
                {t('player.qualityValue', { quality })}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold tracking-wider text-video-muted uppercase">{t('player.server')}</h3>
        <ul role="radiogroup" className="flex flex-col gap-1">
          {session.streams.map((stream) => (
            <ServerRow key={stream.index} stream={stream} onPick={() => onPick(stream.index)} />
          ))}
        </ul>
      </div>
      <p className="flex gap-2 border-t border-video-track pt-3 text-xs text-video-muted">
        <Info className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
        {t('player.switchNote')}
      </p>
    </div>
  );
}

function ServerRow({ stream, onPick }: { stream: StreamOption; onPick: () => void }) {
  const { t } = useTranslation();
  const playing = stream.status === 'playing';
  return (
    <li>
      <button
        type="button"
        role="radio"
        aria-checked={playing}
        onClick={onPick}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-video-track/50',
          playing && 'bg-video-track/60',
        )}
      >
        <span
          className={cn(
            'flex size-4 items-center justify-center rounded-full border border-video-muted',
            playing && 'border-video-accent',
          )}
        >
          {playing ? <span className="size-2 rounded-full bg-video-accent" /> : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-semibold">{stream.server}</span>
          <span className="truncate text-xs text-video-muted">
            {[playing ? t('player.playingNow') : null, stream.quality ? `${stream.quality}p` : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
        {stream.status === 'failed' ? (
          <span className="flex items-center gap-1 text-xs text-ctp-peach">
            <TriangleAlert className="size-3" strokeWidth={1.75} aria-hidden />
            {t('player.failedEarlier')}
          </span>
        ) : stream.lastWorked ? (
          <span className="text-xs text-video-muted">{t('player.lastWorked')}</span>
        ) : null}
      </button>
    </li>
  );
}

export function EpisodePanel({
  animeId,
  currentId,
  onPick,
}: {
  animeId: number;
  currentId: number;
  onPick: (episodeId: number) => void;
}) {
  const { t } = useTranslation();
  const { data = [] } = useQuery(episodesQuery(animeId));
  return (
    <aside
      aria-label={t('player.episodes')}
      className="absolute top-16 right-4 bottom-24 z-20 flex w-80 flex-col rounded-xl border border-video-track bg-video-stage shadow-xl"
    >
      <h3 className="border-b border-video-track px-4 py-3 font-semibold">{t('anime.episodes')}</h3>
      <ul className="min-h-0 flex-1 overflow-y-auto p-2">
        {data.map((episode: EpisodeRow) => (
          <li key={episode.id}>
            <button
              type="button"
              aria-current={episode.id === currentId}
              onClick={() => onPick(episode.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-video-track/50',
                episode.id === currentId && 'bg-video-track/60 font-semibold',
              )}
            >
              <span className="min-w-0 flex-1 truncate">
                {episodeTitle(episode, (number) => t('anime.episodeNumber', { number }))}
              </span>
              {episode.variant ? <span className="text-xs text-video-muted">{episode.variant}</span> : null}
              {episode.id === currentId ? (
                <Check className="size-4 text-video-accent" strokeWidth={2} aria-hidden />
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

// ------------------------------------------------------------------ overlays

export function ErrorCard({
  error,
  onRetry,
  onSwitch,
  canSwitch,
}: {
  error: PlayerError;
  onRetry: () => void;
  onSwitch: () => void;
  canSwitch: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div role="alert" className="absolute inset-0 z-30 flex items-center justify-center bg-video-stage/80 p-6">
      <div className="flex w-full max-w-120 flex-col items-center gap-4 rounded-xl border border-video-track bg-video-stage p-8 text-center">
        <TriangleAlert className="size-9 text-ctp-peach" strokeWidth={1.5} aria-hidden />
        <h2 className="text-lg leading-6 font-semibold">{t(`player.error.${error.cause}.title`)}</h2>
        <p className="text-video-muted">{t(`player.error.${error.cause}.body`)}</p>
        {error.tried.length > 0 ? (
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-video-muted">
            {t('player.tried')}
            {error.tried.map((name) => (
              <span key={name} className="rounded bg-video-track px-2 py-0.5 font-mono text-video-text">
                {name}
              </span>
            ))}
          </div>
        ) : null}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-video-accent px-4 font-medium text-video-on-accent hover:brightness-110"
          >
            <RefreshCw className="size-4" strokeWidth={1.75} aria-hidden />
            {t('player.retry')}
          </button>
          {canSwitch ? (
            <button
              type="button"
              onClick={onSwitch}
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-video-text/40 px-4 font-medium hover:bg-video-track/50"
            >
              <Server className="size-4" strokeWidth={1.75} aria-hidden />
              {t('player.switchServer')}
            </button>
          ) : null}
        </div>
        <p className="font-mono text-xs text-video-muted">{error.detail}</p>
      </div>
    </div>
  );
}

export function AutoplayOverlay({
  label,
  seconds,
  onPlayNow,
  onCancel,
}: {
  label: string;
  seconds: number;
  onPlayNow: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className="absolute right-6 bottom-28 z-20 flex w-80 flex-col gap-3 rounded-xl border border-video-track bg-video-stage p-4 shadow-xl"
    >
      <div>
        <div className="text-xs text-video-muted">{t('player.nextEpisodeIn', { count: seconds })}</div>
        <div className="font-semibold">{t('anime.episodeNumber', { number: label })}</div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onPlayNow}
          className="h-9 flex-1 rounded-lg bg-video-accent font-medium text-video-on-accent hover:brightness-110"
        >
          {t('player.playNow')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-9 flex-1 rounded-lg border border-video-text/40 font-medium hover:bg-video-track/50"
        >
          {t('player.cancel')}
        </button>
      </div>
    </div>
  );
}

/** Shown while the extension is still finding the stream: the video stays hidden until there is an address. */
export function StreamLoading() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-label={t('player.resolving')}
      className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-6"
    >
      <div className="relative flex size-24 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-video-accent/25 motion-reduce:animate-none" />
        <span
          className="absolute inset-3 animate-ping rounded-full bg-video-accent/25 motion-reduce:animate-none"
          style={{ animationDelay: '0.5s' }}
        />
        <span className="relative flex size-14 items-center justify-center rounded-full bg-video-scrim ring-2 ring-video-accent/60">
          <Play className="size-6 animate-pulse fill-video-accent text-video-accent" aria-hidden />
        </span>
      </div>
      <p className="flex items-end gap-1 text-sm text-video-muted">
        {t('player.resolving')}
        <span className="mb-1.5 flex gap-0.5" aria-hidden>
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="size-1 animate-bounce rounded-full bg-video-muted motion-reduce:animate-none"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </span>
      </p>
    </div>
  );
}

export function Toast({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="absolute top-20 left-1/2 z-20 -translate-x-1/2 rounded-full bg-video-scrim px-4 py-2 text-video-text shadow-lg"
    >
      {message}
    </div>
  );
}
