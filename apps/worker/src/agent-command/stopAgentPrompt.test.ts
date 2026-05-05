import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import type { CoreWorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { Notifier } from '../channels/notifier.js';
import {
  clearActiveOpenCodeRuntimes,
  setActiveOpenCodeRuntime,
} from '../opencode/openCodeInteractionState.js';
import {
  clearActiveCopilotRuntimes,
  setActiveCopilotRuntime,
} from '../copilot/copilotInteractionState.js';
import { stopAgentPrompt } from './stopAgentPrompt.js';

const hoisted = vi.hoisted(() => ({
  abortOpenCodeSession: vi.fn(),
  loadAgentSession: vi.fn(),
  updateAgentSessionStatus: vi.fn(),
}));

vi.mock('@sniptail/core/opencode/prompt.js', () => ({
  abortOpenCodeSession: hoisted.abortOpenCodeSession,
}));

vi.mock('@sniptail/core/agent-sessions/registry.js', () => ({
  loadAgentSession: hoisted.loadAgentSession,
  updateAgentSessionStatus: hoisted.updateAgentSessionStatus,
}));

function buildConfig(
  workspacePath: string,
  executionMode: 'local' | 'server' = 'local',
): WorkerConfig {
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
      executionMode,
      ...(executionMode === 'server' ? { serverUrl: 'http://opencode.example' } : {}),
      startupTimeoutMs: 10_000,
      dockerStreamLogs: false,
    },
    includeRawRequestInMr: false,
    agent: {
      enabled: true,
      defaultWorkspace: 'snatch',
      defaultAgentProfile: 'build',
      interactionTimeoutMs: 1_800_000,
      outputDebounceMs: 15_000,
      workspaces: {
        snatch: {
          path: workspacePath,
          label: 'Snatch',
        },
      },
      profiles: {
        build: {
          provider: 'opencode',
          name: 'build',
          label: 'Build',
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

function buildEvent(): CoreWorkerEvent<'agent.prompt.stop'> {
  return {
    schemaVersion: 1,
    type: 'agent.prompt.stop',
    payload: {
      sessionId: 'session-1',
      response: {
        provider: 'discord',
        channelId: 'thread-1',
        threadId: 'thread-1',
        userId: 'user-1',
      },
      reason: 'user requested stop',
      messageId: 'message-1',
    },
  };
}

function buildSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'session-1',
    provider: 'discord',
    channelId: 'channel-1',
    threadId: 'thread-1',
    userId: 'user-1',
    workspaceKey: 'snatch',
    agentProfileKey: 'build',
    codingAgentSessionId: 'opencode-session-1',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildNotifier(): Notifier & { postMessage: ReturnType<typeof vi.fn> } {
  return {
    postMessage: vi.fn(),
    uploadFile: vi.fn(),
    addReaction: vi.fn(),
  };
}

function buildBotEvents() {
  return {
    publish: vi.fn(() => Promise.resolve()),
  };
}

describe('stopAgentPrompt', () => {
  let tempRoot: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    clearActiveOpenCodeRuntimes();
    clearActiveCopilotRuntimes();
    tempRoot = await mkdtemp(join(tmpdir(), 'sniptail-agent-stop-'));
    await mkdir(tempRoot, { recursive: true });
    hoisted.loadAgentSession.mockResolvedValue(buildSession());
    hoisted.abortOpenCodeSession.mockResolvedValue(undefined);
    hoisted.updateAgentSessionStatus.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    clearActiveOpenCodeRuntimes();
    clearActiveCopilotRuntimes();
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('reports unreachable active runtime for Copilot profiles without an active runtime', async () => {
    const notifier = buildNotifier();
    const config = buildConfig(tempRoot);
    config.agent.profiles.build = {
      provider: 'copilot',
      name: 'build',
      label: 'Build',
    };

    await stopAgentPrompt({
      event: buildEvent(),
      config,
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });

    expect(hoisted.abortOpenCodeSession).not.toHaveBeenCalled();
    expect(notifier.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'thread-1' }),
      'Copilot prompt cannot be stopped: active runtime is no longer reachable.',
    );
  });

  it('stops an active Copilot prompt through the active runtime ref', async () => {
    const notifier = buildNotifier();
    const abort = vi.fn(() => Promise.resolve());
    const config = buildConfig(tempRoot);
    config.agent.profiles.build = {
      provider: 'copilot',
      name: 'build',
      label: 'Build',
    };
    setActiveCopilotRuntime('session-1', {
      sessionId: 'copilot-session-1',
      abort,
      sendImmediate: vi.fn(),
      enqueue: vi.fn(),
    });

    await stopAgentPrompt({
      event: buildEvent(),
      config,
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });

    expect(abort).toHaveBeenCalled();
    expect(hoisted.updateAgentSessionStatus).toHaveBeenCalledWith('session-1', 'stopped');
    expect(notifier.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'thread-1' }),
      'Copilot prompt stopped.',
    );
  });

  it('reports Copilot abort failures without marking stopped', async () => {
    const notifier = buildNotifier();
    const config = buildConfig(tempRoot);
    config.agent.profiles.build = {
      provider: 'copilot',
      name: 'build',
      label: 'Build',
    };
    setActiveCopilotRuntime('session-1', {
      sessionId: 'copilot-session-1',
      abort: vi.fn(() => Promise.reject(new Error('abort failed'))),
      sendImmediate: vi.fn(),
      enqueue: vi.fn(),
    });

    await stopAgentPrompt({
      event: buildEvent(),
      config,
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });

    expect(hoisted.updateAgentSessionStatus).not.toHaveBeenCalled();
    expect(notifier.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'thread-1' }),
      'Failed to stop Copilot prompt: abort failed',
    );
  });

  it('stops an active prompt through the active runtime ref', async () => {
    const notifier = buildNotifier();
    setActiveOpenCodeRuntime('session-1', {
      codingAgentSessionId: 'opencode-session-1',
      baseUrl: 'http://127.0.0.1:4096',
      directory: tempRoot,
      executionMode: 'local',
    });

    await stopAgentPrompt({
      event: buildEvent(),
      config: buildConfig(tempRoot),
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });

    expect(hoisted.abortOpenCodeSession).toHaveBeenCalledWith(
      'opencode-session-1',
      tempRoot,
      {},
      expect.objectContaining({ baseUrl: 'http://127.0.0.1:4096' }),
    );
    expect(hoisted.updateAgentSessionStatus).toHaveBeenCalledWith('session-1', 'stopped');
    expect(notifier.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'thread-1' }),
      'OpenCode prompt stopped.',
    );
  });

  it('stops a server-mode prompt from persisted session state without an active ref', async () => {
    const notifier = buildNotifier();

    await stopAgentPrompt({
      event: buildEvent(),
      config: buildConfig(tempRoot, 'server'),
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });

    expect(hoisted.abortOpenCodeSession).toHaveBeenCalledWith(
      'opencode-session-1',
      tempRoot,
      {},
      expect.objectContaining({
        opencode: expect.objectContaining({ serverUrl: 'http://opencode.example' }) as unknown,
      }),
    );
    expect(hoisted.updateAgentSessionStatus).toHaveBeenCalledWith('session-1', 'stopped');
  });

  it('reports unreachable local runtimes when no active ref exists', async () => {
    const notifier = buildNotifier();

    await stopAgentPrompt({
      event: buildEvent(),
      config: buildConfig(tempRoot),
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });

    expect(hoisted.abortOpenCodeSession).not.toHaveBeenCalled();
    expect(hoisted.updateAgentSessionStatus).not.toHaveBeenCalled();
    expect(notifier.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'thread-1' }),
      'OpenCode prompt cannot be stopped: active runtime is no longer reachable.',
    );
  });

  it('does not call OpenCode for non-active sessions', async () => {
    const notifier = buildNotifier();
    hoisted.loadAgentSession.mockResolvedValueOnce(buildSession({ status: 'completed' }));

    await stopAgentPrompt({
      event: buildEvent(),
      config: buildConfig(tempRoot),
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });

    expect(hoisted.abortOpenCodeSession).not.toHaveBeenCalled();
    expect(notifier.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'thread-1' }),
      'This agent session is completed.',
    );
  });
});
