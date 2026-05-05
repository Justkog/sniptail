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
      idleTimeoutMs: 300_000,
      dockerfilePath: './Dockerfile.copilot',
      dockerImage: 'snatch-copilot:local',
      dockerBuildContext: '.',
    },
    codex: {
      executionMode: 'local',
    },
    opencode: {
      executionMode: 'local',
      startupTimeoutMs: 10_000,
      dockerStreamLogs: false,
      dockerfilePath: './Dockerfile.opencode',
      dockerImage: 'snatch-opencode:local',
      dockerBuildContext: '.',
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
      copilotIdleTimeoutMs: 300_000,
      copilot: {},
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
      copilotIdleTimeoutMs: 300_000,
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

describe('AGENT_DESCRIPTORS.opencode', () => {
  it('resolves provider/model overrides', () => {
    const config = buildConfig();
    config.opencode.defaultModel = { provider: 'anthropic', model: 'claude-sonnet' };
    config.opencode.models = { ASK: { provider: 'openai', model: 'gpt-5' } };

    expect(AGENT_DESCRIPTORS.opencode.resolveModelConfig(config, 'ASK')).toEqual({
      modelProvider: 'openai',
      model: 'gpt-5',
    });
    expect(AGENT_DESCRIPTORS.opencode.resolveModelConfig(config, 'IMPLEMENT')).toEqual({
      modelProvider: 'anthropic',
      model: 'claude-sonnet',
    });
  });

  it('builds server options', () => {
    const config = buildConfig();
    config.opencode.executionMode = 'server';
    config.opencode.serverUrl = 'http://127.0.0.1:4096';
    config.opencode.serverAuthHeaderEnv = 'OPENCODE_AUTH_HEADER';
    config.opencode.agent = 'build';

    expect(AGENT_DESCRIPTORS.opencode.buildRunOptions(config)).toEqual({
      opencode: {
        executionMode: 'server',
        serverUrl: 'http://127.0.0.1:4096',
        serverAuthHeaderEnv: 'OPENCODE_AUTH_HEADER',
        agent: 'build',
        startupTimeoutMs: 10_000,
        dockerStreamLogs: false,
      },
    });
  });

  it('builds docker options and is discovered as docker mode', () => {
    const config = buildConfig();
    config.opencode.executionMode = 'docker';

    expect(AGENT_DESCRIPTORS.opencode.isDockerMode(config)).toBe(true);
    expect(AGENT_DESCRIPTORS.opencode.buildRunOptions(config)).toEqual({
      opencode: {
        executionMode: 'docker',
        startupTimeoutMs: 10_000,
        dockerStreamLogs: false,
        docker: {
          enabled: true,
          dockerfilePath: './Dockerfile.opencode',
          image: 'snatch-opencode:local',
          buildContext: '.',
        },
      },
    });
  });
});
