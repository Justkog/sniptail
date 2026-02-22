import type { Command } from 'commander';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import {
  getDbMigrationStatus,
  migrateDb,
  type DbMigrationStatus,
  type RuntimeOptions,
  type Scope,
} from '../lib/db.js';
import { runRuntime } from '../lib/runtime.js';

type LocalOptions = {
  botConfig?: string;
  workerConfig?: string;
  env?: string;
  cwd?: string;
  root?: string;
  migrateIfNeeded?: boolean;
};

function isInteractiveShell(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function describePendingMigrations(
  pendingEntries: Array<{ scope: Scope; status: DbMigrationStatus }>,
): string {
  return pendingEntries
    .map((entry) => `${entry.scope}: ${entry.status.pendingMigrations} (${entry.status.driver})`)
    .join(', ');
}

function buildLocalDbRuntimeOptions(options: LocalOptions, scope: Scope): RuntimeOptions {
  const configPath = scope === 'bot' ? options.botConfig : options.workerConfig;
  return {
    ...(configPath ? { config: configPath } : {}),
    ...(options.env ? { env: options.env } : {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.root ? { root: options.root } : {}),
    envOverrides: {
      QUEUE_DRIVER: 'inproc',
      JOB_REGISTRY_DB: 'sqlite',
    },
  };
}

async function confirmMigrationPrompt(summary: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const response = await rl.question(
      `Database migrations are pending (${summary}). Apply pending migrations now? [Y/n] `,
    );
    const normalized = response.trim().toLowerCase();
    return normalized === '' || normalized === 'y' || normalized === 'yes';
  } finally {
    rl.close();
  }
}

async function ensureLocalMigrations(options: LocalOptions): Promise<void> {
  const statuses: Array<{ scope: Scope; status: DbMigrationStatus; runtime: RuntimeOptions }> = [];

  for (const scope of ['bot', 'worker'] as const) {
    const runtime = buildLocalDbRuntimeOptions(options, scope);
    const status = await getDbMigrationStatus(scope, runtime);
    statuses.push({ scope, status, runtime });
  }

  const pending = statuses.filter((entry) => !entry.status.isUpToDate);
  if (!pending.length) return;

  const summary = describePendingMigrations(pending);
  const migrationHint =
    'Run "sniptail db migrate --scope bot" and "sniptail db migrate --scope worker", or re-run with --migrate-if-needed.';

  if (!options.migrateIfNeeded) {
    if (!isInteractiveShell()) {
      throw new Error(`Database migrations are pending (${summary}). ${migrationHint}`);
    }
    const confirmed = await confirmMigrationPrompt(summary);
    if (!confirmed) {
      throw new Error(`Database migrations are pending (${summary}). ${migrationHint}`);
    }
  }

  for (const entry of pending) {
    await migrateDb(entry.scope, entry.runtime);
  }
}

export function registerLocalUnifiedCommand(program: Command) {
  program
    .command('local')
    .description('Run bot + worker in a single process with in-memory queue transport')
    .option('--bot-config <path>', 'Path to sniptail.bot.toml')
    .option('--worker-config <path>', 'Path to sniptail.worker.toml')
    .option('--env <path>', 'Path to .env file')
    .option('--cwd <path>', 'Working directory')
    .option('--root <path>', 'Sniptail install root')
    .option('--migrate-if-needed', 'Automatically apply pending DB migrations before startup')
    .action(async (options: LocalOptions) => {
      await ensureLocalMigrations(options);

      const baseCwd = resolve(options.cwd ?? process.cwd());
      const envOverrides: NodeJS.ProcessEnv = {
        QUEUE_DRIVER: 'inproc',
        JOB_REGISTRY_DB: 'sqlite',
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
