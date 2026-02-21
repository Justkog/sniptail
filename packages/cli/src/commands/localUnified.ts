import type { Command } from 'commander';
import { join, resolve } from 'node:path';
import { assertDbMigrationsUpToDate } from '../lib/db.js';
import { runRuntime } from '../lib/runtime.js';

type LocalOptions = {
  botConfig?: string;
  workerConfig?: string;
  env?: string;
  cwd?: string;
  root?: string;
};

export function registerLocalUnifiedCommand(program: Command) {
  program
    .command('local')
    .description('Run bot + worker in a single process with in-memory queue transport')
    .option('--bot-config <path>', 'Path to sniptail.bot.toml')
    .option('--worker-config <path>', 'Path to sniptail.worker.toml')
    .option('--env <path>', 'Path to .env file')
    .option('--cwd <path>', 'Working directory')
    .option('--root <path>', 'Sniptail install root')
    .action(async (options: LocalOptions) => {
      const forcedEnv: NodeJS.ProcessEnv = {
        QUEUE_DRIVER: 'inproc',
        JOB_REGISTRY_DB: 'sqlite',
      };

      await assertDbMigrationsUpToDate('bot', {
        ...(options.botConfig ? { config: options.botConfig } : {}),
        ...(options.env ? { env: options.env } : {}),
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.root ? { root: options.root } : {}),
        envOverrides: forcedEnv,
      });
      await assertDbMigrationsUpToDate('worker', {
        ...(options.workerConfig ? { config: options.workerConfig } : {}),
        ...(options.env ? { env: options.env } : {}),
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.root ? { root: options.root } : {}),
        envOverrides: forcedEnv,
      });

      const baseCwd = resolve(options.cwd ?? process.cwd());
      const envOverrides: NodeJS.ProcessEnv = {
        ...forcedEnv,
        ...(options.botConfig
          ? { SNIPTAIL_BOT_CONFIG_PATH: resolve(baseCwd, options.botConfig) }
          : {}),
      };

      await runRuntime({
        app: 'local',
        entry: join('dist', 'localProcessRuntime.js'),
        configEnvVar: 'SNIPTAIL_WORKER_CONFIG_PATH',
        ...(options.workerConfig ? { configPath: options.workerConfig } : {}),
        ...(options.env ? { envPath: options.env } : {}),
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.root ? { root: options.root } : {}),
        envOverrides,
      });
    });
}
