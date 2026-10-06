import type { SpikeFixture, SpikeResult } from '@matane-anime/shared';
import Hls from 'hls.js';
import { ipc } from '@renderer/lib/ipc';

// The playback spike (docs/PRD.md R1): plays each fixture through `anime://`, as the real player will,
// and records what happened. Results go to main (`spike.report`) and end up in docs/adr/0008, 0009.

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean, timeoutMs: number, stepMs = 25): Promise<boolean> {
  const end = performance.now() + timeoutMs;
  while (performance.now() < end) {
    if (condition()) return true;
    await wait(stepMs);
  }
  return condition();
}

/** Reads the `x-error-code` the proxy puts on failed responses. Null when the request works or has none. */
async function probeErrorCode(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { headers: { Range: 'bytes=0-1' } });
    return response.ok ? null : response.headers.get('x-error-code');
  } catch {
    return 'unreachable';
  }
}

// Short retries: a failing stream must surface as an error within seconds, not after hls.js' default backoff.
const FAST_FAIL = {
  default: {
    maxTimeToFirstByteMs: 8000,
    maxLoadTimeMs: 15000,
    timeoutRetry: { maxNumRetry: 1, retryDelayMs: 100, maxRetryDelayMs: 200 },
    errorRetry: { maxNumRetry: 1, retryDelayMs: 100, maxRetryDelayMs: 200 },
  },
};

export async function runFixture(fixture: SpikeFixture, video: HTMLVideoElement): Promise<SpikeResult> {
  const notes: string[] = [];
  const result: SpikeResult = {
    id: fixture.id,
    played: false,
    videoDecoded: null,
    canPlayType: video.canPlayType(`${fixture.container}; codecs="${fixture.codecs}"`) || 'no',
    mseSupported:
      fixture.kind === 'hls'
        ? Hls.isSupported() && MediaSource.isTypeSupported(`video/mp4; codecs="${fixture.codecs}"`)
        : null,
    ttffMs: null,
    seekMs: null,
    error: null,
    errorCode: null,
    notes,
  };

  const started = await ipc.invoke('spike.start', { id: fixture.id });
  let hls: Hls | null = null;
  let fatal: { details: string; url: string | null } | null = null;
  video.muted = true;
  const t0 = performance.now();

  try {
    if (fixture.kind === 'hls') {
      if (!Hls.isSupported()) throw new Error('hls.js is not supported in this browser');
      hls = new Hls({ fragLoadPolicy: FAST_FAIL, manifestLoadPolicy: FAST_FAIL, playlistLoadPolicy: FAST_FAIL });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        notes.push(`hls.js ${data.fatal ? 'fatal ' : ''}${data.type}/${data.details}`);
        if (data.fatal) fatal = { details: data.details, url: data.url ?? data.frag?.url ?? null };
      });
      hls.loadSource(started.url);
      hls.attachMedia(video);
    } else {
      video.src = started.url;
    }

    const onFrame = (): void => {
      result.ttffMs ??= Math.round(performance.now() - t0);
    };
    // Chromium has requestVideoFrameCallback (a real painted frame); the event is only a fallback.
    const withFrameCallback = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: () => void) => number;
    };
    if (withFrameCallback.requestVideoFrameCallback) withFrameCallback.requestVideoFrameCallback(onFrame);
    else video.addEventListener('playing', onFrame, { once: true });

    // Not awaited: play() stays pending until the first data arrives, and never settles if loading fails.
    void video.play().catch((error: unknown) => notes.push(`play() rejected: ${String(error)}`));

    result.played = await until(() => video.currentTime > 1 || fatal !== null || video.error !== null, 12_000).then(
      () => video.currentTime > 1,
    );

    if (!fixture.container.startsWith('audio/')) {
      const frames = video.getVideoPlaybackQuality().totalVideoFrames;
      result.videoDecoded = video.videoWidth > 0 && frames > 0 && result.ttffMs !== null;
      if (result.played && !result.videoDecoded) notes.push('the clock ran but no video frame was decoded');
    }

    // Seek: only for streams that are meant to work, and only if they started.
    if (result.played && fixture.expect === 'play') {
      const target = Math.max(1, Math.min(3.5, (Number.isFinite(video.duration) ? video.duration : 6) - 2));
      const t1 = performance.now();
      video.currentTime = target;
      const resumed = await until(() => video.currentTime >= target + 0.3 && !video.seeking, 8000);
      if (resumed) result.seekMs = Math.round(performance.now() - t1);
      else notes.push(`seek to ${target.toFixed(1)}s did not resume (at ${video.currentTime.toFixed(2)}s)`);
    }

    // An expiring stream is expected to fail after its first segment; give it time to do so.
    if (fixture.expect === 'expire') await until(() => fatal !== null || video.error !== null, 15_000);

    const failure = fatal as { details: string; url: string | null } | null;
    if (failure) {
      result.error = `hls.js: ${failure.details}`;
      result.errorCode = failure.url ? await probeErrorCode(failure.url) : null;
    } else if (video.error) {
      result.error = `MediaError ${video.error.code}${video.error.message ? `: ${video.error.message}` : ''}`;
      result.errorCode = await probeErrorCode(started.url);
    } else if (!result.played) {
      result.error = 'no playback within 12 s';
    }
  } catch (error) {
    result.error = String(error);
  } finally {
    hls?.destroy();
    video.pause();
    video.removeAttribute('src');
    video.load();
  }

  await ipc.invoke('spike.report', result);
  return result;
}

export interface ChecksResult {
  /** A direct fetch of the fake site from the renderer fails (no CORS headers): proves the proxy is needed. */
  directFetchBlocked: boolean;
  /** CSP `connect-src` stops the renderer from reaching any other site. */
  externalBlocked: boolean;
  /** The playlist the player receives holds no upstream URL, only `anime://` ones. */
  manifestRewritten: boolean;
  forbidden: { status: number; code: string | null };
  unknownSession: { status: number; code: string | null };
  range: { status: number; contentRange: string | null };
}

export async function runChecks(): Promise<ChecksResult> {
  const hls = await ipc.invoke('spike.start', { id: 'hls-ts' });
  const text = await fetch(hls.url).then((response) => response.text());
  const mp4 = await ipc.invoke('spike.start', { id: 'mp4-range' });
  const ranged = await fetch(mp4.url, { headers: { Range: 'bytes=0-99' } });
  const forbidden = await fetch(hls.forbiddenUrl);
  const unknown = await fetch('anime://play/unknown-session/index.m3u8');
  return {
    directFetchBlocked: await fetch(hls.directUrl).then(
      () => false,
      () => true,
    ),
    externalBlocked: await fetch('https://example.org/').then(
      () => false,
      () => true,
    ),
    manifestRewritten: text.includes('anime://play/') && !/https?:\/\/127\.0\.0\.1/.test(text),
    forbidden: { status: forbidden.status, code: forbidden.headers.get('x-error-code') },
    unknownSession: { status: unknown.status, code: unknown.headers.get('x-error-code') },
    range: { status: ranged.status, contentRange: ranged.headers.get('content-range') },
  };
}
