import {
  AppError,
  DEFAULT_SHORTCUTS,
  type PlaybackSession,
  type ProgressReason,
  eventToCombo,
  resolveAction,
} from '@matane-anime/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IncognitoPill } from '@renderer/components/shell/IncognitoPill';
import { call } from '@renderer/lib/api';
import { settingsQuery, useUpdateSettings } from '@renderer/lib/ipc';
import { cn } from '@renderer/lib/utils';
import { attachStream, type FatalInfo } from './engine';
import {
  AutoplayOverlay,
  BottomBar,
  type ChromeActions,
  EpisodePanel,
  ErrorCard,
  SPEEDS,
  ServerMenu,
  StreamLoading,
  Toast,
  TopBar,
} from './PlayerChrome';
import { type PlayerError, usePlayerStore } from './store';

const HIDE_AFTER_MS = 3000;
const HEARTBEAT_MS = 5000;

/** Shows the controls and hides them again after 3 s without movement (PLY-7). Not a hook: its timer is plain state. */
function createRevealer() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    reveal() {
      usePlayerStore.getState().set({ controlsVisible: true });
      clearTimeout(timer);
      timer = setTimeout(() => {
        const now = usePlayerStore.getState();
        if (!now.paused && now.panel === 'none' && !now.error) now.set({ controlsVisible: false });
      }, HIDE_AFTER_MS);
    },
    stop() {
      clearTimeout(timer);
    },
  };
}

const causeOf = (info: FatalInfo): PlayerError['cause'] => {
  if (info.httpStatus === 403 || info.httpStatus === 410) return 'expired';
  if (info.message.startsWith('codec')) return 'codec';
  if (info.httpStatus !== null || /network|timeout/i.test(info.message)) return 'network';
  return 'generic';
};

