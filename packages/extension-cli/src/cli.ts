import { Command, InvalidArgumentError } from 'commander';
import { BuildError, buildExtension } from './build.js';
import { printRows, runChain, runSynthetic } from './bench.js';
import { scaffold } from './create.js';
import { bold, dim, fail, ok, warn } from './log.js';
import { buildRepo, keygen, verifyRepo } from './repo.js';
import { printVerifyReport } from './repo-output.js';
import { runTest } from './test-command.js';
import { VERSION } from './version.js';

const collect = (value: string, previous: string[]): string[] => [...previous, value];
const integer = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new InvalidArgumentError('must be a positive integer');
  return parsed;
};

const program = new Command()
  .name('ma-ext')
  .description('Create, build, test and benchmark Matane Anime extensions')
  .version(VERSION);

program
  .command('create <id>')
  .description('scaffold a new extension in ./<id>')
  .option('--name <name>', 'display name')
  .option('--lang <lang>', 'content language of the first source', 'en')
  .option('--dir <dir>', 'where to create it')
  .action(async (id: string, options: { name?: string; lang: string; dir?: string }) => {
    const target = await scaffold({ id, ...options });
    ok(`Created ${target}`);
    console.log(dim('  Next: cd into it, install, then `ma-ext build` and `ma-ext test`.'));
  });

program
  .command('build [dir]')
  .description('bundle src/index.ts into dist/ and check it loads in the sandbox')
  .action(async (dir = '.') => {
    const result = await buildExtension(dir);
    for (const warning of result.warnings) warn(warning);
    ok(
      `Built ${result.manifest.id}@${result.manifest.version}`,
      `${(Buffer.byteLength(result.code) / 1024).toFixed(1)} KB → ${result.outDir}`,
    );
  });

program
  .command('test [dir]')
  .description('run popular → search → details → episodes → streams with the app’s checks')
  .option('--source <key>', 'source key from the manifest (default: the first)')
  .option('--query <text>', 'search query (default: the first word of the first popular title)')
  .option('--pref <key=value>', 'preference value, repeatable', collect, [] as string[])
  .option('-v, --verbose', 'print the extension’s log output')
  .action(async (dir = '.', options: { source?: string; query?: string; pref: string[]; verbose?: boolean }) => {
    process.exitCode = await runTest(dir, options);
  });

program
  .command('bench [dir]')
  .description('time each call in the sandbox; with --synthetic, the worst cases that set the limits')
  .option('--source <key>')
  .option('--pref <key=value>', 'preference value, repeatable', collect, [] as string[])
  .option('--runs <n>', 'runs per case', integer, 5)
  .option('--synthetic', 'only run the built-in worst cases (no extension needed)')
  .action(
    async (
      dir: string | undefined,
      options: { source?: string; pref: string[]; runs: number; synthetic?: boolean },
    ) => {
      if (!options.synthetic) printRows(`${dir ?? '.'}: ${options.runs} runs`, await runChain(dir ?? '.', options));
      printRows('Synthetic worst cases', await runSynthetic(options.runs));
    },
  );

const repo = program
  .command('repo')
  .description('create, sign and check extension repositories (static folders any web server can host)');

repo
  .command('keygen')
  .description('create the Ed25519 key pair that signs a repository (repo-key.pem, repo-key.pub)')
  .option('--out <dir>', 'where to write the two files', '.')
  .action(async (options: { out: string }) => {
    const result = await keygen(options.out);
    ok(`Wrote ${result.privateKeyPath} (private, mode 600) and ${result.publicKeyPath}`);
    console.log(`  public key   ${result.publicKey}\n  fingerprint  ${result.fingerprint}`);
    warn('Keep repo-key.pem secret and do NOT commit it: whoever holds it can publish as your repository.');
    console.log(
      dim('  Share the public key so users can compare it with what the app shows when they add the repository.'),
    );
  });

repo
  .command('build <extensionDir...>')
  .description('write a repository (index.json, signature, <id>-<version>.zip, <id>.png) from built extensions')
  .requiredOption('--out <dir>', 'repository folder; created if needed, unrelated files in it are kept')
  .requiredOption('--name <name>', 'repository name shown in the app')
  .option('--key <pem>', 'private key from `ma-ext repo keygen`; signing is the default')
  .option('--unsigned', 'publish without a signature (users will see "Unverified repository")')
  .option('--serial <n>', 'index serial (default: the previous one in --out plus 1, else 1)', integer)
  .option('--base-url <url>', 'make archive and icon references absolute URLs under this base')
  .option('--min-app-version <semver>', 'the oldest app version that may install these extensions, e.g. 0.2.0')
  .addHelpText(
    'after',
    `
Each directory must have been built with \`ma-ext build\` (dist/ with index.js, manifest.json and icon.png). The new
index lists exactly the extensions given now; archives of older versions stay on disk but are no longer listed.`,
  )
  .action(
    async (
      dirs: string[],
      options: {
        out: string;
        name: string;
        key?: string;
        unsigned?: boolean;
        serial?: number;
        baseUrl?: string;
        minAppVersion?: string;
      },
    ) => {
      const result = await buildRepo(dirs, options);
      for (const warning of result.warnings) warn(warning);
      ok(
        `Built "${options.name}" serial ${result.serial}: ${result.extensions.map((e) => `${e.id}@${e.version}`).join(', ')}`,
        `→ ${result.out}`,
      );
      console.log(dim(`  ${result.files.join(', ')}`));
      if (result.publicKey) console.log(dim(`  signed by ${result.publicKey}`));
    },
  );

repo
  .command('verify <dirOrUrl>')
  .description('check a repository in a folder or at an http(s) URL; exit code 1 when anything is wrong')
  .option('--key <ed25519:hex>', 'also require the index to be signed by this public key')
  .option('--json', 'print the result as JSON')
  .action(async (source: string, options: { key?: string; json?: boolean }) => {
    const report = await verifyRepo(source, options);
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else printVerifyReport(report);
    process.exitCode = report.ok ? 0 : 1;
  });

try {
  await program.parseAsync();
} catch (error) {
  fail(error instanceof BuildError ? error.message : (error as Error).message);
  if (!(error instanceof BuildError) && process.env['MA_EXT_DEBUG'])
    console.error(bold('stack:'), (error as Error).stack);
  process.exitCode = 1;
}
