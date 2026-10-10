// Smoke test for the packaged app (docs/plans/fase-3-download-update-beta.md, milestone 3h).
//
//   pnpm smoke:packaged [path-to-AppImage-or-executable] [--app-flag ...]   (e.g. --no-sandbox)
//
// Starts the app with MATANE_SMOKE=1 and an empty --user-data-dir. The app then checks the pieces that only
// break after packaging (native SQLite, migrations from drizzle/, the extension host with its QuickJS WASM,
// the renderer bundle), prints one `MATANE_SMOKE {json}` line and quits. This script adds what the app cannot
// check about itself: the database file exists, every bundled migration ran, and the exit is clean.
//
// Defaults to release/*.AppImage, then release/linux-unpacked (from `pnpm dist` / `pnpm pack:dir`). It needs a
// display: DISPLAY/WAYLAND_DISPLAY, or xvfb-run when that is installed (CI).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PREFIX = 'MATANE_SMOKE ';
const TIMEOUT_MS = 90_000;

// Anything starting with `--` goes to the app (a lone `--` from `pnpm run` is dropped); the first other argument is the target.
const argv = process.argv.slice(2).filter((arg) => arg !== '--');
const appFlags = argv.filter((arg) => arg.startsWith('--'));
const ownArgs = argv.filter((arg) => !arg.startsWith('--'));

function findTarget() {
  if (ownArgs[0]) return resolve(ownArgs[0]);
  const release = join(root, 'release');
  const appImage = existsSync(release) ? readdirSync(release).find((name) => name.endsWith('.AppImage')) : undefined;
  if (appImage) return join(release, appImage);
  const unpacked = join(release, 'linux-unpacked', 'matane-anime');
  if (existsSync(unpacked)) return unpacked;
  throw new Error('nothing to test: run `pnpm dist` (or `pnpm pack:dir`) first, or pass the executable');
}

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

const target = findTarget();
const userData = mkdtempSync(join(tmpdir(), 'matane-smoke-'));
const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
const hasXvfb = spawnSync('xvfb-run', ['--help'], { stdio: 'ignore' }).error === undefined;
if (process.platform === 'linux' && !hasDisplay && !hasXvfb) {
  throw new Error('no display: set DISPLAY/WAYLAND_DISPLAY or install xvfb-run');
}
const useXvfb = process.platform === 'linux' && !hasDisplay;
const command = useXvfb ? 'xvfb-run' : target;
const args = [...(useXvfb ? ['-a', target] : []), `--user-data-dir=${userData}`, ...appFlags];

console.log(`smoke: ${target}${appFlags.length ? ` ${appFlags.join(' ')}` : ''}${useXvfb ? ' (xvfb)' : ''}`);
const child = spawn(command, args, { env: { ...process.env, MATANE_SMOKE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => (stdout += chunk));
child.stderr.on('data', (chunk) => (stderr += chunk));
const timer = setTimeout(() => {
  failures.push(`the app did not quit within ${TIMEOUT_MS / 1000} s`);
  child.kill('SIGKILL');
}, TIMEOUT_MS);

const [code, signal] = await new Promise((done) =>
  child.on('close', (exitCode, exitSignal) => done([exitCode, exitSignal])),
);
clearTimeout(timer);

// Not `startsWith`: the AppImage runtime (APPIMAGE_EXTRACT_AND_RUN) lists the files it extracts on the same stdout,
// and that text can land in the middle of the report line.
const line = stdout
  .split('\n')
  .map((candidate) => candidate.slice(Math.max(candidate.indexOf(PREFIX), 0)))
  .find((candidate) => candidate.startsWith(PREFIX));
let report;
try {
  report = line ? JSON.parse(line.slice(PREFIX.length)) : undefined;
} catch {
  report = undefined;
}
check(report !== undefined, 'the app printed no MATANE_SMOKE report');
check(
  code === 0 && signal === null,
  `the app exited with code ${code}${signal ? ` (signal ${signal})` : ''}, expected a clean 0`,
);
if (report) {
  check(report.ok === true, `the app reported failure: ${report.errors?.join('; ')}`);
  check(report.packaged === true, 'the app does not think it is packaged');
  const journal = JSON.parse(readFileSync(join(root, 'drizzle/meta/_journal.json'), 'utf8'));
  check(
    report.migrations === journal.entries.length,
    `migrations applied: ${report.migrations}, bundled: ${journal.entries.length}`,
  );
  check(report.host?.answer === 'pong', 'the extension host sandbox did not answer');
  check((report.renderer?.rootChildren ?? 0) > 0, 'the renderer did not mount');
  check(report.userData === userData, `the app used ${report.userData} instead of the isolated profile`);
}
check(existsSync(join(userData, 'data.db')), 'data.db was not created in the profile');

if (failures.length > 0) {
  console.error(`smoke FAILED:\n- ${failures.join('\n- ')}`);
  console.error(`--- app output ---\n${stdout}${stderr}`);
  process.exitCode = 1;
} else {
  console.log(`smoke OK: ${line.slice(PREFIX.length)}`);
}
rmSync(userData, { recursive: true, force: true });
