import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import { runWorkerDoctorPreflightChecks } from './doctorPreflightChecks.js';

function buildConfig(primaryAgent: WorkerConfig['primaryAgent'] = 'codex'): WorkerConfig {
  return {
    repoAllowlist: {},
    jobWorkRoot: '/tmp/jobs',
    queueDriver: 'redis',
    registryDriver: 'redis',
    registryRedisUrl: 'redis://localhost:6379/1',
    botName: 'Sniptail',
    workerId: 'default',
    redisUrl: 'redis://localhost:6379/0',
    primaryAgent,
    jobConcurrency: 2,
    consumeSharedWorkerEvents: true,
    workerEventConcurrency: 2,
    repoCacheRoot: '/tmp/repos',
    includeRawRequestInMr: false,
    copilot: {
      executionMode: 'local',
      idleRetries: 2,
      idleTimeoutMs: 300_000,
    },
    codex: {
      executionMode: 'local',
    },
    opencode: {
      executionMode: 'local',
      startupTimeoutMs: 10_000,
      dockerStreamLogs: false,
    },
    agentCommand: {
      enabled: false,
      interactionTimeoutMs: 600_000,
      outputDebounceMs: 1_000,
      workspaces: {},
      profiles: {},
    },
    runActions: {},
  };
}

function buildDeps() {
  return {
    getDockerModeAgents: vi.fn((): string[] => []),
    assertDockerPreflight: vi.fn(() => Promise.resolve()),
    assertLocalAgentPreflight: vi.fn(() => Promise.resolve()),
    assertGitCommitIdentityPreflight: vi.fn(() => Promise.resolve()),
  };
}

describe('worker doctor preflight checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['codex', 'copilot', 'opencode', 'acp'] as const)(
    'runs the selected %s agent preflight',
    async (agent) => {
      const config = buildConfig(agent);
      const deps = buildDeps();

      const report = await runWorkerDoctorPreflightChecks(config, deps);

      expect(deps.assertLocalAgentPreflight).toHaveBeenCalledWith(config, agent);
      expect(report.checks).toContainEqual({
        status: 'ok',
        area: 'agent',
        message: `Primary agent preflight passed for ${agent}.`,
      });
    },
  );

  it('reports docker not required without failing', async () => {
    const config = buildConfig();
    const deps = buildDeps();

    const report = await runWorkerDoctorPreflightChecks(config, deps);

    expect(deps.assertDockerPreflight).toHaveBeenCalledWith(config);
    expect(report.checks[0]).toEqual({
      status: 'ok',
      area: 'docker',
      message: 'Docker is not required by configured agent execution modes.',
    });
  });

  it('reports docker failure and continues to agent and git checks', async () => {
    const config = buildConfig();
    const deps = buildDeps();
    deps.getDockerModeAgents.mockReturnValue(['codex']);
    deps.assertDockerPreflight.mockRejectedValue(new Error('Docker preflight failed'));

    const report = await runWorkerDoctorPreflightChecks(config, deps);

    expect(report.checks).toMatchObject([
      {
        status: 'fail',
        area: 'docker',
        message: 'Docker preflight failed',
      },
      {
        status: 'ok',
        area: 'agent',
      },
      {
        status: 'ok',
        area: 'git identity',
      },
    ]);
  });

  it('reports git identity failures', async () => {
    const config = buildConfig();
    const deps = buildDeps();
    deps.assertGitCommitIdentityPreflight.mockRejectedValue(new Error('Git preflight failed'));

    const report = await runWorkerDoctorPreflightChecks(config, deps);

    expect(report.checks).toContainEqual({
      status: 'fail',
      area: 'git identity',
      message: 'Git preflight failed',
    });
  });

  it('uses opencode server area for OpenCode server reachability failures', async () => {
    const config = buildConfig('opencode');
    config.opencode.executionMode = 'server';
    config.opencode.serverUrl = 'http://127.0.0.1:4099';
    const deps = buildDeps();
    deps.assertLocalAgentPreflight.mockRejectedValue(new Error('OpenCode server failed'));

    const report = await runWorkerDoctorPreflightChecks(config, deps);

    expect(report.checks).toContainEqual({
      status: 'fail',
      area: 'opencode server',
      message: 'OpenCode server failed',
    });
  });

  it('returns multiple failures from one run', async () => {
    const config = buildConfig();
    const deps = buildDeps();
    deps.assertDockerPreflight.mockRejectedValue(new Error('Docker failed'));
    deps.assertLocalAgentPreflight.mockRejectedValue(new Error('Agent failed'));
    deps.assertGitCommitIdentityPreflight.mockRejectedValue(new Error('Git failed'));

    const report = await runWorkerDoctorPreflightChecks(config, deps);

    expect(report.checks).toMatchObject([
      { status: 'fail', area: 'docker', message: 'Docker failed' },
      { status: 'fail', area: 'agent', message: 'Agent failed' },
      { status: 'fail', area: 'git identity', message: 'Git failed' },
    ]);
  });
});
