import { join } from 'node:path';
import { runRuntimeCapture } from './runtime.js';

export type Scope = 'bot' | 'worker';

export type RuntimeOptions = {
  config?: string;
  env?: string;
  cwd?: string;
  root?: string;
  envOverrides?: NodeJS.ProcessEnv;
};

export type DbMigrationStatus = {
  driver: 'sqlite' | 'pg' | 'redis';
  expectedMigrations: number;
  appliedMigrations: number;
  pendingMigrations: number;
  isUpToDate: boolean;
  isAhead: boolean;
  latestExpectedTag?: string;
  latestAppliedAt?: number;
};

type DbCommandPayload = {
  command: 'status' | 'migrate';
  scope: Scope;
  status: DbMigrationStatus;
};

function isDbMigrationStatus(value: unknown): value is DbMigrationStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return (
    (payload.driver === 'sqlite' || payload.driver === 'pg' || payload.driver === 'redis') &&
    typeof payload.expectedMigrations === 'number' &&
    typeof payload.appliedMigrations === 'number' &&
    typeof payload.pendingMigrations === 'number' &&
    typeof payload.isUpToDate === 'boolean' &&
    typeof payload.isAhead === 'boolean'
  );
}

function isDbCommandPayload(
  value: unknown,
  expectedCommand: 'status' | 'migrate',
  expectedScope: Scope,
): value is DbCommandPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return (
    payload.command === expectedCommand &&
    payload.scope === expectedScope &&
    isDbMigrationStatus(payload.status)
  );
}

function extractDbErrorMessage(stderr: string): string | undefined {
  const lines = stderr
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return undefined;

  const usageLineIndex = lines.findIndex((line) => line.startsWith('Usage: db '));
  const relevantLines = usageLineIndex >= 0 ? lines.slice(0, usageLineIndex) : lines;
  const candidates = relevantLines.filter((line) => {
    if (line.startsWith('Options:') || line.startsWith('Examples:')) return false;
    if (line.startsWith('db ') || line.startsWith('--')) return false;
    if (line.startsWith('at ')) return false;
    if (line.startsWith('err:')) return false;
    if (line.includes('DB command failed')) return false;
    if (line === '{' || line === '}') return false;
    if (
      line.startsWith('"type":') ||
      line.startsWith('"message":') ||
      line.startsWith('"stack":')
    ) {
      return false;
    }
    return true;
  });

  const match = candidates[0];
  if (!match) return undefined;
  return match.startsWith('Error: ') ? match.slice('Error: '.length).trim() : match;
}

function formatDbCommandError(
  command: 'status' | 'migrate',
  scope: Scope,
  exitCode: number,
  stderr: string,
): string {
  const defaultMessage = `db ${command} exited with code ${exitCode}.`;
  const detail = extractDbErrorMessage(stderr) ?? defaultMessage;
  if (command === 'status') {
    return `Failed to check database migrations for ${scope}: ${detail}`;
  }
  return `Failed to apply database migrations for ${scope}: ${detail}`;
}

async function runDbCommand(
  command: 'status' | 'migrate',
  scope: Scope,
  options: RuntimeOptions,
): Promise<DbMigrationStatus> {
  const result = await runRuntimeCapture({
    app: 'worker',
    entry: join('dist', 'cli', 'db.js'),
    configEnvVar: scope === 'bot' ? 'SNIPTAIL_BOT_CONFIG_PATH' : 'SNIPTAIL_WORKER_CONFIG_PATH',
    ...(options.config ? { configPath: options.config } : {}),
    ...(options.env ? { envPath: options.env } : {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.root ? { root: options.root } : {}),
    ...(options.envOverrides ? { envOverrides: options.envOverrides } : {}),
    args: [command, '--json', '--scope', scope],
  });

  if (result.exitCode !== 0) {
    throw new Error(formatDbCommandError(command, scope, result.exitCode, result.stderr));
  }

  const rawOutput = result.stdout.trim();
  if (!rawOutput) {
    throw new Error(`Database ${command} command returned no JSON output for ${scope}.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    throw new Error(`Database ${command} command returned invalid JSON output for ${scope}.`);
  }

  if (!isDbCommandPayload(parsed, command, scope)) {
    throw new Error(`Database ${command} command returned an unexpected payload for ${scope}.`);
  }

  return parsed.status;
}

export async function getDbMigrationStatus(
  scope: Scope,
  options: RuntimeOptions,
): Promise<DbMigrationStatus> {
  return runDbCommand('status', scope, options);
}

export async function migrateDb(scope: Scope, options: RuntimeOptions): Promise<DbMigrationStatus> {
  return runDbCommand('migrate', scope, options);
}

export async function assertDbMigrationsUpToDate(
  scope: Scope,
  options: RuntimeOptions,
): Promise<void> {
  const status = await getDbMigrationStatus(scope, options);
  if (!status.isUpToDate) {
    throw new Error(
      [
        `Database is not up to date for ${scope}: ${status.pendingMigrations} pending migration(s) (${status.driver}).`,
        `Run "sniptail db migrate --scope ${scope}" to apply migrations.`,
      ].join(' '),
    );
  }
}
