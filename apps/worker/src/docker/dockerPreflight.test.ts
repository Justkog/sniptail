import { describe, expect, it, vi } from 'vitest';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import { assertDockerPreflight } from './dockerPreflight.js';

function buildConfig(): WorkerConfig {
  return {
    repoAllowlist: {},
    jobWorkRoot: '/tmp/jobs',
    jobRegistryDriver: 'redis',
    jobRegistryRedisUrl: 'redis://localhost:6379/1',
    botName: 'Sniptail',
    redisUrl: 'redis://localhost:6379/0',
    primaryAgent: 'codex',
    repoCacheRoot: '/tmp/repos',
    includeRawRequestInMr: false,
    copilot: {
      executionMode: 'local',
      idleRetries: 2,
    },
    codex: {
      executionMode: 'local',
    },
  };
}

describe('docker preflight', () => {
  it('skips docker check when all agents are local', async () => {
    const runExec = vi.fn();
    await assertDockerPreflight(buildConfig(), runExec);
    expect(runExec).not.toHaveBeenCalled();
  });

  it('checks docker access when at least one agent uses docker', async () => {
    const config = buildConfig();
    config.codex.executionMode = 'docker';
    const runExec = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    await assertDockerPreflight(config, runExec);
    expect(runExec).toHaveBeenCalledWith('docker', ['ps']);
  });

  it('fails fast with actionable guidance when docker is not accessible', async () => {
    const config = buildConfig();
    config.codex.executionMode = 'docker';
    config.copilot.executionMode = 'docker';
    const runExec = vi.fn().mockRejectedValue(
      Object.assign(new Error('failed to run docker'), {
        stderr:
          'permission denied while trying to connect to the docker API at unix:///var/run/docker.sock',
      }),
    );

    await expect(assertDockerPreflight(config, runExec)).rejects.toThrow('Docker preflight failed');
    await expect(assertDockerPreflight(config, runExec)).rejects.toThrow(
      '[codex].execution_mode="docker"',
    );
    await expect(assertDockerPreflight(config, runExec)).rejects.toThrow(
      '[copilot].execution_mode="docker"',
    );
    await expect(assertDockerPreflight(config, runExec)).rejects.toThrow('docker ps');
    await expect(assertDockerPreflight(config, runExec)).rejects.toThrow(
      'execution_mode to "local"',
    );
    await expect(assertDockerPreflight(config, runExec)).rejects.toThrow(
      'permission denied while trying to connect to the docker API',
    );
  });
});
