import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SpikeFixture, SpikeRequestLog, SpikeResult } from '@matane-anime/shared';
import { type ElectronApplication, type Page, expect, test } from '@playwright/test';
import { launchApp } from './support/app';

// The playback spike (docs/PRD.md R1, docs/adr/0008-media-transport.md): does hls.js, in the real
// renderer with its real CSP, play through `anime://`? Transport fixtures are asserted; codec fixtures
// are only recorded, and their results become docs/adr/0009-codec-support.md.

interface SpikeBridge {
  fixtures: () => Promise<SpikeFixture[]>;
  run: (id: string) => Promise<SpikeResult>;
  runChecks: () => Promise<Record<string, unknown>>;
}

const OUT =
  process.env['MATANE_SPIKE_OUT'] ?? join(process.cwd(), 'test-results', `spike-results-${process.platform}.json`);

test.describe.configure({ mode: 'serial' });

let app: ElectronApplication;
let page: Page;
let fixtures: SpikeFixture[] = [];

const run = (id: string): Promise<SpikeResult> =>
  page.evaluate((fixtureId) => (window as unknown as { __spike: SpikeBridge }).__spike.run(fixtureId), id);

/** The request log kept by the fake sites, read through IPC like the dev page does. */
const requestLog = (): Promise<SpikeRequestLog[]> =>
  page.evaluate(
    () =>
      (window as unknown as { api: { invoke: (c: string) => Promise<unknown> } }).api.invoke('spike.stats') as Promise<
        SpikeRequestLog[]
      >,
  );

test.beforeAll(async () => {
  ({ app, page } = await launchApp({ MATANE_SPIKE: '1', MATANE_SPIKE_OUT: OUT }));
  await page.evaluate(() => {
    window.location.hash = '#/dev/spike';
  });
  await page.waitForFunction(() => Boolean((window as unknown as { __spike?: unknown }).__spike), undefined, {
    timeout: 30_000,
  });
  fixtures = await page.evaluate(() => (window as unknown as { __spike: SpikeBridge }).__spike.fixtures());
});

test.afterAll(async () => {
  await app?.close();
});

test('the fake sites and the fixtures are there', () => {
  expect(fixtures.length).toBeGreaterThanOrEqual(14);
  expect(fixtures.filter((f) => f.group === 'transport').map((f) => f.id)).toEqual([
    'hls-ts',
    'hls-abs',
    'hls-aes',
    'hls-fmp4',
    'mp4-range',
    'hls-expiring',
  ]);
});

for (const id of ['hls-ts', 'hls-abs', 'hls-aes', 'hls-fmp4', 'mp4-range']) {
  test(`plays ${id} through anime:// and seeks`, async () => {
    const result = await run(id);
    test.info().annotations.push({ type: 'result', description: JSON.stringify(result) });
    expect(result.error, result.notes.join('; ')).toBeNull();
    expect(result.played).toBe(true);
    expect(result.videoDecoded, 'video frames decoded').toBe(true);
    expect(result.seekMs, 'seek must resume').not.toBeNull();
    // PRD §10.1 targets: first frame under 3 s, seek under 1.5 s. Recorded and checked softly.
    expect.soft(result.ttffMs ?? Infinity, 'time to first frame').toBeLessThan(3000);
    expect.soft(result.seekMs ?? Infinity, 'seek latency').toBeLessThan(1500);
  });
}

test('the site only ever sees the headers main adds, and Range is answered with 206', async () => {
  const log = await requestLog();
  const toSites = log.filter((entry) => entry.status !== 403 || entry.path.startsWith('/expiring'));
  expect(toSites.length).toBeGreaterThan(0);
  // Question 1: can main set Referer and Origin through net.fetch?
  for (const entry of toSites) {
    expect(entry.referer, `Referer on ${entry.path}`).toMatch(/^https:\/\/example\.test\//);
    expect.soft(entry.origin, `Origin on ${entry.path}`).toBe('https://example.test');
  }
  expect(log.some((entry) => entry.path.endsWith('.mp4') && entry.status === 206 && entry.range !== null)).toBe(true);
  // The second site served the absolute-URI fixture's segments.
  expect(new Set(log.map((entry) => entry.host)).size).toBeGreaterThanOrEqual(2);
});

test('a stream that expires fails with a readable 403', async () => {
  const result = await run('hls-expiring');
  expect(result.error).not.toBeNull();
  expect(result.errorCode).toBe('http_403');
});

test('the renderer cannot reach the sites directly and the proxy refuses what no manifest named', async () => {
  const checks = (await page.evaluate(() => (window as unknown as { __spike: SpikeBridge }).__spike.runChecks())) as {
    directFetchBlocked: boolean;
    externalBlocked: boolean;
    manifestRewritten: boolean;
    forbidden: { status: number; code: string | null };
    unknownSession: { status: number; code: string | null };
    range: { status: number; contentRange: string | null };
  };
  expect(checks.directFetchBlocked).toBe(true);
  expect(checks.externalBlocked).toBe(true);
  expect(checks.manifestRewritten).toBe(true);
  expect(checks.forbidden).toEqual({ status: 403, code: 'host_not_allowed' });
  expect(checks.unknownSession).toEqual({ status: 404, code: 'session_not_found' });
  expect(checks.range.status).toBe(206);
  expect(checks.range.contentRange).toMatch(/^bytes 0-99\//);

  // The refused host was never contacted: the fake site C logs every request it gets, and it logged none.
  const log = await requestLog();
  const start = await page.evaluate(() =>
    (window as unknown as { api: { invoke: (c: string, i: unknown) => Promise<{ forbiddenUrl: string }> } }).api.invoke(
      'spike.start',
      { id: 'hls-ts' },
    ),
  );
  const forbiddenTarget = Buffer.from(start.forbiddenUrl.split('/r/')[1] ?? '', 'base64url').toString('utf8');
  const forbiddenHost = new URL(forbiddenTarget).host;
  expect(log.filter((entry) => entry.host === forbiddenHost)).toHaveLength(0);
});

test('codec and container matrix is recorded', async () => {
  const codecs = fixtures.filter((fixture) => fixture.group === 'codec');
  expect(codecs.length).toBeGreaterThan(0);
  const recorded: SpikeResult[] = [];
  for (const fixture of codecs) recorded.push(await run(fixture.id));
  await test.info().attach('codec-matrix.json', {
    body: JSON.stringify(recorded, null, 2),
    contentType: 'application/json',
  });
  // Nothing is asserted about support: the outcome is data. A fixture that neither played nor failed is a bug.
  for (const result of recorded) {
    expect(result.played || result.error !== null || result.videoDecoded === false, result.id).toBe(true);
  }
});

test('the results file was written for the report script', () => {
  const written = JSON.parse(readFileSync(OUT, 'utf8')) as { platform: string; results: Record<string, SpikeResult> };
  expect(written.platform).toBe(process.platform);
  expect(Object.keys(written.results).length).toBeGreaterThanOrEqual(fixtures.length - 0);
});
