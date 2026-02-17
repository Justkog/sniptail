import { join } from 'node:path';
import { runRuntime } from './runtime.js';

type Scope = 'bot' | 'worker';

type RuntimeOptions = {
  config?: string;
  env?: string;
  cwd?: string;
  root?: string;
};

export async function assertDbMigrationsUpToDate(
  scope: Scope,
  options: RuntimeOptions,
): Promise<void> {
  await runRuntime({
    app: 'worker',
    entry: join('dist', 'cli', 'db.js'),
    configEnvVar: scope === 'bot' ? 'SNIPTAIL_BOT_CONFIG_PATH' : 'SNIPTAIL_WORKER_CONFIG_PATH',
    ...(options.config ? { configPath: options.config } : {}),
    ...(options.env ? { envPath: options.env } : {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.root ? { root: options.root } : {}),
    args: ['status', '--scope', scope, '--require-up-to-date'],
  });
}
