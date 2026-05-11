import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import type { Notifier } from '../channels/notifier.js';
import { runAcpAgentTurn, steerAcpAgentTurn } from './acpInteractiveAgent.js';
import { clearAgentPromptTurns } from '../agent-command/activeAgentPromptTurns.js';
import { clearActiveAcpRuntimes, getActiveAcpRuntime } from './acpInteractionState.js';

type MockLaunchOptions = {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  diagnostics?: {
    configSource?: string;
  };
  launch: {
    provider: 'acp';
    agent?: string;
    profile?: string;
    command: string[];
  };
  cancel?: () => Promise<void>;
  onRequestPermission?: (request: unknown) => void | Promise<unknown>;
  onCreateElicitation?: (request: unknown) => void | Promise<unknown>;
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
    clearActiveAcpRuntimes();
    clearAgentPromptTurns();
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('starts a new ACP session, stores its session id, and streams assistant output', async () => {
    const notifier = buildNotifier();
    const createSession = vi.fn().mockResolvedValue({ sessionId: 'acp-session-1' });
    const loadSession = vi.fn();
    const cancel = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);

    hoisted.launchAcpRuntime.mockImplementationOnce((options: MockLaunchOptions) =>
      Promise.resolve({
        createSession,
        loadSession,
        cancel,
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
      diagnostics: {
        configSource: 'agent.profiles.acp',
      },
      launch: {
        provider: 'acp',
        agent: 'opencode',
        profile: 'build',
        command: ['opencode', 'acp'],
      },
    });
    expect(launchOptions.onRequestPermission).toEqual(expect.any(Function));
    expect(launchOptions.onCreateElicitation).toEqual(expect.any(Function));
    expect(createSession).toHaveBeenCalledWith({
      cwd: tempRoot,
      additionalDirectories: ['/tmp/context'],
    });
    expect(loadSession).not.toHaveBeenCalled();
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
    expect(getActiveAcpRuntime('session-1')).toBeUndefined();
    expect(close).toHaveBeenCalled();
  });

  it('streams only new assistant text snapshots during a single prompt turn', async () => {
    const notifier = buildNotifier();
    const createSession = vi.fn().mockResolvedValue({ sessionId: 'acp-session-1' });
    const loadSession = vi.fn();
    const cancel = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);

    hoisted.launchAcpRuntime.mockImplementationOnce((options: MockLaunchOptions) =>
      Promise.resolve({
        createSession,
        loadSession,
        cancel,
        prompt: vi.fn(async () => {
          await options.onSessionUpdate?.({
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: 'Hello' },
            },
          });
          await new Promise((resolve) => setTimeout(resolve, 5));
          await options.onSessionUpdate?.({
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: ' world' },
            },
          });
          return {};
        }),
        close,
      }),
    );

    await runAcpAgentTurn({
      turn: buildTurn(),
      config: buildConfig(tempRoot),
      notifier,
      botEvents: { publish: vi.fn() },
      env: {},
    });

    expect(notifier.postMessage.mock.calls).toEqual([
      [expect.objectContaining({ channelId: 'thread-1' }), 'Hello'],
      [expect.objectContaining({ channelId: 'thread-1' }), ' world'],
    ]);
  });

  it('loads an existing ACP session for follow-up turns and streams assistant output', async () => {
    const notifier = buildNotifier();
    const createSession = vi.fn();
    const loadSession = vi.fn();
    const cancel = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);

    hoisted.launchAcpRuntime.mockImplementationOnce((options: MockLaunchOptions) =>
      Promise.resolve({
        createSession,
        loadSession: loadSession.mockImplementation(async () => {
          await options.onSessionUpdate?.({
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: 'Earlier answer' },
            },
          });
          return { sessionId: 'acp-session-9' };
        }),
        cancel,
        prompt: vi.fn(async () => {
          await options.onSessionUpdate?.({
            update: {
              sessionUpdate: 'agent_message_chunk',
              content: { type: 'text', text: 'Resumed' },
            },
          });
          return {};
        }),
        close,
      }),
    );

    await runAcpAgentTurn({
      turn: buildTurn({ codingAgentSessionId: 'acp-session-9' }),
      config: buildConfig(tempRoot),
      notifier,
      botEvents: { publish: vi.fn() },
      env: {},
    });

    const launchOptions = hoisted.launchAcpRuntime.mock
      .calls[0]?.[0] as unknown as MockLaunchOptions;
    expect(launchOptions).toMatchObject({
      cwd: tempRoot,
      diagnostics: {
        configSource: 'agent.profiles.acp',
      },
      launch: {
        provider: 'acp',
        agent: 'opencode',
        profile: 'build',
        command: ['opencode', 'acp'],
      },
    });
    expect(createSession).not.toHaveBeenCalled();
    expect(loadSession).toHaveBeenCalledWith('acp-session-9', { cwd: tempRoot });
    expect(hoisted.updateAgentSessionCodingAgentSessionId).not.toHaveBeenCalled();
    expect(hoisted.updateAgentSessionStatus).toHaveBeenCalledWith('session-1', 'active');
    expect(hoisted.updateAgentSessionStatus).toHaveBeenCalledWith('session-1', 'completed');
    expect(notifier.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'thread-1' }),
      'Resumed',
    );
    expect(notifier.postMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'thread-1' }),
      expect.stringContaining('Earlier answer'),
    );
    expect(close).toHaveBeenCalled();
  });

  it('surfaces ACP session/load failures through the normal agent failure path', async () => {
    const notifier = buildNotifier();
    const createSession = vi.fn();
    const loadSession = vi
      .fn()
      .mockRejectedValue(
        new Error('ACP agent does not support session/load; cannot load session acp-session-9.'),
      );
    const cancel = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);

    hoisted.launchAcpRuntime.mockResolvedValueOnce({
      createSession,
      loadSession,
      cancel,
      prompt: vi.fn(),
      close,
    });

    await runAcpAgentTurn({
      turn: buildTurn({ codingAgentSessionId: 'acp-session-9' }),
      config: buildConfig(tempRoot),
      notifier,
      botEvents: { publish: vi.fn() },
      env: {},
    });

    expect(createSession).not.toHaveBeenCalled();
    expect(loadSession).toHaveBeenCalledWith('acp-session-9', { cwd: tempRoot });
    expect(hoisted.updateAgentSessionCodingAgentSessionId).not.toHaveBeenCalled();
    expect(hoisted.updateAgentSessionStatus).toHaveBeenCalledWith('session-1', 'failed');
    expect(notifier.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'thread-1' }),
      'ACP agent session failed: ACP agent does not support session/load; cannot load session acp-session-9.',
    );
    expect(close).toHaveBeenCalled();
  });

  it('registers the active ACP runtime while a prompt is running and clears it afterwards', async () => {
    const notifier = buildNotifier();
    const createSession = vi.fn().mockResolvedValue({ sessionId: 'acp-session-1' });
    const loadSession = vi.fn();
    const cancel = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    let releasePrompt: (() => void) | undefined;

    hoisted.launchAcpRuntime.mockImplementationOnce(() =>
      Promise.resolve({
        createSession,
        loadSession,
        cancel,
        prompt: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              releasePrompt = resolve;
            }),
        ),
        close,
      }),
    );

    const turn = runAcpAgentTurn({
      turn: buildTurn(),
      config: buildConfig(tempRoot),
      notifier,
      botEvents: { publish: vi.fn() },
      env: {},
    });

    await vi.waitFor(() =>
      expect(getActiveAcpRuntime('session-1')).toMatchObject({
        sessionId: 'session-1',
        codingAgentSessionId: 'acp-session-1',
        directory: tempRoot,
      }),
    );

    await getActiveAcpRuntime('session-1')?.cancel();
    expect(cancel).toHaveBeenCalledTimes(1);

    releasePrompt?.();
    await turn;
    expect(getActiveAcpRuntime('session-1')).toBeUndefined();
  });

  it('steers an active ACP prompt by cancelling the active runtime', async () => {
    const notifier = buildNotifier();
    const cancel = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn().mockResolvedValue(undefined);
    let releasePrompt: (() => void) | undefined;

    hoisted.launchAcpRuntime.mockImplementationOnce(() =>
      Promise.resolve({
        createSession: vi.fn().mockResolvedValue({ sessionId: 'acp-session-1' }),
        loadSession: vi.fn(),
        cancel,
        prompt: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              releasePrompt = resolve;
            }),
        ),
        close,
      }),
    );

    const turn = runAcpAgentTurn({
      turn: buildTurn(),
      config: buildConfig(tempRoot),
      notifier,
      botEvents: { publish: vi.fn() },
      env: {},
    });

    await vi.waitFor(() => expect(getActiveAcpRuntime('session-1')).toBeDefined());

    await steerAcpAgentTurn({
      sessionId: 'session-1',
      response: buildTurn().response,
      message: 'steered',
      profile: buildTurn().profile,
      config: buildConfig(tempRoot),
      notifier,
      env: {},
    });

    expect(cancel).toHaveBeenCalled();
    releasePrompt?.();
    await turn;
  });
});
