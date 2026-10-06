// Merges the spike-results.json of each OS into the Markdown tables of docs/adr/0008 and 0009.
//   pnpm --filter @matane-anime/desktop spike:report <results.json>...
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { FIXTURES } from '../src/main/playback/spike/fixtures.ts';

interface Result {
  played: boolean;
  videoDecoded: boolean | null;
  canPlayType: string;
  mseSupported: boolean | null;
  ttffMs: number | null;
  seekMs: number | null;
  error: string | null;
  errorCode: string | null;
}
interface Run {
  platform: string;
  arch: string;
  electron: string;
  chrome: string;
  upstream: string;
  results: Record<string, Result>;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: spike-report.mts <spike-results.json>...');
  process.exit(2);
}
const runs: Run[] = files.map((file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Run;
  } catch (error) {
    throw new Error(`cannot read ${basename(file)}`, { cause: error });
  }
});

const heading = (run: Run): string => `${run.platform}-${run.arch}`;
const ms = (value: number | null): string => (value === null ? '-' : `${value} ms`);

function transportCell(result: Result | undefined, id: string): string {
  if (!result) return 'not run';
  if (id === 'hls-expiring')
    return result.errorCode === 'http_403' ? 'fails with http_403 (expected)' : `UNEXPECTED: ${result.error}`;
  if (!result.played || result.videoDecoded === false) return `FAIL: ${result.error ?? 'no video'}`;
  return `ok (first frame ${ms(result.ttffMs)}, seek ${ms(result.seekMs)})`;
}

function codecCell(result: Result | undefined): string {
  if (!result) return 'not run';
  if (result.error) return `error: ${result.error}`;
  if (result.videoDecoded === false) return `audio only (canPlayType ${result.canPlayType || 'no'})`;
  if (!result.played) return 'did not play';
  return `plays (canPlayType ${result.canPlayType})`;
}

function table(group: 'transport' | 'codec', cell: (result: Result | undefined, id: string) => string): string {
  const rows = FIXTURES.filter((fixture) => fixture.group === group);
  const lines = [
    `| Fixture | ${runs.map(heading).join(' | ')} |`,
    `|---|${runs.map(() => '---').join('|')}|`,
    ...rows.map(
      (fixture) => `| ${fixture.label} | ${runs.map((run) => cell(run.results[fixture.id], fixture.id)).join(' | ')} |`,
    ),
  ];
  return lines.join('\n');
}

console.log('## Environments\n');
for (const run of runs) {
  console.log(`- ${heading(run)}: Electron ${run.electron}, Chromium ${run.chrome}, upstream via \`${run.upstream}\``);
}
console.log('\n## Transport (asserted)\n');
console.log(table('transport', transportCell));
console.log('\n## Codecs and containers (recorded)\n');
console.log(table('codec', (result) => codecCell(result)));

const failed = FIXTURES.filter((fixture) => fixture.group === 'transport' && fixture.expect === 'play').filter(
  (fixture) =>
    runs.some((run) => {
      const result = run.results[fixture.id];
      return !result || !result.played || result.videoDecoded === false;
    }),
);
if (failed.length > 0) {
  console.error(`\nTransport failed on at least one OS: ${failed.map((fixture) => fixture.id).join(', ')}`);
  process.exitCode = 1;
}
