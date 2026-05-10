import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import type { Notifier } from '../channels/notifier.js';
import { runAcpAgentTurn } from './acpInteractiveAgent.js';

type MockLaunchOptions = {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  launch: {
    provider: 'acp';
    agent?: string;
    profile?: string;
    command: string[];
  };
  onRequestPermission?: (request: unknown) => void | Promise<unknown>;
  onSessionUpdate?: (notification: {
    update: { sessionUpdate: string; content?: { type: string; text: string } };
  }) => void | Promise<void>;
};

const hoisted = vi.hoisted(() => ({
  launchAcpRuntime: vi.fn(),
  loadAgentSession: vi.fn(),
  updateAgentSessionCodingAgentSessionId: vi.fn(),
  updateAgentSessionStatus: vi.fn(),
}));

vi.mock('@sniptail/core/acp/acpRuntime.js', () => ({
  launchAcpRuntime: hoisted.launchAcpRuntime,
}));

vi.mock('@sniptail/core/agent-sessions/registry.js', () => ({
  loadAgentSession: hoisted.loadAgentSession,
  updateAgentSessionCodingAgentSessionId: hoisted.updateAgentSessionCodingAgentSessionId,
  updateAgentSessionStatus: hoisted.updateAgentSessionStatus,
}));

function buildConfig(workspacePath: string): WorkerConfig {
  return {
    botName: 'Sniptail',
    queueDriver: 'inproc',
    jobRegistryDriver: 'sqlite',
    jobRegistryPath: ':memory:',
    repoAllowlist: {},
    jobWorkRoot: '/tmp/jobs',
    repoCacheRoot: '/tmp/repos',
    primaryAgent: 'opencode',
    jobConcurrency: 1,
    bootstrapConcurrency: 1,
    workerEventConcurrency: 1,
    copilot: {
      executionMode: 'local',
      idleRetries: 3,
      idleTimeoutMs: 300_000,
    },
    opencode: {
      executionMode: 'local',
      startupTimeoutMs: 10_000,
      dockerStreamLogs: false,
    },
    includeRawRequestInMr: false,
    agent: {
      enabled: true,
      defaultWorkspace: 'snatch',
      defaultAgentProfile: 'acp',
      interactionTimeoutMs: 1_800_000,
      outputDebounceMs: 1,
      workspaces: {
        snatch: {
          path: workspacePath,
          label: 'Snatch',
        },
      },
      profiles: {
        acp: {
          provider: 'acp',
          agent: 'opencode',
          profile: 'build',
          command: ['opencode', 'acp'],
          label: 'OpenCode ACP',
        },
      },
    },
    run: {
      actions: {},
    },
    codex: {
      executionMode: 'local',
    },
  };
}

function buildNotifier(): Notifier & { postMessage: ReturnType<typeof vi.fn> } {
  return {
    postMessage: vi.fn(),
    uploadFile: vi.fn(),
    addReaction: vi.fn(),
  };
}

function buildTurn(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'session-1',
    response: {
      provider: 'discord',
      channelId: 'thread-1',
      threadId: 'thread-1',
      userId: 'user-1',
    },
    prompt: 'inspect this',
    workspaceKey: 'snatch',
    profile: {
      key: 'acp',
      provider: 'acp',
      agent: 'opencode',
      profile: 'build',
      command: ['opencode', 'acp'],
      label: 'OpenCode ACP',
    },
    ...overrides,
  };
}

describe('ACP interactive agent', () => {
  let tempRoot: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempRoot = await mkdtemp(join(tmpdir(), 'sniptail-acp-agent-'));
    hoisted.loadAgentSession.mockResolvedValue({ status: 'active' });
    hoisted.updateAgentSessionStatus.mockResolvedValue(undefined);
    hoisted.updateAgentSessionCodingAgentSessionId.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('starts a new ACP session, stores its session id, and streams assistant output', async () => {
    const notifier = buildNotifier();
    const createSession = vi.fn().mockResolvedValue({ sessionId: 'acp-session-1' });
    const close = vi.fn().mockResolvedValue(undefined);

    hoisted.launchAcpRuntime.mockImplementationOnce((options: MockLaunchOptions) =>
      Promise.resolve({
        createSession,
        prompt: vi.fn(async () => {
          await options.onSessionUpdate?.({
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: 'Hello' },
            },
          });
          await options.onSessionUpdate?.({
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: ' world' },
            },
          });
          await options.onSessionUpdate?.({
            update: {
              sessionUpdate: 'tool_call_update',
            },
          });
          return {};
        }),
        close,
      }),
    );

    await runAcpAgentTurn({
      turn: buildTurn({ additionalDirectories: ['/tmp/context'] }),
      config: buildConfig(tempRoot),
      notifier,
      botEvents: { publish: vi.fn() },
      env: { ACP_TOKEN: 'secret' },
    });

    const launchOptions = hoisted.launchAcpRuntime.mock
      .calls[0]?.[0] as unknown as MockLaunchOptions;
    expect(launchOptions).toMatchObject({
      cwd: tempRoot,
      env: { ACP_TOKEN: 'secret' },
      launch: {
        provider: 'acp',
        agent: 'opencode',
        profile: 'build',
        command: ['opencode', 'acp'],
      },
    });
    expect(launchOptions.onRequestPermission).toEqual(expect.any(Function));
    expect(createSession).toHaveBeenCalledWith({
      cwd: tempRoot,
      additionalDirectories: ['/tmp/context'],
    });
    expect(hoisted.updateAgentSessionCodingAgentSessionId).toHaveBeenCalledWith(
      'session-1',
      'acp-session-1',
    );
    expect(hoisted.updateAgentSessionStatus).toHaveBeenCalledWith('session-1', 'active');
    expect(hoisted.updateAgentSessionStatus).toHaveBeenCalledWith('session-1', 'completed');
    expect(notifier.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'thread-1' }),
      'Hello world',
    );
    expect(close).toHaveBeenCalled();
  });

  it('fails clearly when asked to continue an existing ACP session before session/load support exists', async () => {
    const notifier = buildNotifier();

    await runAcpAgentTurn({
      turn: buildTurn({ codingAgentSessionId: 'acp-session-9' }),
      config: buildConfig(tempRoot),
      notifier,
      botEvents: { publish: vi.fn() },
      env: {},
    });

    expect(hoisted.launchAcpRuntime).not.toHaveBeenCalled();
    expect(hoisted.updateAgentSessionStatus).toHaveBeenCalledWith('session-1', 'failed');
    expect(notifier.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'thread-1' }),
      'ACP agent session failed: ACP session continuation is not implemented yet.',
    );
  });
});
