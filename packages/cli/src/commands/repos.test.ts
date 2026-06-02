import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

const hoisted = vi.hoisted(() => ({
  runRuntime: vi.fn(),
}));

vi.mock('../lib/runtime.js', () => ({
  runRuntime: hoisted.runRuntime,
}));

import { registerReposCommand } from './repos.js';

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

async function runReposCommand(args: string[]): Promise<void> {
  const program = new Command();
  registerReposCommand(program);
  await program.parseAsync(['repos', ...args], { from: 'user' });
}

function getRuntimeCall(): RuntimeCall {
  const call = hoisted.runRuntime.mock.calls[0]?.[0] as RuntimeCall | undefined;
  if (!call) {
    throw new Error('Expected runRuntime to be called.');
  }
  return call;
}

describe('repos command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.runRuntime.mockResolvedValue(undefined);
  });

  it('forwards inspect arguments to the worker repos runtime', async () => {
    await runReposCommand([
      'inspect',
      'my-api',
      '--json',
      '--config',
      'worker.toml',
      '--env',
      '.env.local',
      '--cwd',
      '/srv/sniptail',
      '--root',
      '/opt/sniptail',
    ]);

    const call = getRuntimeCall();
    expect(call.app).toBe('worker');
    expect(call.entrypoint).toEqual({
      source: 'src/cli/repos.ts',
      dist: 'dist/cli/repos.js',
    });
    expect(call.configEnvVar).toBe('SNIPTAIL_WORKER_CONFIG_PATH');
    expect(call.configPath).toBe('worker.toml');
    expect(call.envPath).toBe('.env.local');
    expect(call.cwd).toBe('/srv/sniptail');
    expect(call.root).toBe('/opt/sniptail');
    expect(call.args).toEqual(['inspect', 'my-api', '--json']);
  });

  it('forwards validate arguments to the worker repos runtime', async () => {
    await runReposCommand([
      'validate',
      'my-api',
      '--json',
      '--config',
      'worker.toml',
      '--env',
      '.env.local',
      '--cwd',
      '/srv/sniptail',
      '--root',
      '/opt/sniptail',
    ]);

    const call = getRuntimeCall();
    expect(call.app).toBe('worker');
    expect(call.entrypoint).toEqual({
      source: 'src/cli/repos.ts',
      dist: 'dist/cli/repos.js',
    });
    expect(call.configEnvVar).toBe('SNIPTAIL_WORKER_CONFIG_PATH');
    expect(call.configPath).toBe('worker.toml');
    expect(call.envPath).toBe('.env.local');
    expect(call.cwd).toBe('/srv/sniptail');
    expect(call.root).toBe('/opt/sniptail');
    expect(call.args).toEqual(['validate', 'my-api', '--json']);
  });
});
