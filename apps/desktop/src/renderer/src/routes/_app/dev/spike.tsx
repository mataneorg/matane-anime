import type { SpikeFixture, SpikeResult } from '@matane-anime/shared';
import { createFileRoute } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import { type ChecksResult, runChecks, runFixture } from '@renderer/features/spike/runner';
import { ipc } from '@renderer/lib/ipc';

// Development page for the playback spike (docs/adr/0008-media-transport.md). Plain English on purpose:
// it ships in no release flow, so it skips the i18n lint rule (eslint.config.js).
export const Route = createFileRoute('/_app/dev/spike')({ component: SpikePage });

declare global {
  interface Window {
    /** Driven by e2e/spike.spec.ts. */
    __spike?: {
      fixtures: () => Promise<SpikeFixture[]>;
      run: (id: string) => Promise<SpikeResult>;
      runChecks: () => Promise<ChecksResult>;
    };
  }
}

function SpikePage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [fixtures, setFixtures] = useState<SpikeFixture[]>([]);
  const [results, setResults] = useState<Record<string, SpikeResult>>({});
  const [checks, setChecks] = useState<ChecksResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ipc.invoke('spike.fixtures').then(setFixtures, (e: unknown) => setError(String(e)));
  }, []);

  const run = useCallback(async (fixture: SpikeFixture): Promise<SpikeResult> => {
    const video = videoRef.current;
    if (!video) throw new Error('video element is not mounted');
    setBusy(fixture.id);
    try {
      const result = await runFixture(fixture, video);
      setResults((previous) => ({ ...previous, [fixture.id]: result }));
      return result;
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    window.__spike = {
      fixtures: () => ipc.invoke('spike.fixtures'),
      run: async (id) => {
        const fixture = (await ipc.invoke('spike.fixtures')).find((f) => f.id === id);
        if (!fixture) throw new Error(`unknown fixture ${id}`);
        return run(fixture);
      },
      runChecks: async () => {
        const result = await runChecks();
        setChecks(result);
        return result;
      },
    };
    return () => {
      delete window.__spike;
    };
  }, [run]);

  const runAll = async (): Promise<void> => {
    for (const fixture of fixtures) await run(fixture);
  };

  return (
    <div className="flex flex-col gap-4 p-6">
      <h1 className="text-xl leading-7 font-semibold">Playback spike</h1>
      <p className="max-w-3xl text-muted-foreground">
        Plays every fixture through the anime:// proxy with hls.js or a plain video element, and records the first-frame
        time, the seek time and what failed. Results are written to spike-results.json.
      </p>
      {error && (
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-danger-text">{error}</p>
      )}

      <video ref={videoRef} controls muted className="aspect-video w-full max-w-xl rounded-xl bg-video-stage" />

      <div className="flex gap-2">
        <Button onClick={() => void runAll()} disabled={busy !== null}>
          Run all
        </Button>
        <Button variant="secondary" onClick={() => void runChecks().then(setChecks)} disabled={busy !== null}>
          Run checks
        </Button>
      </div>

      {checks && (
        <pre className="max-w-3xl overflow-auto rounded-lg border bg-card/40 p-3 font-mono text-xs leading-4">
          {JSON.stringify(checks, null, 2)}
        </pre>
      )}

      <table className="w-full max-w-5xl text-left text-xs">
        <thead>
          <tr className="border-b text-muted-foreground">
            <th className="py-2 pr-3">Fixture</th>
            <th className="pr-3">canPlayType</th>
            <th className="pr-3">MSE</th>
            <th className="pr-3">TTFF</th>
            <th className="pr-3">Seek</th>
            <th className="pr-3">Result</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {fixtures.map((fixture) => {
            const result = results[fixture.id];
            return (
              <tr key={fixture.id} className="border-b align-top">
                <td className="py-2 pr-3">
                  <div className="font-semibold">{fixture.label}</div>
                  <div className="font-mono text-muted-foreground">
                    {fixture.id} · {fixture.group}
                  </div>
                </td>
                <td className="pr-3 font-mono">{result?.canPlayType || ''}</td>
                <td className="pr-3 font-mono">{result ? String(result.mseSupported) : ''}</td>
                <td className="pr-3 font-mono">{result?.ttffMs != null ? `${result.ttffMs} ms` : ''}</td>
                <td className="pr-3 font-mono">{result?.seekMs != null ? `${result.seekMs} ms` : ''}</td>
                <td className="pr-3">
                  {result &&
                    (result.error ? (
                      <span className="text-danger-text">
                        {result.error}
                        {result.errorCode ? ` (${result.errorCode})` : ''}
                      </span>
                    ) : result.played ? (
                      <span className="text-success-text">plays</span>
                    ) : (
                      'did not start'
                    ))}
                </td>
                <td>
                  <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => void run(fixture)}>
                    {busy === fixture.id ? 'Running' : 'Run'}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
