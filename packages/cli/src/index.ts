import { resolveSniptailVersion } from '@sniptail/core/releaseInfo.js';
import { Command } from 'commander';
import { registerBotCommand } from './commands/bot.js';
import { registerDbCommand } from './commands/db.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerLocalUnifiedCommand } from './commands/localUnified.js';
import { registerPermissionsCommand } from './commands/permissionsCommand.js';
import { registerRunJobCommand } from './commands/run-job.js';
import { registerReposCommand } from './commands/repos.js';
import { registerSlackManifestCommand } from './commands/slack-manifest.js';
import { registerWorkerCommand } from './commands/worker.js';
import { stripPackageScriptSeparator } from './lib/argv.js';

const version = resolveSniptailVersion(import.meta.url);
process.env.SNIPTAIL_VERSION ??= version;

const program = new Command();

program.name('sniptail').description('Sniptail CLI').version(version);

registerBotCommand(program);
registerWorkerCommand(program);
registerRunJobCommand(program);
registerReposCommand(program);
registerPermissionsCommand(program);
registerDbCommand(program);
registerDoctorCommand(program);
registerSlackManifestCommand(program);
registerLocalUnifiedCommand(program);

try {
  await program.parseAsync(stripPackageScriptSeparator(process.argv));
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
}
