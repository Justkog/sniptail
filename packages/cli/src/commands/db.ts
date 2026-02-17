import type { Command } from 'commander';
import { join } from 'node:path';
import { runRuntime } from '../lib/runtime.js';

type Scope = 'bot' | 'worker';

type RuntimeOptions = {
  config?: string;
  env?: string;
  cwd?: string;
  root?: string;
  scope?: string;
  json?: boolean;
};

function parseScope(raw?: string): Scope {
  if (!raw) return 'worker';
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'worker' || normalized === 'bot') {
    return normalized;
  }
  throw new Error(`Invalid --scope value: ${raw}. Expected "worker" or "bot".`);
}

function appendRuntimeOptions(command: Command): Command {
  return command
    .option('--scope <scope>', 'Config scope: worker or bot (default: worker)')
    .option('--config <path>', 'Path to sniptail config TOML')
    .option('--env <path>', 'Path to .env file')
    .option('--cwd <path>', 'Working directory')
    .option('--root <path>', 'Sniptail install root')
    .option('--json', 'Print JSON output');
}

async function runDbRuntime(options: RuntimeOptions, args: string[]): Promise<void> {
  const scope = parseScope(options.scope);
  await runRuntime({
    app: 'worker',
    entry: join('dist', 'cli', 'db.js'),
    configEnvVar: scope === 'bot' ? 'SNIPTAIL_BOT_CONFIG_PATH' : 'SNIPTAIL_WORKER_CONFIG_PATH',
    ...(options.config ? { configPath: options.config } : {}),
    ...(options.env ? { envPath: options.env } : {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.root ? { root: options.root } : {}),
    args: [...args, '--scope', scope],
  });
}

export function registerDbCommand(program: Command): void {
  const db = program.command('db').description('Inspect and apply SQL job-registry migrations');

  appendRuntimeOptions(
    db.command('status')
      .description('Show migration status for the configured job registry DB')
      .action(async (options: RuntimeOptions) => {
        const args = ['status'];
        if (options.json) args.push('--json');
        await runDbRuntime(options, args);
      }),
  );

  appendRuntimeOptions(
    db.command('migrate')
      .description('Apply pending SQL migrations for the configured job registry DB')
      .action(async (options: RuntimeOptions) => {
        const args = ['migrate'];
        if (options.json) args.push('--json');
        await runDbRuntime(options, args);
      }),
  );
}
