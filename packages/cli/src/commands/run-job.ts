import { Command } from 'commander';
import { join, resolve } from 'node:path';
import { runRuntime } from '../lib/runtime.js';

type RunJobOptions = {
  config?: string;
  env?: string;
  cwd?: string;
  root?: string;
};

export function registerRunJobCommand(program: Command) {
  program
    .command('run-job')
    .description('Run a job JSON payload through the worker pipeline')
    .argument('<jobPath>', 'Path to a job JSON file')
    .option('--config <path>', 'Path to sniptail.worker.toml')
    .option('--env <path>', 'Path to .env file')
    .option('--cwd <path>', 'Working directory')
    .option('--root <path>', 'Sniptail install root')
    .action(async (jobPath: string, options: RunJobOptions) => {
      const baseCwd = resolve(options.cwd ?? process.cwd());
      const resolvedJobPath = resolve(baseCwd, String(jobPath));
      await runRuntime({
        app: 'worker',
        entry: join('dist', 'cli', 'run-job.js'),
        configEnvVar: 'SNIPTAIL_WORKER_CONFIG_PATH',
        ...(options.config ? { configPath: options.config } : {}),
        ...(options.env ? { envPath: options.env } : {}),
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.root ? { root: options.root } : {}),
        args: [resolvedJobPath],
      });
    });
}
