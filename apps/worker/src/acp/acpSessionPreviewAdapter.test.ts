import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionNotification } from '@agentclientprotocol/sdk';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import type { ResolvedAgentWorkspace } from '../agent-command/workspaceResolver.js';

const hoisted = vi.hoisted(() => ({
  launchAcpRuntime: vi.fn(),
  loadSession: vi.fn(),
  close: vi.fn(() => Promise.resolve()),
  onSessionUpdate: undefined as ((notification: SessionNotification) => void) | undefined,
}));

vi.mock('@sniptail/core/acp/acpRuntime.js', () => ({
  launchAcpRuntime: hoisted.launchAcpRuntime,
}));

import { acpAgentSessionPreviewAdapter } from './acpSessionPreviewAdapter.js';

function buildConfig(): WorkerConfig {
  return {
    repoAllowlist: {},
    jobWorkRoot: '/tmp/jobs',
    queueDriver: 'redis',
    registryDriver: 'redis',
    registryRedisUrl: 'redis://localhost:6379/1',
    botName: 'Sniptail',
    workerId: 'worker-a',
    redisUrl: 'redis://localhost:6379/0',
    primaryAgent: 'codex',
    jobConcurrency: 2,
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
    agent: {
      enabled: true,
      interactionTimeoutMs: 300_000,
      outputDebounceMs: 1_000,
      workspaces: {},
      profiles: {},
    },
  };
}

function buildResolvedWorkspace(): ResolvedAgentWorkspace {
  return {
    workspaceKey: 'snatch',
    workspaceRoot: '/tmp/snatch',
    resolvedCwd: '/tmp/snatch/apps/worker',
    relativeCwd: 'apps/worker',
    display: {
      workspaceKey: 'snatch',
      name: 'snatch / apps/worker',
      cwd: 'apps/worker',
    },
  };
}

function textNotification(
  sessionUpdate: 'agent_message_chunk' | 'user_message_chunk',
  text: string,
): SessionNotification {
  return {
    sessionId: 'acp-session-1',
    update: {
      sessionUpdate,
      content: { type: 'text', text },
    },
  };
}

describe('acpSessionPreviewAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.onSessionUpdate = undefined;
    hoisted.launchAcpRuntime.mockImplementation(
      (options: { onSessionUpdate?: typeof hoisted.onSessionUpdate }) => {
        hoisted.onSessionUpdate = options.onSessionUpdate;
        return Promise.resolve({
          loadSession: hoisted.loadSession,
          close: hoisted.close,
        });
      },
    );
    hoisted.loadSession.mockResolvedValue({ sessionId: 'acp-session-1' });
  });

  it('loads ACP and returns the latest agent message', async () => {
    const resolvedWorkspace = buildResolvedWorkspace();
    hoisted.loadSession.mockImplementation(() => {
      hoisted.onSessionUpdate?.(textNotification('agent_message_chunk', 'First '));
      hoisted.onSessionUpdate?.(textNotification('agent_message_chunk', 'answer'));
      return Promise.resolve({ sessionId: 'acp-session-1' });
    });

    const result = await acpAgentSessionPreviewAdapter.previewSession({
      config: buildConfig(),
      profile: {
        key: 'acp-build',
        provider: 'acp',
        agent: 'opencode',
        command: ['opencode', 'acp'],
      },
      providerSessionId: 'acp-session-1',
      workspaceKey: 'snatch',
      cwd: 'apps/worker',
      resolvedWorkspace,
    });

    expect(hoisted.launchAcpRuntime).toHaveBeenCalledWith({
      launch: {
        key: 'acp-build',
        provider: 'acp',
        agent: 'opencode',
        command: ['opencode', 'acp'],
      },
      cwd: resolvedWorkspace.resolvedCwd,
      diagnostics: {
        configSource: 'agent.profiles.acp-build',
      },
      onSessionUpdate: expect.any(Function) as unknown,
    });
    expect(hoisted.loadSession).toHaveBeenCalledWith('acp-session-1', {
      cwd: resolvedWorkspace.resolvedCwd,
      applySessionOverrides: false,
    });
    expect(result).toEqual({
      message: {
        role: 'agent',
        text: 'First answer',
      },
    });
    expect(hoisted.close).toHaveBeenCalledTimes(1);
  });

  it('returns the latest user message when it is replayed last', async () => {
    hoisted.loadSession.mockImplementation(() => {
      hoisted.onSessionUpdate?.(textNotification('agent_message_chunk', 'Done'));
      hoisted.onSessionUpdate?.(textNotification('user_message_chunk', 'One more thing'));
      return Promise.resolve({ sessionId: 'acp-session-1' });
    });

    const result = await acpAgentSessionPreviewAdapter.previewSession({
      config: buildConfig(),
      profile: {
        key: 'acp-build',
        provider: 'acp',
        command: ['opencode', 'acp'],
      },
      providerSessionId: 'acp-session-1',
    });

    expect(hoisted.loadSession).toHaveBeenCalledWith('acp-session-1', {
      cwd: '/tmp/repos',
      applySessionOverrides: false,
    });
    expect(result).toEqual({
      message: {
        role: 'user',
        text: 'One more thing',
      },
    });
  });

  it('starts a new preview message when the replayed role changes', async () => {
    hoisted.loadSession.mockImplementation(() => {
      hoisted.onSessionUpdate?.(textNotification('agent_message_chunk', 'Old'));
      hoisted.onSessionUpdate?.(textNotification('user_message_chunk', 'Request '));
      hoisted.onSessionUpdate?.(textNotification('user_message_chunk', 'follow-up'));
      hoisted.onSessionUpdate?.(textNotification('agent_message_chunk', 'New'));
      return Promise.resolve({ sessionId: 'acp-session-1' });
    });

    const result = await acpAgentSessionPreviewAdapter.previewSession({
      config: buildConfig(),
      profile: {
        key: 'acp-build',
        provider: 'acp',
        command: ['opencode', 'acp'],
      },
      providerSessionId: 'acp-session-1',
    });

    expect(result).toEqual({
      message: {
        role: 'agent',
        text: 'New',
      },
    });
  });

  it('returns an error when no text message is replayed', async () => {
    hoisted.loadSession.mockImplementation(() => {
      hoisted.onSessionUpdate?.({
        sessionId: 'acp-session-1',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'resource_link', uri: 'file:///tmp/report.md', name: 'report' },
        },
      });
      return Promise.resolve({ sessionId: 'acp-session-1' });
    });

    const result = await acpAgentSessionPreviewAdapter.previewSession({
      config: buildConfig(),
      profile: {
        key: 'acp-build',
        provider: 'acp',
        command: ['opencode', 'acp'],
      },
      providerSessionId: 'acp-session-1',
    });

    expect(result.errorMessage).toContain('No text message');
    expect(hoisted.close).toHaveBeenCalledTimes(1);
  });

  it('closes the runtime when loading fails', async () => {
    hoisted.loadSession.mockRejectedValue(new Error('load failed'));

    await expect(
      acpAgentSessionPreviewAdapter.previewSession({
        config: buildConfig(),
        profile: {
          key: 'acp-build',
          provider: 'acp',
          command: ['opencode', 'acp'],
        },
        providerSessionId: 'acp-session-1',
      }),
    ).rejects.toThrow('load failed');
    expect(hoisted.close).toHaveBeenCalledTimes(1);
  });
});
