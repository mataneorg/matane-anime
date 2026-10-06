import { Command, InvalidArgumentError } from 'commander';
import { BuildError, buildExtension } from './build';
import { printRows, runChain, runSynthetic } from './bench';
import { scaffold } from './create';
import { bold, dim, fail, ok, warn } from './log';
import { runTest } from './test-command';

const collect = (value: string, previous: string[]): string[] => [...previous, value];
const integer = (value: string): number => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new InvalidArgumentError('must be a positive integer');
  return parsed;
};

const program = new Command()
  .name('ma-ext')
  .description('Create, build, test and benchmark Matane Anime extensions')
  .version('0.0.0');

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

try {
  await program.parseAsync();
} catch (error) {
  fail(error instanceof BuildError ? error.message : (error as Error).message);
  if (!(error instanceof BuildError) && process.env['MA_EXT_DEBUG'])
    console.error(bold('stack:'), (error as Error).stack);
  process.exitCode = 1;
}