/** The full-screen player (docs/PRD.md §6.3). Remount it with a `key` per episode. */
export function PlayerView({ episodeId }: { episodeId: number }) {
  const { t } = useTranslation();
  const router = useRouter();
  const navigate = useNavigate();
  const { data: settings } = useQuery(settingsQuery);
  const updateSettings = useUpdateSettings();
  const store = usePlayerStore();

  const container = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const position = useRef(0);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const [revealer] = useState(createRevealer);
  const revealControls = revealer.reveal;
  const [session, setSession] = useState<PlaybackSession | null>(null);
  const [startError, setStartError] = useState<AppError | null>(null);
  const [attempt, setAttempt] = useState(0);

  const volume = settings?.playerVolume ?? 1;
  const muted = settings?.playerMuted ?? false;
  const speed = settings?.playerSpeed ?? 1;
  const seekStep = settings?.playerSeekSeconds ?? 5;
  const autoplay = settings?.playerAutoplay ?? true;
  const countdownSeconds = settings?.playerAutoplayCountdown ?? 5;
  const shortcuts = settings?.playerShortcuts ?? DEFAULT_SHORTCUTS;

  const toast = useCallback((message: string) => {
    usePlayerStore.getState().set({ toast: message });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => usePlayerStore.getState().set({ toast: null }), 3500);
  }, []);

  // ------------------------------------------------------------------ opening and closing a playback
  useEffect(() => {
    let closed = false;
    let playbackId: string | null = null;
    const requestId = crypto.randomUUID();
    usePlayerStore.getState().reset();
    call('playback.start', { episodeId, requestId }).then(
      (opened) => {
        if (closed) void call('playback.close', { playbackId: opened.playbackId });
        else {
          playbackId = opened.playbackId;
          // Start where the episode was left (PRG-4). A retry keeps the position it already has.
          if (position.current === 0) position.current = opened.resumeMs / 1000;
          setSession(opened);
        }
      },
      (error: unknown) => {
        if (!closed) setStartError(error instanceof AppError ? error : new AppError('internal', String(error)));
      },
    );
    return () => {
      closed = true;
      void call('requests.cancel', requestId);
      if (playbackId) void call('playback.close', { playbackId });
      void call('playback.keepAwake', { enabled: false });
    };
  }, [episodeId, attempt]);

  // ------------------------------------------------------------------ attaching the stream
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);
  const url = session?.url;
  const playbackId = session?.playbackId;
  const kind = session?.kind;

  const handleFatal = useCallback(
    async (id: string, info: FatalInfo) => {
      const state = usePlayerStore.getState();
      state.set({ buffering: true });
      try {
        const update = await call('playback.event', {
          playbackId: id,
          event: { type: 'error', httpStatus: info.httpStatus, message: info.message },
        });
        if (update.type === 'switched') {
          setSession(update.session);
          const next = update.session.streams[update.session.activeIndex];
          toast(t('player.switching', { server: next?.server ?? '' }));
        } else if (update.type === 'failed') {
          usePlayerStore.getState().set({
            buffering: false,
            error: { cause: causeOf(info), detail: update.message, tried: update.tried },
          });
        }
      } catch (error) {
        usePlayerStore.getState().set({
          buffering: false,
          error: { cause: 'generic', detail: error instanceof Error ? error.message : String(error), tried: [] },
        });
      }
    },
    [t, toast],
  );

  useEffect(() => {
    const element = video.current;
    if (!element || !url || !playbackId || !kind) return;
    usePlayerStore.getState().set({ error: null, buffering: true, ended: false });
    const detach = attachStream(element, { url, kind }, position.current, {
      onPlaying: () => {
        void call('playback.keepAwake', { enabled: true });
        void call('playback.event', { playbackId, event: { type: 'playing' } });
      },
      onFatal: (info) => void handleFatal(playbackId, info),
    });
    // `load()` in the previous teardown reset these; the user's choices apply to every stream.
    element.volume = volume;
    element.muted = muted;
    element.defaultPlaybackRate = speed;
    element.playbackRate = speed;
    return detach;
    // Volume, mute and speed are applied by their own effect below; only a new stream re-attaches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, playbackId, kind, handleFatal]);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.volume = volume;
    element.muted = muted;
    element.defaultPlaybackRate = speed;
    element.playbackRate = speed;
  }, [volume, muted, speed]);

  // ------------------------------------------------------------------ what the video element tells us
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const set = usePlayerStore.getState().set;
    const buffered = (): number => {
      for (let i = 0; i < element.buffered.length; i++) {
        if (element.buffered.start(i) <= element.currentTime + 0.5 && element.buffered.end(i) >= element.currentTime)
          return element.buffered.end(i);
      }
      return element.currentTime;
    };
    const listeners: [string, () => void][] = [
      [
        'timeupdate',
        () => {
          position.current = element.currentTime;
          set({ currentTime: element.currentTime, bufferedEnd: buffered() });
        },
      ],
      ['progress', () => set({ bufferedEnd: buffered() })],
      ['durationchange', () => set({ duration: Number.isFinite(element.duration) ? element.duration : 0 })],
      ['play', () => set({ paused: false, ended: false })],
      ['pause', () => set({ paused: true })],
      ['waiting', () => set({ buffering: true })],
      ['playing', () => set({ buffering: false, paused: false })],
      ['canplay', () => set({ buffering: false })],
      ['seeking', () => set({ buffering: true })],
      ['seeked', () => set({ buffering: false })],
      ['ended', () => set({ ended: true, paused: true })],
    ];
    for (const [name, handler] of listeners) element.addEventListener(name, handler);
    const onFullscreen = (): void => set({ fullscreen: document.fullscreenElement !== null });
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      for (const [name, handler] of listeners) element.removeEventListener(name, handler);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, []);

  // ------------------------------------------------------------------ actions
  const goTo = useCallback(
    (id: number) => void navigate({ to: '/watch/$episodeId', params: { episodeId: String(id) }, replace: true }),
    [navigate],
  );
  const goBack = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    router.history.back();
  }, [router]);

  const actions: ChromeActions = {
    togglePlay: () => {
      const element = video.current;
      if (!element) return;
      if (element.paused) void element.play().catch(() => undefined);
      else element.pause();
    },
    seek: (seconds) => {
      const element = video.current;
      if (!element) return;
      const limit = Number.isFinite(element.duration) ? element.duration : seconds;
      element.currentTime = Math.min(Math.max(0, seconds), limit);
      position.current = element.currentTime;
    },
    setVolume: (next) =>
      updateSettings.mutate({ playerVolume: Math.min(1, Math.max(0, next)), playerMuted: next === 0 }),
    toggleMute: () => updateSettings.mutate({ playerMuted: !muted }),
    cycleSpeed: () => {
      const index = SPEEDS.indexOf(speed);
      updateSettings.mutate({ playerSpeed: SPEEDS[(index + 1) % SPEEDS.length] ?? 1 });
    },
    toggleFullscreen: () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void container.current?.requestFullscreen();
    },
    goBack,
    goTo,
    togglePanel: (panel) =>
      usePlayerStore.getState().set({ panel: usePlayerStore.getState().panel === panel ? 'none' : panel }),
  };
  const act = useRef(actions);
  useEffect(() => {
    act.current = actions;
  });

  const seekBy = (delta: number): void => act.current.seek((video.current?.currentTime ?? 0) + delta);
  const settingsRef = useRef({ volume, muted, speed, seekStep, shortcuts });
  useEffect(() => {
    settingsRef.current = { volume, muted, speed, seekStep, shortcuts };
  }, [volume, muted, speed, seekStep, shortcuts]);

  // ------------------------------------------------------------------ progress (docs/PRD.md PRG-2, PRG-9)
  // Everything about what was watched is decided in main; this only reports where the video is.
  const report = useCallback((reason: ProgressReason) => {
    const element = video.current;
    const current = sessionRef.current;
    // Nothing is loaded (a stream is being replaced): a position of 0 would erase real progress.
    if (!element || !current || element.readyState === 0) return;
    void call('watch.progress', {
      playbackId: current.playbackId,
      episodeId: current.episodeId,
      positionMs: Math.round(element.currentTime * 1000),
      durationMs: Number.isFinite(element.duration) ? Math.round(element.duration * 1000) : null,
      reason,
    }).catch(() => undefined);
  }, []);
  const reportRef = useRef(report);
  useEffect(() => {
    reportRef.current = report;
  }, [report]);

  useEffect(() => {
    const element = video.current;
    const heartbeat = setInterval(() => {
      if (element && !element.paused && !element.ended) reportRef.current('heartbeat');
    }, HEARTBEAT_MS);
    const onEvent = (reason: ProgressReason) => () => reportRef.current(reason);
    const handlers: [string, () => void][] = [
      // `playing`, not `play`: `play` fires before any data is loaded, when there is nothing to report yet.
      ['playing', onEvent('play')],
      ['pause', onEvent('pause')],
      ['seeked', onEvent('seek')],
      ['ended', onEvent('ended')],
    ];
    for (const [name, handler] of handlers) element?.addEventListener(name, handler);
    // Closing the window takes the player with it without a chance to unmount.
    const onHide = (): void => reportRef.current('close');
    window.addEventListener('pagehide', onHide);
    return () => {
      clearInterval(heartbeat);
      for (const [name, handler] of handlers) element?.removeEventListener(name, handler);
      window.removeEventListener('pagehide', onHide);
      // The element is already gone from the page here, so the last known position is reported.
      const current = sessionRef.current;
      if (current && position.current > 0) {
        const duration = usePlayerStore.getState().duration;
        void call('watch.progress', {
          playbackId: current.playbackId,
          episodeId: current.episodeId,
          positionMs: Math.round(position.current * 1000),
          durationMs: duration > 0 ? Math.round(duration * 1000) : null,
          reason: 'close',
        }).catch(() => undefined);
      }
    };
  }, []);

  // ------------------------------------------------------------------ keyboard (docs/PRD.md PLY-3)
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'SELECT') &&
        target.getAttribute('type') !== 'range'
      )
        return;
      const { volume: v, speed: s, seekStep: step, shortcuts: keymap } = settingsRef.current;
      const combo = eventToCombo(event);
      let handled = true;
      if (combo === 'Escape') {
        if (usePlayerStore.getState().panel !== 'none') usePlayerStore.getState().set({ panel: 'none' });
        else act.current.goBack();
      } else {
        const action = combo ? resolveAction(keymap, combo) : null;
        const { next: nextEpisode, previous: previousEpisode } = sessionRef.current ?? {};
        if (action === 'play-pause') act.current.togglePlay();
        else if (action === 'back') seekBy(-step);
        else if (action === 'forward') seekBy(step);
        else if (action === 'back-long') seekBy(-step * 2);
        else if (action === 'forward-long') seekBy(step * 2);
        else if (action === 'volume-up') act.current.setVolume(v + 0.05);
        else if (action === 'volume-down') act.current.setVolume(v - 0.05);
        else if (action === 'mute') act.current.toggleMute();
        else if (action === 'fullscreen') act.current.toggleFullscreen();
        else if (action === 'next' && nextEpisode) act.current.goTo(nextEpisode.episodeId);
        else if (action === 'previous' && previousEpisode) act.current.goTo(previousEpisode.episodeId);
        else if (action === 'slower') updateSettings.mutate({ playerSpeed: Math.max(0.5, s - 0.25) });
        else if (action === 'faster') updateSettings.mutate({ playerSpeed: Math.min(2, s + 0.25) });
        else handled = false;
      }
      if (handled) {
        event.preventDefault();
        revealer.reveal();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // The handler reads everything else through refs, so it is installed once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealer]);

  // ------------------------------------------------------------------ controls hide after 3 s of stillness (PLY-7)
  useEffect(() => {
    revealer.reveal();
    return () => {
      revealer.stop();
      clearTimeout(toastTimer.current);
      clearTimeout(clickTimer.current);
    };
  }, [revealer]);

  // ------------------------------------------------------------------ autoplay of the next episode (PLY-4)
  const next = session?.next ?? null;
  useEffect(() => {
    if (!store.ended || !next || !autoplay) return;
    usePlayerStore.getState().set({ countdown: countdownSeconds, controlsVisible: true });
    const timer = setInterval(() => {
      const left = usePlayerStore.getState().countdown;
      if (left === null) return clearInterval(timer);
      if (left <= 1) {
        clearInterval(timer);
        usePlayerStore.getState().set({ countdown: null });
        goTo(next.episodeId);
      } else usePlayerStore.getState().set({ countdown: left - 1 });
    }, 1000);
    return () => {
      clearInterval(timer);
      usePlayerStore.getState().set({ countdown: null });
    };
  }, [store.ended, next, autoplay, countdownSeconds, goTo]);

  // ------------------------------------------------------------------ render
  const pickStream = useCallback(
    async (index: number) => {
      if (!session) return;
      usePlayerStore.getState().set({ panel: 'none', buffering: true });
      try {
        const switched = await call('playback.switchStream', { playbackId: session.playbackId, index });
        setSession(switched);
        toast(t('player.switching', { server: switched.streams[switched.activeIndex]?.server ?? '' }));
      } catch (error) {
        usePlayerStore.getState().set({
          buffering: false,
          error: {
            cause: error instanceof AppError && error.detail.kind === 'no_stream' ? 'noStream' : 'generic',
            detail: error instanceof Error ? error.message : String(error),
            tried: [],
          },
        });
      }
    },
    [session, t, toast],
  );

  const error: PlayerError | null =
    store.error ??
    (startError
      ? {
          cause:
            startError.detail.kind === 'no_stream'
              ? 'noStream'
              : startError.code === 'extension' && startError.detail.kind === 'NotFoundError'
                ? 'noStream'
                : 'generic',
          detail: startError.message,
          tried: [],
        }
      : null);
  // No address yet: the extension is still looking for the stream, so there is nothing to play or control.
  const resolving = !session && !error;
  const hidden = !store.controlsVisible && !store.paused && store.panel === 'none' && !error;

  return (
    <div
      ref={container}
      className={cn(
        'relative h-full overflow-hidden bg-video-stage text-video-text select-none',
        hidden && 'cursor-none',
      )}
      onPointerMove={revealControls}
      onWheel={(event) => act.current.setVolume(settingsRef.current.volume + (event.deltaY < 0 ? 0.05 : -0.05))}
    >
      <video
        ref={video}
        playsInline
        className={cn('absolute inset-0 size-full object-contain', resolving && 'invisible')}
        onClick={() => {
          clearTimeout(clickTimer.current);
          clickTimer.current = setTimeout(() => act.current.togglePlay(), 220);
        }}
        onDoubleClick={() => {
          clearTimeout(clickTimer.current);
          act.current.toggleFullscreen();
        }}
      />

      {resolving ? <StreamLoading /> : null}

      {store.buffering && !error && !resolving ? (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
          role="status"
          aria-label={t('player.buffering')}
        >
          <Loader2 className="size-10 animate-spin text-video-accent" aria-hidden />
        </div>
      ) : null}

      <IncognitoPill className="absolute top-16 left-4 z-10" />
      <TopBar session={session} actions={actions} visible={!hidden} />
      {resolving ? null : (
        <BottomBar session={session} actions={actions} visible={!hidden} volume={volume} muted={muted} speed={speed} />
      )}

      {session && store.panel === 'servers' ? (
        <ServerMenu session={session} onPick={(index) => void pickStream(index)} />
      ) : null}
      {session && store.panel === 'episodes' ? (
        <EpisodePanel animeId={session.animeId} currentId={session.episodeId} onPick={goTo} />
      ) : null}
      {store.countdown !== null && next ? (
        <AutoplayOverlay
          label={next.label}
          seconds={store.countdown}
          onPlayNow={() => goTo(next.episodeId)}
          onCancel={() => usePlayerStore.getState().set({ countdown: null, ended: false })}
        />
      ) : null}
      {store.toast ? <Toast message={store.toast} /> : null}
      {error ? (
        <ErrorCard
          error={error}
          canSwitch={(session?.streams.length ?? 0) > 1}
          onRetry={() => {
            setSession(null);
            setStartError(null);
            setAttempt((count) => count + 1);
          }}
          onSwitch={() => usePlayerStore.getState().set({ error: null, panel: 'servers' })}
        />
      ) : null}
    </div>
  );
}
