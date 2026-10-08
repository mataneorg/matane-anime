// `pnpm --filter @matane-anime/test-site serve [--repo [--unsigned]]`: the fake site, for trying an extension by hand.
// With --repo it also serves a repository of extensions/example at /repo/, made by the real `ma-ext repo` commands
// (so build the CLI first: `pnpm build`), signed by a throw-away key unless --unsigned.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TestSite } from './server.ts';

const ROOT = resolve(import.meta.dirname, '../../..');
const CLI = join(ROOT, 'packages/extension-cli/dist/cli.js');
const EXAMPLE = join(ROOT, 'extensions/example');
const args = new Set(process.argv.slice(2));

const site = await TestSite.start({ mediaDir: join(ROOT, 'apps/desktop/e2e/fixtures/media') });
console.log(`site: ${site.origin}\ncdn:  ${site.cdnOrigin}\nreferer media and embeds require: ${site.referer}`);

let work: string | undefined;
if (args.has('--repo')) {
  work = mkdtempSync(join(tmpdir(), 'matane-test-repo-'));
  const ma = (...argv: string[]): void => void execFileSync(process.execPath, [CLI, ...argv], { stdio: 'pipe' });
  ma('build', EXAMPLE);
  const out = join(work, 'repo');
  let publicKey: string | undefined;
  if (args.has('--unsigned')) {
    ma('repo', 'build', EXAMPLE, '--out', out, '--name', 'Test Repository', '--unsigned');
  } else {
    ma('repo', 'keygen', '--out', work);
    publicKey = readFileSync(join(work, 'repo-key.pub'), 'utf8').trim();
    ma('repo', 'build', EXAMPLE, '--out', out, '--name', 'Test Repository', '--key', join(work, 'repo-key.pem'));
  }
  site.setRepo(new Map(readdirSync(out).map((name) => [name, readFileSync(join(out, name))])));
  console.log(`repo: ${site.repoUrl}`);
  if (publicKey) {
    const hex = publicKey.slice('ed25519:'.length);
    console.log(`repo key: ${publicKey}\nfingerprint: ed25519:${hex.slice(0, 4)}…${hex.slice(-4)}`);
  } else {
    console.log('repo is unsigned: the app shows "Unverified repository"');
  }
}

process.on('SIGINT', () => {
  if (work) rmSync(work, { recursive: true, force: true });
  void site.close().then(() => process.exit(0));
});
