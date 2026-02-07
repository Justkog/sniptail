import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { registerBotCommand } from './commands/bot.js';
import { registerRunJobCommand } from './commands/run-job.js';
import { registerReposCommand } from './commands/repos.js';
import { registerSlackManifestCommand } from './commands/slack-manifest.js';
import { registerWorkerCommand } from './commands/worker.js';

function resolveVersion(): string {
  try {
    const distDir = dirname(fileURLToPath(import.meta.url));
    const pkgPath = join(distDir, '..', 'package.json');
    const raw = readFileSync(pkgPath, 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const program = new Command();

program.name('sniptail').description('Sniptail CLI').version(resolveVersion());

registerBotCommand(program);
registerWorkerCommand(program);
registerRunJobCommand(program);
registerReposCommand(program);
registerSlackManifestCommand(program);

await program.parseAsync(process.argv);
