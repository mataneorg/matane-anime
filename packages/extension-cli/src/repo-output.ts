import { bold, dim, fail, ok, warn } from './log.js';
import type { VerifyReport } from './repo.js';

export function printVerifyReport(report: VerifyReport): void {
  if (report.name !== null) {
    console.log(
      `${bold(report.name)} ${dim(`serial ${report.serial}, ${report.extensions.length} extension(s), generated ${report.generatedAt}`)}`,
    );
    for (const extension of report.extensions)
      console.log(dim(`  ${extension.id}@${extension.version}  ${extension.name}`));
  }
  if (report.announcedKey !== null) {
    const checked = report.keyChecked
      ? report.signature === 'trusted'
        ? 'matches --key'
        : 'does NOT match --key'
      : 'not compared with any key';
    console.log(`Signed by ${report.announcedKey} (${report.fingerprint}), ${checked}`);
  }
  for (const message of report.warnings) warn(message);
  for (const problem of report.problems) fail(`${problem.file}: ${problem.message}`);
  if (report.ok) ok(`${report.source} is consistent`);
  else console.log(`${report.problems.length} problem(s) found.`);
}
