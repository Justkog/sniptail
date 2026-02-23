import { describe, expect, it, vi } from 'vitest';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import { assertLocalCopilotPreflight } from './copilotPreflight.js';

function buildConfig(): WorkerConfig {
  return {
    repoAllowlist: {},
    jobWorkRoot: '/tmp/jobs',
    queueDriver: 'redis',
    jobRegistryDriver: 'redis',
    jobRegistryRedisUrl: 'redis://localhost:6379/1',
    botName: 'Sniptail',
    redisUrl: 'redis://localhost:6379/0',
    primaryAgent: 'codex',
    jobConcurrency: 2,
    bootstrapConcurrency: 2,
    workerEventConcurrency: 2,
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

describe('copilot preflight', () => {
  it('checks copilot when copilot execution mode is local', async () => {
    const runExec = vi.fn().mockResolvedValue({ stdout: 'copilot 0.0.394', stderr: '' });
    await assertLocalCopilotPreflight(buildConfig(), runExec);
    expect(runExec).toHaveBeenCalledWith('copilot', ['--version']);
  });

  it('skips check when copilot execution mode is docker', async () => {
    const config = buildConfig();
    config.copilot.executionMode = 'docker';
    const runExec = vi.fn();
    await assertLocalCopilotPreflight(config, runExec);
    expect(runExec).not.toHaveBeenCalled();
  });

  it('fails fast with actionable guidance when copilot is unavailable', async () => {
    const runExec = vi.fn().mockRejectedValue(
      Object.assign(new Error('failed to run copilot'), {
        stderr: 'copilot: command not found',
      }),
    );

    await expect(assertLocalCopilotPreflight(buildConfig(), runExec)).rejects.toThrow(
      'Copilot preflight failed',
    );
    await expect(assertLocalCopilotPreflight(buildConfig(), runExec)).rejects.toThrow(
      '[copilot].execution_mode="local"',
    );
    await expect(assertLocalCopilotPreflight(buildConfig(), runExec)).rejects.toThrow(
      'npm install -g @github/copilot',
    );
    await expect(assertLocalCopilotPreflight(buildConfig(), runExec)).rejects.toThrow(
      'copilot --version',
    );
    await expect(assertLocalCopilotPreflight(buildConfig(), runExec)).rejects.toThrow(
      'copilot: command not found',
    );
  });
});
