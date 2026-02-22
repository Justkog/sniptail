import 'dotenv/config';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { loadBotConfig, loadWorkerConfig } from '@sniptail/core/config/config.js';
import {
  getDbMigrationStatus,
  migrateDb,
  type DbMigrationStatus,
} from '@sniptail/core/db/migrations.js';
import { logger } from '@sniptail/core/logger.js';

type Scope = 'bot' | 'worker';
type Command = 'status' | 'migrate';

function isJsonModeRequested(args: string[]): boolean {
  return args.some((arg) => arg === '--json' || arg.startsWith('--json='));
}

function printUsage(): void {
  process.stderr.write(
    [
      'Usage: db <status|migrate> [options]',
      '',
      'Options:',
      '  --scope <worker|bot>     Which app config to load (default: worker)',
      '  --json                   Output JSON',
      '  --require-up-to-date     Exit non-zero if migrations are pending (status only)',
      '',
      'Examples:',
      '  db status',
      '  db status --scope bot --json',
      '  db migrate',
      '',
    ].join('\n'),
  );
}

function parseScope(raw?: string): Scope {
  if (!raw) return 'worker';
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'worker' || normalized === 'bot') {
    return normalized;
  }
  throw new Error(`Invalid --scope value: ${raw}. Expected "worker" or "bot".`);
}

function getRegistryConfig(scope: Scope): {
  jobRegistryDriver: 'sqlite' | 'pg' | 'redis';
  jobRegistryPath?: string;
  jobRegistryPgUrl?: string;
} {
  const config = scope === 'bot' ? loadBotConfig() : loadWorkerConfig();
  return {
    jobRegistryDriver: config.jobRegistryDriver,
    ...(config.jobRegistryPath ? { jobRegistryPath: config.jobRegistryPath } : {}),
    ...(config.jobRegistryPgUrl ? { jobRegistryPgUrl: config.jobRegistryPgUrl } : {}),
  };
}

function formatStatus(status: DbMigrationStatus): string {
  if (status.driver === 'redis') {
    return 'Job registry driver is redis. No SQL migrations are required.';
  }

  const lines = [
    `Driver: ${status.driver}`,
    `Applied migrations: ${status.appliedMigrations}`,
    `Expected migrations: ${status.expectedMigrations}`,
    `Pending migrations: ${status.pendingMigrations}`,
    `Up to date: ${status.isUpToDate ? 'yes' : 'no'}`,
  ];
  if (status.latestExpectedTag) {
    lines.push(`Latest expected migration: ${status.latestExpectedTag}`);
  }
  if (status.isAhead) {
    lines.push('Warning: DB migration table is ahead of local migration files.');
  }
  return lines.join('\n');
}

function writeJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function runStatus(scope: Scope, asJson: boolean, requireUpToDate: boolean): Promise<void> {
  const status = await getDbMigrationStatus(getRegistryConfig(scope));

  if (asJson) {
    writeJson({
      command: 'status',
      scope,
      status,
    });
  } else {
    process.stdout.write(`${formatStatus(status)}\n`);
  }

  if (requireUpToDate && !status.isUpToDate) {
    throw new Error(
      `Database is not up to date: ${status.pendingMigrations} pending migration(s) for ${status.driver}.`,
    );
  }
}

async function runMigrate(scope: Scope, asJson: boolean): Promise<void> {
  const status = await migrateDb(getRegistryConfig(scope));

  if (asJson) {
    writeJson({
      command: 'migrate',
      scope,
      status,
    });
  } else {
    if (status.driver === 'redis') {
      process.stdout.write('Job registry driver is redis. No SQL migrations were applied.\n');
      return;
    }
    process.stdout.write(`Applied migrations for ${status.driver}.\n`);
    process.stdout.write(`${formatStatus(status)}\n`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const jsonModeRequested = isJsonModeRequested(args);
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      scope: { type: 'string' },
      json: { type: 'boolean', default: false },
      'require-up-to-date': { type: 'boolean', default: false },
    },
  });

  const asJson = Boolean(parsed.values.json);
  const previousLoggerLevel = logger.level;
  if (asJson) {
    logger.level = 'silent';
  }

  const commandRaw = parsed.positionals[0];
  if (!commandRaw) {
    if (asJson || jsonModeRequested) {
      throw new Error('Missing db command. Expected "status" or "migrate".');
    }
    printUsage();
    process.exitCode = 1;
    return;
  }
  if (parsed.positionals.length > 1) {
    throw new Error(`Unexpected positional arguments: ${parsed.positionals.slice(1).join(' ')}`);
  }

  const command = commandRaw.trim().toLowerCase() as Command;
  const scope = parseScope(parsed.values.scope);
  const requireUpToDate = Boolean(parsed.values['require-up-to-date']);

  try {
    switch (command) {
      case 'status':
        await runStatus(scope, asJson, requireUpToDate);
        return;
      case 'migrate':
        await runMigrate(scope, asJson);
        return;
      default:
        throw new Error(`Unknown db command: ${commandRaw}`);
    }
  } finally {
    if (asJson) {
      logger.level = previousLoggerLevel;
    }
  }
}

const jsonModeRequested = isJsonModeRequested(process.argv.slice(2));

void main().catch((err) => {
  if (!jsonModeRequested) {
    logger.error({ err }, 'DB command failed');
  }
  process.stderr.write(`${(err as Error).message}\n`);
  if (!jsonModeRequested) {
    printUsage();
  }
  process.exitCode = 1;
});
