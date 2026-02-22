import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

const hoisted = vi.hoisted(() => ({
  assertDbMigrationsUpToDate: vi.fn(),
  runRuntime: vi.fn(),
}));

vi.mock('../lib/db.js', () => ({
  assertDbMigrationsUpToDate: hoisted.assertDbMigrationsUpToDate,
}));

vi.mock('../lib/runtime.js', () => ({
  runRuntime: hoisted.runRuntime,
}));

import { registerBotCommand } from './bot.js';
import { registerWorkerCommand } from './worker.js';

async function runCommand(args: string[]): Promise<void> {
  const program = new Command();
  registerBotCommand(program);
  registerWorkerCommand(program);
  await program.parseAsync(args, { from: 'user' });
}

describe('bot/worker migration checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.assertDbMigrationsUpToDate.mockResolvedValue(undefined);
    hoisted.runRuntime.mockResolvedValue(undefined);
  });

  it('fails `bot` startup when migration check fails', async () => {
    hoisted.assertDbMigrationsUpToDate.mockRejectedValueOnce(
      new Error('Database is not up to date for bot: 3 pending migration(s) (sqlite).'),
    );

    await expect(runCommand(['bot'])).rejects.toThrow(
      'Database is not up to date for bot: 3 pending migration(s) (sqlite).',
    );
    expect(hoisted.runRuntime).not.toHaveBeenCalled();
  });

  it('fails `worker` startup when migration check fails', async () => {
    hoisted.assertDbMigrationsUpToDate.mockRejectedValueOnce(
      new Error('Database is not up to date for worker: 3 pending migration(s) (sqlite).'),
    );

    await expect(runCommand(['worker'])).rejects.toThrow(
      'Database is not up to date for worker: 3 pending migration(s) (sqlite).',
    );
    expect(hoisted.runRuntime).not.toHaveBeenCalled();
  });

  it('skips migration check for bot dry-run', async () => {
    await runCommand(['bot', '--dry-run']);
    expect(hoisted.assertDbMigrationsUpToDate).not.toHaveBeenCalled();
    expect(hoisted.runRuntime).toHaveBeenCalledTimes(1);
  });
});
