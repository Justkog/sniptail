import type { Command } from 'commander';
import { join } from 'node:path';
import { assertDbMigrationsUpToDate } from '../lib/db.js';
import { runRuntime } from '../lib/runtime.js';

type BotOptions = {
  config?: string;
  env?: string;
  cwd?: string;
  root?: string;
  dryRun?: boolean;
};

export function registerBotCommand(program: Command) {
  program
    .command('bot')
    .description('Start the Sniptail bot')
    .option('--config <path>', 'Path to sniptail.bot.toml')
    .option('--env <path>', 'Path to .env file')
    .option('--cwd <path>', 'Working directory')
    .option('--root <path>', 'Sniptail install root')
    .option('--dry-run', 'Run the bot smoke test')
    .action(async (options: BotOptions) => {
      if (!options.dryRun) {
        await assertDbMigrationsUpToDate('bot', {
          ...(options.config ? { config: options.config } : {}),
          ...(options.env ? { env: options.env } : {}),
          ...(options.cwd ? { cwd: options.cwd } : {}),
          ...(options.root ? { root: options.root } : {}),
        });
      }
      await runRuntime({
        app: 'bot',
        entry: join('dist', 'index.js'),
        configEnvVar: 'SNIPTAIL_BOT_CONFIG_PATH',
        ...(options.config ? { configPath: options.config } : {}),
        ...(options.env ? { envPath: options.env } : {}),
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.root ? { root: options.root } : {}),
        ...(options.dryRun ? { dryRun: true } : {}),
      });
    });
}
