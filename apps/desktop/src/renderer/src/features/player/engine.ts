import Hls from 'hls.js';

export interface FatalInfo {
  /** The status of the request that failed, when it was an HTTP one (the proxy passes it through). */
  httpStatus: number | null;
  message: string;
}

export interface EngineEvents {
  /** The first frame was painted. */
  onPlaying(): void;
  /** hls.js or `<video>` gave up. Main decides what happens next; the engine does not retry by itself. */
  onFatal(info: FatalInfo): void;
}

// Failing fast matters more than retrying hard: main moves on to another stream, which is better than a
// spinner (docs/PRD.md STR-3). One retry covers a hiccup.
const QUICK = {
  default: {
    maxTimeToFirstByteMs: 10_000,
    maxLoadTimeMs: 30_000,
    timeoutRetry: { maxNumRetry: 2, retryDelayMs: 500, maxRetryDelayMs: 2000 },
    errorRetry: { maxNumRetry: 1, retryDelayMs: 500, maxRetryDelayMs: 2000 },
  },
};

type Frames = HTMLVideoElement & { requestVideoFrameCallback?: (callback: () => void) => number };

/**
 * Points a `<video>` at a session URL: through hls.js (MSE) for playlists, natively for files. Returns the
 * function that tears it down. `startAt` is where to begin, so switching servers keeps the position.
 *
 * Audio that plays without a picture (HEVC on a build without its decoder) never raises an error by
 * itself, so after a second of playback the engine checks that frames were decoded (docs/adr/0009).
 */
export function attachStream(
  video: HTMLVideoElement,
  stream: { url: string; kind: 'hls' | 'mp4' },
  startAt: number,
  events: EngineEvents,
): () => void {
  let disposed = false;
  let reportedPlaying = false;
  let failed = false;
  let hls: Hls | null = null;

  const fatal = (info: FatalInfo): void => {
    if (disposed || failed) return;
    failed = true;
    events.onFatal(info);
  };

  const playing = (): void => {
    if (disposed || reportedPlaying) return;
    reportedPlaying = true;
    events.onPlaying();
  };

  const frames = video as Frames;
  const onFrame = (): void => playing();
  const onTime = (): void => {
    if (video.currentTime > 1 && video.videoWidth === 0 && video.getVideoPlaybackQuality().totalVideoFrames === 0) {
      fatal({ httpStatus: null, message: 'codec: the audio plays but no video frame was decoded' });
    }
  };
  const onMediaError = (): void => {
    const error = video.error;
    fatal({
      httpStatus: null,
      message:
        error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED
          ? 'codec: format not supported'
          : `media error ${error?.code ?? ''} ${error?.message ?? ''}`.trim(),
    });
  };
  video.addEventListener('timeupdate', onTime);
  video.addEventListener('error', onMediaError);
  if (frames.requestVideoFrameCallback) frames.requestVideoFrameCallback(onFrame);
  else video.addEventListener('playing', onFrame, { once: true });

  if (stream.kind === 'hls') {
    hls = new Hls({
      startPosition: startAt > 0 ? startAt : -1,
      fragLoadPolicy: QUICK,
      manifestLoadPolicy: QUICK,
      playlistLoadPolicy: QUICK,
    });
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      fatal({ httpStatus: data.response?.code ?? null, message: `${data.type}: ${data.details}` });
    });
    hls.loadSource(stream.url);
    hls.attachMedia(video);
  } else {
    video.src = stream.url;
    video.addEventListener(
      'loadedmetadata',
      () => {
        if (startAt > 0) video.currentTime = startAt;
      },
      { once: true },
    );
  }
  void video.play().catch(() => {
    // Autoplay can be refused until the user interacts; the controls show the paused state.
  });

  return () => {
    disposed = true;
    video.removeEventListener('timeupdate', onTime);
    video.removeEventListener('error', onMediaError);
    video.removeEventListener('playing', onFrame);
    hls?.destroy();
    video.pause();
    video.removeAttribute('src');
    video.load();
  };
}
