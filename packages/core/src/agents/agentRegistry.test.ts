import { describe, expect, it, vi } from 'vitest';
import type { WorkerConfig } from '../config/types.js';

const hoisted = vi.hoisted(() => ({
  resolveWorkerAgentScriptPath: vi.fn((scriptName: string) => `/tmp/${scriptName}`),
}));

vi.mock('./resolveWorkerAgentScriptPath.js', () => ({
  resolveWorkerAgentScriptPath: hoisted.resolveWorkerAgentScriptPath,
}));

import { AGENT_DESCRIPTORS } from './agentRegistry.js';

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
      dockerfilePath: './Dockerfile.copilot',
      dockerImage: 'snatch-copilot:local',
      dockerBuildContext: '.',
    },
    codex: {
      executionMode: 'local',
    },
  };
}

describe('AGENT_DESCRIPTORS.copilot.buildRunOptions', () => {
  it('uses system copilot in local mode', () => {
    const config = buildConfig();
    config.copilot.executionMode = 'local';

    const options = AGENT_DESCRIPTORS.copilot.buildRunOptions(config);

    expect(options).toEqual({
      copilotIdleRetries: 2,
      copilot: {
        cliPath: 'copilot',
      },
    });
    expect(hoisted.resolveWorkerAgentScriptPath).not.toHaveBeenCalled();
  });

  it('uses worker docker wrapper in docker mode', () => {
    const config = buildConfig();
    config.copilot.executionMode = 'docker';

    const options = AGENT_DESCRIPTORS.copilot.buildRunOptions(config);

    expect(hoisted.resolveWorkerAgentScriptPath).toHaveBeenCalledWith('copilot-docker.sh');
    expect(options).toEqual({
      copilotIdleRetries: 2,
      copilot: {
        cliPath: '/tmp/copilot-docker.sh',
        docker: {
          enabled: true,
          dockerfilePath: './Dockerfile.copilot',
          image: 'snatch-copilot:local',
          buildContext: '.',
        },
      },
    });
  });
});
