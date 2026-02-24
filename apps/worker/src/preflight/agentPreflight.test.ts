import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerConfig } from '@sniptail/core/config/types.js';

const hoisted = vi.hoisted(() => ({
  assertLocalCopilotPreflight: vi.fn(() => Promise.resolve(undefined)),
  assertLocalCodexPreflight: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('../copilot/copilotPreflight.js', () => ({
  assertLocalCopilotPreflight: hoisted.assertLocalCopilotPreflight,
}));

vi.mock('../codex/codexPreflight.js', () => ({
  assertLocalCodexPreflight: hoisted.assertLocalCodexPreflight,
}));

import { assertLocalAgentPreflight } from './agentPreflight.js';

function buildConfig(primaryAgent: WorkerConfig['primaryAgent']): WorkerConfig {
  return {
    repoAllowlist: {},
    jobWorkRoot: '/tmp/jobs',
    queueDriver: 'redis',
    jobRegistryDriver: 'redis',
    jobRegistryRedisUrl: 'redis://localhost:6379/1',
    botName: 'Sniptail',
    redisUrl: 'redis://localhost:6379/0',
    primaryAgent,
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

describe('agent preflight dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs codex preflight when selected agent is codex', async () => {
    const config = buildConfig('codex');
    await assertLocalAgentPreflight(config, 'codex');
    expect(hoisted.assertLocalCodexPreflight).toHaveBeenCalledTimes(1);
    expect(hoisted.assertLocalCodexPreflight).toHaveBeenCalledWith(config);
    expect(hoisted.assertLocalCopilotPreflight).not.toHaveBeenCalled();
  });

  it('runs copilot preflight when selected agent is copilot', async () => {
    const config = buildConfig('copilot');
    await assertLocalAgentPreflight(config, 'copilot');
    expect(hoisted.assertLocalCopilotPreflight).toHaveBeenCalledTimes(1);
    expect(hoisted.assertLocalCopilotPreflight).toHaveBeenCalledWith(config);
    expect(hoisted.assertLocalCodexPreflight).not.toHaveBeenCalled();
  });
});
