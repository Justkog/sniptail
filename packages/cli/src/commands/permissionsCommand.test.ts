import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

const hoisted = vi.hoisted(() => ({
  runRuntime: vi.fn(),
}));

vi.mock('../lib/runtime.js', () => ({
  runRuntime: hoisted.runRuntime,
}));

import { registerPermissionsCommand } from './permissionsCommand.js';

type RuntimeCall = {
  app: string;
  entrypoint: {
    source: string;
    dist: string;
  };
  configEnvVar: string;
  configPath?: string;
  envPath?: string;
  cwd?: string;
  root?: string;
  args: string[];
};

async function runPermissionsCommand(args: string[]): Promise<void> {
  const program = new Command();
  registerPermissionsCommand(program);
  await program.parseAsync(['permissions', ...args], { from: 'user' });
}

function getRuntimeCall(): RuntimeCall {
  const call = hoisted.runRuntime.mock.calls[0]?.[0] as RuntimeCall | undefined;
  if (!call) {
    throw new Error('Expected runRuntime to be called.');
  }
  return call;
}

describe('permissions command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.runRuntime.mockResolvedValue(undefined);
  });

  it('forwards explain arguments to the bot permissions runtime', async () => {
    await runPermissionsCommand([
      'explain',
      '--action',
      'jobs.implement',
      '--provider',
      'discord',
      '--channel-id',
      '123',
      '--user-id',
      '456',
      '--group-id',
      'role-1',
      '--group-id',
      'role-2',
      '--repo',
      'my-api',
      '--repo',
      'payments',
      '--thread-id',
      'thread-1',
      '--workspace-id',
      'workspace-1',
      '--guild-id',
      'guild-1',
      '--json',
      '--config',
      'bot.toml',
      '--env',
      '.env.local',
      '--cwd',
      '/srv/sniptail',
      '--root',
      '/opt/sniptail',
    ]);

    const call = getRuntimeCall();
    expect(call.app).toBe('bot');
    expect(call.entrypoint).toEqual({
      source: 'src/cli/permissions.ts',
      dist: 'dist/cli/permissions.js',
    });
    expect(call.configEnvVar).toBe('SNIPTAIL_BOT_CONFIG_PATH');
    expect(call.configPath).toBe('bot.toml');
    expect(call.envPath).toBe('.env.local');
    expect(call.cwd).toBe('/srv/sniptail');
    expect(call.root).toBe('/opt/sniptail');
    expect(call.args).toEqual([
      'explain',
      '--action',
      'jobs.implement',
      '--provider',
      'discord',
      '--channel-id',
      '123',
      '--user-id',
      '456',
      '--group-id',
      'role-1',
      '--group-id',
      'role-2',
      '--repo',
      'my-api',
      '--repo',
      'payments',
      '--thread-id',
      'thread-1',
      '--workspace-id',
      'workspace-1',
      '--guild-id',
      'guild-1',
      '--json',
    ]);
  });
});
