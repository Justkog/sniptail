import type { Command } from 'commander';
import { join } from 'node:path';
import { assertDbMigrationsUpToDate } from '../lib/db.js';
import { runRuntime } from '../lib/runtime.js';

type WorkerOptions = {
  config?: string;
  env?: string;
  cwd?: string;
  root?: string;
};

export function registerWorkerCommand(program: Command) {
  program
    .command('worker')
    .description('Start the Sniptail worker')
    .option('--config <path>', 'Path to sniptail.worker.toml')
    .option('--env <path>', 'Path to .env file')
    .option('--cwd <path>', 'Working directory')
    .option('--root <path>', 'Sniptail install root')
    .action(async (options: WorkerOptions) => {
      await assertDbMigrationsUpToDate('worker', {
        ...(options.config ? { config: options.config } : {}),
        ...(options.env ? { env: options.env } : {}),
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.root ? { root: options.root } : {}),
      });
      await runRuntime({
        app: 'worker',
        entry: join('dist', 'index.js'),
        configEnvVar: 'SNIPTAIL_WORKER_CONFIG_PATH',
        ...(options.config ? { configPath: options.config } : {}),
        ...(options.env ? { envPath: options.env } : {}),
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.root ? { root: options.root } : {}),
      });
    });
}
