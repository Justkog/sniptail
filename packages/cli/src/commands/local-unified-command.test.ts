import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

const hoisted = vi.hoisted(() => ({
  getDbMigrationStatus: vi.fn(),
  migrateDb: vi.fn(),
  runRuntime: vi.fn(),
  createInterface: vi.fn(),
}));

vi.mock('../lib/db.js', () => ({
  getDbMigrationStatus: hoisted.getDbMigrationStatus,
  migrateDb: hoisted.migrateDb,
}));

vi.mock('../lib/runtime.js', () => ({
  runRuntime: hoisted.runRuntime,
}));

vi.mock('node:readline/promises', () => ({
  createInterface: hoisted.createInterface,
}));

import { registerLocalUnifiedCommand } from './localUnified.js';

const stdinIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
const stdoutIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

function setInteractive(isInteractive: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', {
    value: isInteractive,
    configurable: true,
  });
  Object.defineProperty(process.stdout, 'isTTY', {
    value: isInteractive,
    configurable: true,
  });
}

function restoreTtyDescriptors(): void {
  if (stdinIsTTYDescriptor) {
    Object.defineProperty(process.stdin, 'isTTY', stdinIsTTYDescriptor);
  }
  if (stdoutIsTTYDescriptor) {
    Object.defineProperty(process.stdout, 'isTTY', stdoutIsTTYDescriptor);
  }
}

type MigrationStatus = {
  driver: 'sqlite' | 'pg' | 'redis';
  expectedMigrations: number;
  appliedMigrations: number;
  pendingMigrations: number;
  isUpToDate: boolean;
  isAhead: boolean;
};

function status(overrides: Partial<MigrationStatus> = {}): MigrationStatus {
  return {
    driver: 'sqlite' as const,
    expectedMigrations: 3,
    appliedMigrations: 3,
    pendingMigrations: 0,
    isUpToDate: true,
    isAhead: false,
    ...overrides,
  };
}

async function runLocalCommand(args: string[] = []): Promise<void> {
  const program = new Command();
  registerLocalUnifiedCommand(program);
  await program.parseAsync(['local', ...args], { from: 'user' });
}

describe('local command migration flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setInteractive(false);
    hoisted.runRuntime.mockResolvedValue(undefined);
    hoisted.migrateDb.mockResolvedValue(status());
    hoisted.createInterface.mockReturnValue({
      question: vi.fn().mockResolvedValue('n'),
      close: vi.fn(),
    });
  });

  afterEach(() => {
    restoreTtyDescriptors();
  });

  afterAll(() => {
    restoreTtyDescriptors();
  });

  it('prompts and migrates when interactive and user confirms', async () => {
    setInteractive(true);
    hoisted.getDbMigrationStatus
      .mockResolvedValueOnce(
        status({ pendingMigrations: 3, appliedMigrations: 0, isUpToDate: false }),
      )
      .mockResolvedValueOnce(status());

    const question = vi.fn().mockResolvedValue('y');
    const close = vi.fn();
    hoisted.createInterface.mockReturnValue({ question, close });

    await runLocalCommand();

    expect(hoisted.migrateDb).toHaveBeenCalledTimes(1);
    expect(hoisted.migrateDb).toHaveBeenCalledWith('bot', {
      envOverrides: {
        QUEUE_DRIVER: 'inproc',
        JOB_REGISTRY_DB: 'sqlite',
      },
    });
    expect(hoisted.runRuntime).toHaveBeenCalledTimes(1);
    expect(question).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('treats empty interactive response as yes and migrates', async () => {
    setInteractive(true);
    hoisted.getDbMigrationStatus
      .mockResolvedValueOnce(
        status({ pendingMigrations: 3, appliedMigrations: 0, isUpToDate: false }),
      )
      .mockResolvedValueOnce(status());

    const question = vi.fn().mockResolvedValue('');
    hoisted.createInterface.mockReturnValue({ question, close: vi.fn() });

    await runLocalCommand();

    expect(hoisted.migrateDb).toHaveBeenCalledTimes(1);
    expect(hoisted.runRuntime).toHaveBeenCalledTimes(1);
  });

  it('fails with concise hint when interactive user declines', async () => {
    setInteractive(true);
    hoisted.getDbMigrationStatus
      .mockResolvedValueOnce(
        status({ pendingMigrations: 2, appliedMigrations: 1, isUpToDate: false }),
      )
      .mockResolvedValueOnce(status());

    await expect(runLocalCommand()).rejects.toThrow('--migrate-if-needed');
    expect(hoisted.migrateDb).not.toHaveBeenCalled();
    expect(hoisted.runRuntime).not.toHaveBeenCalled();
  });

  it('fails in non-interactive mode without --migrate-if-needed', async () => {
    hoisted.getDbMigrationStatus
      .mockResolvedValueOnce(
        status({ pendingMigrations: 3, appliedMigrations: 0, isUpToDate: false }),
      )
      .mockResolvedValueOnce(
        status({ pendingMigrations: 1, appliedMigrations: 2, isUpToDate: false }),
      );

    await expect(runLocalCommand()).rejects.toThrow('--migrate-if-needed');
    expect(hoisted.createInterface).not.toHaveBeenCalled();
    expect(hoisted.migrateDb).not.toHaveBeenCalled();
    expect(hoisted.runRuntime).not.toHaveBeenCalled();
  });

  it('auto-migrates in non-interactive mode with --migrate-if-needed', async () => {
    hoisted.getDbMigrationStatus
      .mockResolvedValueOnce(
        status({ pendingMigrations: 3, appliedMigrations: 0, isUpToDate: false }),
      )
      .mockResolvedValueOnce(
        status({ pendingMigrations: 1, appliedMigrations: 2, isUpToDate: false }),
      );

    await runLocalCommand(['--migrate-if-needed']);

    expect(hoisted.createInterface).not.toHaveBeenCalled();
    expect(hoisted.migrateDb).toHaveBeenCalledTimes(2);
    expect(hoisted.runRuntime).toHaveBeenCalledTimes(1);
  });

  it('starts immediately when migrations are already up to date', async () => {
    hoisted.getDbMigrationStatus.mockResolvedValue(status());

    await runLocalCommand();

    expect(hoisted.getDbMigrationStatus).toHaveBeenCalledTimes(2);
    expect(hoisted.migrateDb).not.toHaveBeenCalled();
    expect(hoisted.runRuntime).toHaveBeenCalledTimes(1);
  });
});
