import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  runRuntimeCapture: vi.fn(),
}));

vi.mock('./runtime.js', () => ({
  runRuntimeCapture: hoisted.runRuntimeCapture,
}));

import { assertDbMigrationsUpToDate, getDbMigrationStatus, migrateDb } from './db.js';

type MigrationStatus = {
  driver: 'sqlite' | 'pg' | 'redis';
  expectedMigrations: number;
  appliedMigrations: number;
  pendingMigrations: number;
  isUpToDate: boolean;
  isAhead: boolean;
};

type DbPayload = {
  command: 'status' | 'migrate';
  scope: 'bot' | 'worker';
  status: MigrationStatus;
};

function buildStatus(overrides: Partial<MigrationStatus> = {}): MigrationStatus {
  return {
    driver: 'sqlite' as const,
    expectedMigrations: 3,
    appliedMigrations: 0,
    pendingMigrations: 3,
    isUpToDate: false,
    isAhead: false,
    ...overrides,
  };
}

function buildPayload(
  command: 'status' | 'migrate',
  scope: 'bot' | 'worker',
  status = buildStatus(),
): DbPayload {
  return {
    command,
    scope,
    status,
  };
}

describe('db migration helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses pending status output from db status JSON', async () => {
    hoisted.runRuntimeCapture.mockResolvedValueOnce({
      exitCode: 0,
      stdout: JSON.stringify(buildPayload('status', 'worker')),
      stderr: '',
    });

    const status = await getDbMigrationStatus('worker', {});

    expect(status.pendingMigrations).toBe(3);
    expect(status.isUpToDate).toBe(false);
    expect(hoisted.runRuntimeCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        app: 'worker',
        args: ['status', '--json', '--scope', 'worker'],
      }),
    );
  });

  it('parses migrate output from db migrate JSON', async () => {
    hoisted.runRuntimeCapture.mockResolvedValueOnce({
      exitCode: 0,
      stdout: JSON.stringify(
        buildPayload(
          'migrate',
          'bot',
          buildStatus({
            appliedMigrations: 3,
            pendingMigrations: 0,
            isUpToDate: true,
          }),
        ),
      ),
      stderr: '',
    });

    const status = await migrateDb('bot', {});
    expect(status.isUpToDate).toBe(true);
    expect(status.pendingMigrations).toBe(0);
  });

  it('throws a concise error when child exits non-zero', async () => {
    hoisted.runRuntimeCapture.mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: [
        '[2026-02-22 22:02:48.285 +0100] ERROR (130521): DB command failed',
        'JOB_REGISTRY_PATH is required when JOB_REGISTRY_DB=sqlite',
        'Usage: db <status|migrate> [options]',
      ].join('\n'),
    });

    await expect(getDbMigrationStatus('worker', {})).rejects.toThrow(
      'Failed to check database migrations for worker: JOB_REGISTRY_PATH is required when JOB_REGISTRY_DB=sqlite',
    );
  });

  it('throws when db command returns malformed JSON', async () => {
    hoisted.runRuntimeCapture.mockResolvedValueOnce({
      exitCode: 0,
      stdout: 'not json',
      stderr: '',
    });

    await expect(getDbMigrationStatus('worker', {})).rejects.toThrow(
      'Database status command returned invalid JSON output for worker.',
    );
  });

  it('throws concise actionable error when migrations are pending', async () => {
    hoisted.runRuntimeCapture.mockResolvedValueOnce({
      exitCode: 0,
      stdout: JSON.stringify(buildPayload('status', 'bot')),
      stderr: '',
    });

    await expect(assertDbMigrationsUpToDate('bot', {})).rejects.toThrow(
      'Run "sniptail db migrate --scope bot" to apply migrations.',
    );
  });
});
