import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import type { OpenCodePromptRunOptions } from '@sniptail/core/opencode/prompt.js';
import type { BotEvent } from '@sniptail/core/types/bot-event.js';
import type { CoreWorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { Notifier } from '../channels/notifier.js';

const hoisted = vi.hoisted(() => ({
  runCopilot: vi.fn(),
  runOpenCodePrompt: vi.fn(),
  abortOpenCodeSession: vi.fn(),
  replyOpenCodePermission: vi.fn(),
  rejectOpenCodeQuestion: vi.fn(),
  loadAgentSession: vi.fn(),
  updateAgentSessionCodingAgentSessionId: vi.fn(),
  updateAgentSessionStatus: vi.fn(),
}));

vi.mock('@sniptail/core/copilot/copilot.js', () => ({
  runCopilot: hoisted.runCopilot,
}));

vi.mock('@sniptail/core/opencode/prompt.js', () => ({
  runOpenCodePrompt: hoisted.runOpenCodePrompt,
  abortOpenCodeSession: hoisted.abortOpenCodeSession,
  replyOpenCodePermission: hoisted.replyOpenCodePermission,
  rejectOpenCodeQuestion: hoisted.rejectOpenCodeQuestion,
}));

vi.mock('@sniptail/core/agent-sessions/registry.js', () => ({
  loadAgentSession: hoisted.loadAgentSession,
  updateAgentSessionCodingAgentSessionId: hoisted.updateAgentSessionCodingAgentSessionId,
  updateAgentSessionStatus: hoisted.updateAgentSessionStatus,
}));

import {
  clearActiveOpenCodeRuntimes,
  getActiveOpenCodeRuntime,
} from '../opencode/openCodeInteractionState.js';
import { clearAgentPromptTurns } from './activeAgentPromptTurns.js';
import { runAgentSessionMessage, runAgentSessionStart } from './agentSessionRunner.js';

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
      defaultModel: {
        modelProvider: 'openai',
        model: 'gpt-5.5',
        modelReasoningEffort: 'high',
      },
    },
    opencode: {
      executionMode: 'local',
      startupTimeoutMs: 10_000,
      dockerStreamLogs: false,
      defaultModel: {
        provider: 'anthropic',
        model: 'claude-sonnet',
      },
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

function buildEvent(overrides: Partial<CoreWorkerEvent<'agent.session.start'>['payload']> = {}) {
  return {
    schemaVersion: 1,
    type: 'agent.session.start',
    payload: {
      sessionId: 'session-1',
      response: {
        provider: 'discord',
        channelId: 'thread-1',
        threadId: 'thread-1',
        userId: 'user-1',
      },
      prompt: 'inspect this',
      workspaceKey: 'snatch',
      agentProfileKey: 'build',
      ...overrides,
    },
  } satisfies CoreWorkerEvent<'agent.session.start'>;
}

function buildMessageEvent(
  overrides: Partial<CoreWorkerEvent<'agent.session.message'>['payload']> = {},
) {
  return {
    schemaVersion: 1,
    type: 'agent.session.message',
    payload: {
      sessionId: 'session-1',
      response: {
        provider: 'discord',
        channelId: 'thread-1',
        threadId: 'thread-1',
        userId: 'user-1',
      },
      message: 'follow up',
      messageId: 'message-1',
      mode: 'run',
      ...overrides,
    },
  } satisfies CoreWorkerEvent<'agent.session.message'>;
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
    status: 'completed',
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
    publish: vi.fn(),
  };
}

type AssistantMessageEvent = Parameters<
  NonNullable<OpenCodePromptRunOptions['onAssistantMessage']>
>[1];

function buildAssistantMessageEvent(): AssistantMessageEvent {
  return {
    type: 'message.part.updated',
    properties: {
      part: {
        id: 'part-1',
        messageID: 'message-1',
        sessionID: 'opencode-session-1',
        type: 'text',
        text: 'assistant progress text',
        time: { start: 1 },
      },
    },
  };
}

describe('OpenCode agent prompt runner', () => {
  let tempRoot: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempRoot = await mkdtemp(join(tmpdir(), 'sniptail-agent-runner-'));
    hoisted.runOpenCodePrompt.mockImplementation(
      async (
        _prompt: string,
        _workDir: string,
        _env: NodeJS.ProcessEnv,
        options: OpenCodePromptRunOptions,
      ) => {
        await options.onSessionId?.('opencode-session-1');
        await options.onRuntimeReady?.({
          baseUrl: 'http://127.0.0.1:4096',
          directory: _workDir,
          executionMode: 'local',
          sessionId: 'opencode-session-1',
        });
        await options.onEvent?.({
          type: 'message.updated',
          properties: { info: { role: 'assistant', time: { completed: Date.now() } } },
        });
        await options.onAssistantMessage?.('assistant progress text', buildAssistantMessageEvent());
        return { finalResponse: 'assistant progress text', threadId: 'opencode-session-1' };
      },
    );
    hoisted.runCopilot.mockResolvedValue({
      finalResponse: 'copilot final response',
      threadId: 'copilot-session-1',
    });
    hoisted.updateAgentSessionStatus.mockResolvedValue(undefined);
    hoisted.updateAgentSessionCodingAgentSessionId.mockResolvedValue(undefined);
    hoisted.replyOpenCodePermission.mockResolvedValue(undefined);
    hoisted.rejectOpenCodeQuestion.mockResolvedValue(undefined);
    hoisted.abortOpenCodeSession.mockResolvedValue(undefined);
    hoisted.loadAgentSession.mockResolvedValue({ status: 'active' });
  });

  afterEach(async () => {
    clearActiveOpenCodeRuntimes();
    clearAgentPromptTurns();
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('runs Copilot with the selected profile and stores the Copilot session id', async () => {
    const notifier = buildNotifier();
    const config = buildConfig(tempRoot);
    config.agent.profiles.build = {
      provider: 'copilot',
      name: 'build',
      label: 'Build',
    };

    await runAgentSessionStart({
      event: buildEvent(),
      config,
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });

    expect(hoisted.runOpenCodePrompt).not.toHaveBeenCalled();
    expect(hoisted.runCopilot).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'session-1',
        requestText: 'inspect this',
        agent: 'copilot',
      }),
      tempRoot,
      {},
      expect.objectContaining({
        botName: 'Sniptail',
        promptOverride: 'inspect this',
        model: 'gpt-5.5',
        modelProvider: 'openai',
        modelReasoningEffort: 'high',
        copilotIdleRetries: 3,
        copilot: expect.objectContaining({
          agent: 'build',
          streaming: true,
        }) as unknown,
      }),
    );
    expect(hoisted.updateAgentSessionCodingAgentSessionId).toHaveBeenCalledWith(
      'session-1',
      'copilot-session-1',
    );
    expect(hoisted.updateAgentSessionStatus).toHaveBeenCalledWith('session-1', 'active');
    expect(hoisted.updateAgentSessionStatus).toHaveBeenCalledWith('session-1', 'completed');
    expect(notifier.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'thread-1' }),
      'copilot final response',
    );
  });

  it('streams Copilot assistant deltas to Discord output', async () => {
    await mkdir(tempRoot, { recursive: true });
    const notifier = buildNotifier();
    const config = buildConfig(tempRoot);
    config.agent.profiles.build = {
      provider: 'copilot',
      name: 'build',
      label: 'Build',
    };
    hoisted.runCopilot.mockImplementationOnce(async (_job, _workDir, _env, options) => {
      await options?.onEvent?.({
        type: 'assistant.message_delta',
        data: { deltaContent: 'Copilot says hi' },
      });
      return {
        finalResponse: 'Copilot says hi',
        threadId: 'copilot-session-1',
      };
    });

    await runAgentSessionStart({
      event: buildEvent(),
      config,
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });

    expect(notifier.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'thread-1' }),
      'Copilot says hi',
    );
  });

  it('runs Copilot profiles without custom agent using profile model settings', async () => {
    const notifier = buildNotifier();
    const config = buildConfig(tempRoot);
    config.agent.profiles.build = {
      provider: 'copilot',
      model: 'gpt-5.4-mini',
      reasoningEffort: 'low',
      label: 'Build',
    };

    await runAgentSessionStart({
      event: buildEvent(),
      config,
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });

    expect(hoisted.runCopilot).toHaveBeenCalledWith(
      expect.anything(),
      tempRoot,
      {},
      expect.objectContaining({
        model: 'gpt-5.4-mini',
        modelReasoningEffort: 'low',
        copilot: expect.not.objectContaining({ agent: expect.any(String) }),
      }),
    );
  });

  it('reports Copilot steer as unsupported while a prompt is active', async () => {
    await mkdir(tempRoot, { recursive: true });
    const notifier = buildNotifier();
    const config = buildConfig(tempRoot);
    config.agent.profiles.build = {
      provider: 'copilot',
      name: 'build',
      label: 'Build',
    };
    hoisted.loadAgentSession.mockResolvedValue(buildSession({ status: 'completed' }));

    let releasePrompt!: () => void;
    hoisted.runCopilot.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releasePrompt = () =>
            resolve({
              finalResponse: 'first done',
              threadId: 'copilot-session-1',
            });
        }),
    );

    const first = runAgentSessionMessage({
      event: buildMessageEvent({ message: 'first' }),
      config,
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });
    await vi.waitFor(() => expect(hoisted.runCopilot).toHaveBeenCalledTimes(1));

    await runAgentSessionMessage({
      event: buildMessageEvent({ message: 'steer', mode: 'steer' }),
      config,
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });

    releasePrompt();
    await first;

    expect(hoisted.runCopilot).toHaveBeenCalledTimes(1);
    expect(notifier.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'thread-1' }),
      'Failed to steer current prompt: Copilot prompt steering is not supported yet.',
    );
  });

  it('resumes completed Copilot sessions for follow-up turns', async () => {
    await mkdir(tempRoot, { recursive: true });
    const notifier = buildNotifier();
    const config = buildConfig(tempRoot);
    config.agent.profiles.build = {
      provider: 'copilot',
      name: 'build',
      label: 'Build',
    };
    hoisted.loadAgentSession.mockResolvedValueOnce(
      buildSession({
        agentProfileKey: 'build',
        codingAgentSessionId: 'copilot-session-9',
      }),
    );

    await runAgentSessionMessage({
      event: buildMessageEvent({ message: 'follow up' }),
      config,
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });

    expect(hoisted.runCopilot).toHaveBeenCalledWith(
      expect.objectContaining({ requestText: 'follow up' }),
      tempRoot,
      {},
      expect.objectContaining({
        promptOverride: 'follow up',
        resumeThreadId: 'copilot-session-9',
      }),
    );
  });

  it('resolves workspace cwd and runs OpenCode with the selected profile', async () => {
    await mkdir(join(tempRoot, 'apps', 'worker'), { recursive: true });
    const notifier = buildNotifier();

    await runAgentSessionStart({
      event: buildEvent({ cwd: 'apps/worker' }),
      config: buildConfig(tempRoot),
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });

    expect(hoisted.runOpenCodePrompt).toHaveBeenCalledWith(
      'inspect this',
      join(tempRoot, 'apps', 'worker'),
      {},
      expect.objectContaining({
        runtimeId: 'session-1',
        botName: 'Sniptail',
        model: 'claude-sonnet',
        modelProvider: 'anthropic',
        opencode: expect.objectContaining({ agent: 'build', executionMode: 'local' }) as unknown,
      }),
    );
    expect(hoisted.updateAgentSessionCodingAgentSessionId).toHaveBeenCalledWith(
      'session-1',
      'opencode-session-1',
    );
    expect(hoisted.updateAgentSessionStatus).toHaveBeenCalledWith('session-1', 'active');
    expect(hoisted.updateAgentSessionStatus).toHaveBeenCalledWith('session-1', 'completed');
    expect(notifier.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ provider: 'discord', channelId: 'thread-1' }),
      'assistant progress text',
    );
  });

  it('flushes streamed assistant text before the final response', async () => {
    await mkdir(tempRoot, { recursive: true });
    const notifier = buildNotifier();

    await runAgentSessionStart({
      event: buildEvent(),
      config: buildConfig(tempRoot),
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });

    expect(notifier.postMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ provider: 'discord', channelId: 'thread-1' }),
      'assistant progress text',
    );
  });

  it('keeps tool summaries out of Discord output', async () => {
    await mkdir(tempRoot, { recursive: true });
    const notifier = buildNotifier();
    hoisted.runOpenCodePrompt.mockImplementationOnce(
      async (
        _prompt: string,
        _workDir: string,
        _env: NodeJS.ProcessEnv,
        options: OpenCodePromptRunOptions,
      ) => {
        await options.onEvent?.({
          type: 'message.part.updated',
          properties: {
            part: {
              id: 'part-1',
              sessionID: 'opencode-session-1',
              messageID: 'message-1',
              type: 'tool',
              callID: 'call-1',
              tool: 'bash',
              state: {
                status: 'running',
                input: { command: 'pnpm test' },
                time: { start: 1 },
              },
            },
          },
        });
        return { finalResponse: 'final answer', threadId: 'opencode-session-1' };
      },
    );

    await runAgentSessionStart({
      event: buildEvent(),
      config: buildConfig(tempRoot),
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });

    expect(notifier.postMessage).toHaveBeenCalledTimes(0);
  });

  it('records and clears the active OpenCode runtime ref', async () => {
    await mkdir(tempRoot, { recursive: true });
    const notifier = buildNotifier();
    let activeRefDuringRun: ReturnType<typeof getActiveOpenCodeRuntime>;
    hoisted.runOpenCodePrompt.mockImplementationOnce(
      async (
        _prompt: string,
        _workDir: string,
        _env: NodeJS.ProcessEnv,
        options: OpenCodePromptRunOptions,
      ) => {
        await options.onSessionId?.('opencode-session-1');
        await options.onRuntimeReady?.({
          baseUrl: 'http://127.0.0.1:4096',
          directory: _workDir,
          executionMode: 'local',
          sessionId: 'opencode-session-1',
        });
        activeRefDuringRun = getActiveOpenCodeRuntime('session-1');
        return { finalResponse: 'final answer', threadId: 'opencode-session-1' };
      },
    );

    await runAgentSessionStart({
      event: buildEvent(),
      config: buildConfig(tempRoot),
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });

    expect(activeRefDuringRun!).toEqual({
      codingAgentSessionId: 'opencode-session-1',
      baseUrl: 'http://127.0.0.1:4096',
      directory: tempRoot,
      executionMode: 'local',
    });
    expect(getActiveOpenCodeRuntime('session-1')).toBeUndefined();
  });

  it('publishes Discord permission requests for OpenCode permission events', async () => {
    await mkdir(tempRoot, { recursive: true });
    const notifier = buildNotifier();
    const botEvents = buildBotEvents();
    hoisted.runOpenCodePrompt.mockImplementationOnce(
      async (
        _prompt: string,
        _workDir: string,
        _env: NodeJS.ProcessEnv,
        options: OpenCodePromptRunOptions,
      ) => {
        await options.onRuntimeReady?.({
          baseUrl: 'http://127.0.0.1:4096',
          directory: _workDir,
          executionMode: 'local',
          sessionId: 'opencode-session-1',
        });
        await options.onEvent?.({
          type: 'permission.asked',
          properties: {
            id: 'permission-request-1',
            sessionID: 'opencode-session-1',
            permission: 'bash',
            patterns: ['pnpm run check'],
            metadata: { command: 'pnpm run check' },
            always: [],
          },
        });
        return { finalResponse: 'final answer', threadId: 'opencode-session-1' };
      },
    );

    await runAgentSessionStart({
      event: buildEvent(),
      config: buildConfig(tempRoot),
      notifier,
      botEvents,
      env: {},
    });

    const published = botEvents.publish.mock.calls[0]?.[0] as BotEvent | undefined;
    expect(published).toMatchObject({
      type: 'agent.permission.requested',
      payload: {
        sessionId: 'session-1',
        toolName: 'bash',
        action: 'pnpm run check',
        allowAlways: true,
      },
    });
  });

  it('shows one permission request at a time and advances after OpenCode replies', async () => {
    await mkdir(tempRoot, { recursive: true });
    const notifier = buildNotifier();
    const botEvents = buildBotEvents();
    hoisted.runOpenCodePrompt.mockImplementationOnce(
      async (
        _prompt: string,
        _workDir: string,
        _env: NodeJS.ProcessEnv,
        options: OpenCodePromptRunOptions,
      ) => {
        await options.onRuntimeReady?.({
          baseUrl: 'http://127.0.0.1:4096',
          directory: _workDir,
          executionMode: 'local',
          sessionId: 'opencode-session-1',
        });
        await options.onEvent?.({
          type: 'permission.asked',
          properties: {
            id: 'permission-request-1',
            sessionID: 'opencode-session-1',
            permission: 'glob',
            patterns: ['**/*'],
            metadata: { pattern: '**/*' },
            always: [],
          },
        });
        await options.onEvent?.({
          type: 'permission.asked',
          properties: {
            id: 'permission-request-2',
            sessionID: 'opencode-session-1',
            permission: 'read',
            patterns: ['README.md'],
            metadata: { filePath: 'README.md' },
            always: [],
          },
        });
        await options.onEvent?.({
          type: 'permission.replied',
          properties: {
            sessionID: 'opencode-session-1',
            requestID: 'permission-request-1',
            reply: 'once',
          },
        });
        return { finalResponse: 'final answer', threadId: 'opencode-session-1' };
      },
    );

    await runAgentSessionStart({
      event: buildEvent(),
      config: buildConfig(tempRoot),
      notifier,
      botEvents,
      env: {},
    });

    const events = botEvents.publish.mock.calls.map((call) => call[0] as BotEvent);
    expect(events).toMatchObject([
      {
        type: 'agent.permission.requested',
        payload: { toolName: 'glob' },
      },
      {
        type: 'agent.permission.updated',
        payload: { status: 'approved_once' },
      },
      {
        type: 'agent.permission.requested',
        payload: { toolName: 'read' },
      },
    ]);
  });

  it('drops hidden permission requests when OpenCode replies before display', async () => {
    await mkdir(tempRoot, { recursive: true });
    const notifier = buildNotifier();
    const botEvents = buildBotEvents();
    hoisted.runOpenCodePrompt.mockImplementationOnce(
      async (
        _prompt: string,
        _workDir: string,
        _env: NodeJS.ProcessEnv,
        options: OpenCodePromptRunOptions,
      ) => {
        await options.onRuntimeReady?.({
          baseUrl: 'http://127.0.0.1:4096',
          directory: _workDir,
          executionMode: 'local',
          sessionId: 'opencode-session-1',
        });
        await options.onEvent?.({
          type: 'permission.asked',
          properties: {
            id: 'permission-request-1',
            sessionID: 'opencode-session-1',
            permission: 'glob',
            patterns: ['**/*'],
            metadata: {},
            always: [],
          },
        });
        await options.onEvent?.({
          type: 'permission.asked',
          properties: {
            id: 'permission-request-2',
            sessionID: 'opencode-session-1',
            permission: 'read',
            patterns: ['README.md'],
            metadata: {},
            always: [],
          },
        });
        await options.onEvent?.({
          type: 'permission.replied',
          properties: {
            sessionID: 'opencode-session-1',
            requestID: 'permission-request-2',
            reply: 'always',
          },
        });
        return { finalResponse: 'final answer', threadId: 'opencode-session-1' };
      },
    );

    await runAgentSessionStart({
      event: buildEvent(),
      config: buildConfig(tempRoot),
      notifier,
      botEvents,
      env: {},
    });

    const events = botEvents.publish.mock.calls.map((call) => call[0] as BotEvent);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'agent.permission.requested',
      payload: { toolName: 'glob' },
    });
  });

  it('defers promotion after always replies so OpenCode can resolve hidden permissions', async () => {
    vi.useFakeTimers();
    await mkdir(tempRoot, { recursive: true });
    const notifier = buildNotifier();
    const botEvents = buildBotEvents();
    hoisted.runOpenCodePrompt.mockImplementationOnce(
      async (
        _prompt: string,
        _workDir: string,
        _env: NodeJS.ProcessEnv,
        options: OpenCodePromptRunOptions,
      ) => {
        await options.onRuntimeReady?.({
          baseUrl: 'http://127.0.0.1:4096',
          directory: _workDir,
          executionMode: 'local',
          sessionId: 'opencode-session-1',
        });
        await options.onEvent?.({
          type: 'permission.asked',
          properties: {
            id: 'permission-request-1',
            sessionID: 'opencode-session-1',
            permission: 'glob',
            patterns: ['**/*'],
            metadata: {},
            always: [],
          },
        });
        await options.onEvent?.({
          type: 'permission.asked',
          properties: {
            id: 'permission-request-2',
            sessionID: 'opencode-session-1',
            permission: 'glob',
            patterns: ['README.md'],
            metadata: {},
            always: [],
          },
        });
        await options.onEvent?.({
          type: 'permission.replied',
          properties: {
            sessionID: 'opencode-session-1',
            requestID: 'permission-request-1',
            reply: 'always',
          },
        });
        await vi.advanceTimersByTimeAsync(500);
        await options.onEvent?.({
          type: 'permission.replied',
          properties: {
            sessionID: 'opencode-session-1',
            requestID: 'permission-request-2',
            reply: 'always',
          },
        });
        await vi.advanceTimersByTimeAsync(750);
        return { finalResponse: 'final answer', threadId: 'opencode-session-1' };
      },
    );

    try {
      await runAgentSessionStart({
        event: buildEvent(),
        config: buildConfig(tempRoot),
        notifier,
        botEvents,
        env: {},
      });
    } finally {
      vi.useRealTimers();
    }

    const events = botEvents.publish.mock.calls.map((call) => call[0] as BotEvent);
    expect(events).toMatchObject([
      {
        type: 'agent.permission.requested',
        payload: { toolName: 'glob' },
      },
      {
        type: 'agent.permission.updated',
        payload: { status: 'approved_always' },
      },
    ]);
  });

  it('flushes buffered assistant output before publishing permission requests', async () => {
    await mkdir(tempRoot, { recursive: true });
    const notifier = buildNotifier();
    const botEvents = buildBotEvents();
    const callOrder: string[] = [];
    notifier.postMessage.mockImplementation(() => {
      callOrder.push('message');
    });
    botEvents.publish.mockImplementation(() => {
      callOrder.push('permission');
      return Promise.resolve();
    });
    hoisted.runOpenCodePrompt.mockImplementationOnce(
      async (
        _prompt: string,
        _workDir: string,
        _env: NodeJS.ProcessEnv,
        options: OpenCodePromptRunOptions,
      ) => {
        await options.onAssistantMessage?.(
          'I need to inspect README files before editing.',
          buildAssistantMessageEvent(),
        );
        await options.onEvent?.({
          type: 'permission.asked',
          properties: {
            id: 'permission-request-1',
            sessionID: 'opencode-session-1',
            permission: 'glob',
            patterns: ['**/[Rr][Ee][Aa][Dd][Mm][Ee]*'],
            metadata: { pattern: '**/[Rr][Ee][Aa][Dd][Mm][Ee]*' },
            always: [],
          },
        });
        return { finalResponse: 'final answer', threadId: 'opencode-session-1' };
      },
    );

    await runAgentSessionStart({
      event: buildEvent(),
      config: buildConfig(tempRoot),
      notifier,
      botEvents,
      env: {},
    });

    expect(callOrder.slice(0, 2)).toEqual(['message', 'permission']);
    expect(notifier.postMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ provider: 'discord', channelId: 'thread-1' }),
      'I need to inspect README files before editing.',
    );
  });

  it('publishes Discord question requests for OpenCode question events', async () => {
    await mkdir(tempRoot, { recursive: true });
    const notifier = buildNotifier();
    const botEvents = buildBotEvents();
    hoisted.runOpenCodePrompt.mockImplementationOnce(
      async (
        _prompt: string,
        _workDir: string,
        _env: NodeJS.ProcessEnv,
        options: OpenCodePromptRunOptions,
      ) => {
        await options.onRuntimeReady?.({
          baseUrl: 'http://127.0.0.1:4096',
          directory: _workDir,
          executionMode: 'local',
          sessionId: 'opencode-session-1',
        });
        await options.onEvent?.({
          type: 'question.asked',
          properties: {
            id: 'question-request-1',
            sessionID: 'opencode-session-1',
            questions: [
              {
                header: 'Target',
                question: 'Which package should I edit?',
                options: [{ label: 'Worker', description: 'Worker package' }],
                multiple: false,
                custom: true,
              },
            ],
          },
        });
        return { finalResponse: 'final answer', threadId: 'opencode-session-1' };
      },
    );

    await runAgentSessionStart({
      event: buildEvent(),
      config: buildConfig(tempRoot),
      notifier,
      botEvents,
      env: {},
    });

    const published = botEvents.publish.mock.calls[0]?.[0] as BotEvent | undefined;
    expect(published).toMatchObject({
      type: 'agent.question.requested',
      payload: {
        sessionId: 'session-1',
        questions: [
          {
            header: 'Target',
            question: 'Which package should I edit?',
            multiple: false,
            custom: true,
          },
        ],
      },
    });
  });

  it('flushes buffered assistant output before publishing question requests', async () => {
    await mkdir(tempRoot, { recursive: true });
    const notifier = buildNotifier();
    const botEvents = buildBotEvents();
    const callOrder: string[] = [];
    notifier.postMessage.mockImplementation(() => {
      callOrder.push('message');
    });
    botEvents.publish.mockImplementation(() => {
      callOrder.push('question');
      return Promise.resolve();
    });
    hoisted.runOpenCodePrompt.mockImplementationOnce(
      async (
        _prompt: string,
        _workDir: string,
        _env: NodeJS.ProcessEnv,
        options: OpenCodePromptRunOptions,
      ) => {
        await options.onAssistantMessage?.(
          'I need your preference before continuing.',
          buildAssistantMessageEvent(),
        );
        await options.onEvent?.({
          type: 'question.asked',
          properties: {
            id: 'question-request-1',
            sessionID: 'opencode-session-1',
            questions: [
              {
                header: 'Target',
                question: 'Which package should I edit?',
                options: [{ label: 'Worker' }],
              },
            ],
          },
        });
        return { finalResponse: 'final answer', threadId: 'opencode-session-1' };
      },
    );

    await runAgentSessionStart({
      event: buildEvent(),
      config: buildConfig(tempRoot),
      notifier,
      botEvents,
      env: {},
    });

    expect(callOrder.slice(0, 2)).toEqual(['message', 'question']);
  });

  it('rejects visible permission requests after the interaction timeout', async () => {
    vi.useFakeTimers();
    await mkdir(tempRoot, { recursive: true });
    const notifier = buildNotifier();
    const botEvents = buildBotEvents();
    const config = buildConfig(tempRoot);
    config.agent.interactionTimeoutMs = 100;
    hoisted.runOpenCodePrompt.mockImplementationOnce(
      async (
        _prompt: string,
        _workDir: string,
        _env: NodeJS.ProcessEnv,
        options: OpenCodePromptRunOptions,
      ) => {
        await options.onRuntimeReady?.({
          baseUrl: 'http://127.0.0.1:4096',
          directory: _workDir,
          executionMode: 'local',
          sessionId: 'opencode-session-1',
        });
        await options.onEvent?.({
          type: 'permission.asked',
          properties: {
            id: 'permission-request-1',
            sessionID: 'opencode-session-1',
            permission: 'bash',
            patterns: ['pnpm run check'],
            metadata: { command: 'pnpm run check' },
            always: [],
          },
        });
        await vi.advanceTimersByTimeAsync(100);
        return { finalResponse: 'final answer', threadId: 'opencode-session-1' };
      },
    );

    try {
      await runAgentSessionStart({
        event: buildEvent(),
        config,
        notifier,
        botEvents,
        env: {},
      });
    } finally {
      vi.useRealTimers();
    }

    expect(hoisted.replyOpenCodePermission).toHaveBeenCalledWith(
      tempRoot,
      {},
      expect.objectContaining({
        requestID: 'permission-request-1',
        reply: 'reject',
      }),
    );
    const published = botEvents.publish.mock.calls.find(
      (call) => (call[0] as BotEvent).type === 'agent.permission.updated',
    )?.[0] as BotEvent | undefined;
    expect(published).toMatchObject({
      type: 'agent.permission.updated',
      payload: { status: 'expired' },
    });
  });

  it('rejects pending question requests after the interaction timeout', async () => {
    vi.useFakeTimers();
    await mkdir(tempRoot, { recursive: true });
    const notifier = buildNotifier();
    const botEvents = buildBotEvents();
    const config = buildConfig(tempRoot);
    config.agent.interactionTimeoutMs = 100;
    hoisted.runOpenCodePrompt.mockImplementationOnce(
      async (
        _prompt: string,
        _workDir: string,
        _env: NodeJS.ProcessEnv,
        options: OpenCodePromptRunOptions,
      ) => {
        await options.onRuntimeReady?.({
          baseUrl: 'http://127.0.0.1:4096',
          directory: _workDir,
          executionMode: 'local',
          sessionId: 'opencode-session-1',
        });
        await options.onEvent?.({
          type: 'question.asked',
          properties: {
            id: 'question-request-1',
            sessionID: 'opencode-session-1',
            questions: [
              {
                header: 'Target',
                question: 'Which package should I edit?',
                options: [{ label: 'Worker' }],
              },
            ],
          },
        });
        await vi.advanceTimersByTimeAsync(100);
        return { finalResponse: 'final answer', threadId: 'opencode-session-1' };
      },
    );

    try {
      await runAgentSessionStart({
        event: buildEvent(),
        config,
        notifier,
        botEvents,
        env: {},
      });
    } finally {
      vi.useRealTimers();
    }

    expect(hoisted.rejectOpenCodeQuestion).toHaveBeenCalledWith(
      tempRoot,
      {},
      expect.objectContaining({
        requestID: 'question-request-1',
        baseUrl: 'http://127.0.0.1:4096',
      }),
    );
    const published = botEvents.publish.mock.calls.find(
      (call) => (call[0] as BotEvent).type === 'agent.question.updated',
    )?.[0] as BotEvent | undefined;
    expect(published).toMatchObject({
      type: 'agent.question.updated',
      payload: { status: 'expired' },
    });
  });

  it('flushes pending assistant text before failure messages', async () => {
    await mkdir(tempRoot, { recursive: true });
    const notifier = buildNotifier();
    hoisted.runOpenCodePrompt.mockImplementationOnce(
      async (
        _prompt: string,
        _workDir: string,
        _env: NodeJS.ProcessEnv,
        options: OpenCodePromptRunOptions,
      ) => {
        await options.onEvent?.({
          type: 'session.error',
          properties: { error: { message: 'failed' } },
        });
        await options.onAssistantMessage?.(
          'assistant text before failure',
          buildAssistantMessageEvent(),
        );
        throw new Error('prompt failed');
      },
    );

    await runAgentSessionStart({
      event: buildEvent(),
      config: buildConfig(tempRoot),
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });

    expect(notifier.postMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ provider: 'discord', channelId: 'thread-1' }),
      'assistant text before failure',
    );
    expect(notifier.postMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ provider: 'discord', channelId: 'thread-1' }),
      'OpenCode agent session failed: prompt failed',
    );
  });

  it('does not overwrite stopped sessions after OpenCode aborts', async () => {
    await mkdir(tempRoot, { recursive: true });
    const notifier = buildNotifier();
    hoisted.loadAgentSession.mockResolvedValueOnce({ status: 'stopped' });
    hoisted.runOpenCodePrompt.mockRejectedValueOnce(new Error('OpenCode prompt aborted'));

    await runAgentSessionStart({
      event: buildEvent(),
      config: buildConfig(tempRoot),
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });

    expect(hoisted.updateAgentSessionStatus).not.toHaveBeenCalledWith('session-1', 'failed');
    expect(notifier.postMessage).not.toHaveBeenCalled();
  });

  it('runs follow-up messages against the stored OpenCode session id', async () => {
    await mkdir(tempRoot, { recursive: true });
    const notifier = buildNotifier();
    hoisted.loadAgentSession.mockResolvedValue(buildSession());

    await runAgentSessionMessage({
      event: buildMessageEvent(),
      config: buildConfig(tempRoot),
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });

    expect(hoisted.runOpenCodePrompt).toHaveBeenCalledWith(
      'follow up',
      tempRoot,
      {},
      expect.objectContaining({
        runtimeId: 'session-1',
        sessionId: 'opencode-session-1',
      }),
    );
    expect(notifier.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ provider: 'discord', channelId: 'thread-1' }),
      'assistant progress text',
    );
  });

  it('queues follow-up messages while a prompt is active', async () => {
    await mkdir(tempRoot, { recursive: true });
    const notifier = buildNotifier();
    let releaseFirstPrompt!: () => void;
    hoisted.loadAgentSession.mockResolvedValue(buildSession({ status: 'completed' }));
    hoisted.runOpenCodePrompt
      .mockImplementationOnce(
        async (
          _prompt: string,
          _workDir: string,
          _env: NodeJS.ProcessEnv,
          options: OpenCodePromptRunOptions,
        ) => {
          await options.onSessionId?.('opencode-session-1');
          await options.onRuntimeReady?.({
            baseUrl: 'http://127.0.0.1:4096',
            directory: _workDir,
            executionMode: 'local',
            sessionId: 'opencode-session-1',
          });
          await new Promise<void>((resolve) => {
            releaseFirstPrompt = resolve;
          });
          return { finalResponse: 'first done', threadId: 'opencode-session-1' };
        },
      )
      .mockImplementationOnce(() =>
        Promise.resolve({
          finalResponse: 'queued done',
          threadId: 'opencode-session-1',
        }),
      );

    const first = runAgentSessionMessage({
      event: buildMessageEvent({ message: 'first' }),
      config: buildConfig(tempRoot),
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });
    await vi.waitFor(() => expect(hoisted.runOpenCodePrompt).toHaveBeenCalledTimes(1));

    await runAgentSessionMessage({
      event: buildMessageEvent({ message: 'queued', mode: 'queue' }),
      config: buildConfig(tempRoot),
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });

    releaseFirstPrompt();
    await first;

    expect(hoisted.runOpenCodePrompt).toHaveBeenNthCalledWith(
      2,
      'queued',
      tempRoot,
      {},
      expect.objectContaining({ sessionId: 'opencode-session-1' }),
    );
    expect(notifier.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'discord', channelId: 'thread-1' }),
      'Follow-up queued for the next agent turn.',
    );
  });

  it('steers by aborting the active prompt and running the steered message next', async () => {
    await mkdir(tempRoot, { recursive: true });
    const notifier = buildNotifier();
    let rejectFirstPrompt!: (err: Error) => void;
    hoisted.loadAgentSession.mockResolvedValue(buildSession({ status: 'completed' }));
    hoisted.runOpenCodePrompt
      .mockImplementationOnce(
        async (
          _prompt: string,
          _workDir: string,
          _env: NodeJS.ProcessEnv,
          options: OpenCodePromptRunOptions,
        ) => {
          await options.onSessionId?.('opencode-session-1');
          await options.onRuntimeReady?.({
            baseUrl: 'http://127.0.0.1:4096',
            directory: _workDir,
            executionMode: 'local',
            sessionId: 'opencode-session-1',
          });
          return new Promise((_, reject) => {
            rejectFirstPrompt = reject;
          });
        },
      )
      .mockImplementationOnce(() =>
        Promise.resolve({
          finalResponse: 'steered done',
          threadId: 'opencode-session-1',
        }),
      );
    hoisted.abortOpenCodeSession.mockImplementationOnce(() => {
      rejectFirstPrompt(new Error('aborted'));
      return Promise.resolve();
    });

    const first = runAgentSessionMessage({
      event: buildMessageEvent({ message: 'first' }),
      config: buildConfig(tempRoot),
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });
    await vi.waitFor(() => expect(getActiveOpenCodeRuntime('session-1')).toBeDefined());

    await runAgentSessionMessage({
      event: buildMessageEvent({ message: 'steered', mode: 'steer' }),
      config: buildConfig(tempRoot),
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });
    await first;

    expect(hoisted.abortOpenCodeSession).toHaveBeenCalledWith(
      'opencode-session-1',
      tempRoot,
      {},
      expect.objectContaining({ baseUrl: 'http://127.0.0.1:4096' }),
    );
    expect(hoisted.runOpenCodePrompt).toHaveBeenNthCalledWith(
      2,
      'steered',
      tempRoot,
      {},
      expect.objectContaining({ sessionId: 'opencode-session-1' }),
    );
    expect(hoisted.updateAgentSessionStatus).not.toHaveBeenCalledWith('session-1', 'failed');
  });

  it('marks the session failed and reports errors when workspace resolution fails', async () => {
    const notifier = buildNotifier();

    await runAgentSessionStart({
      event: buildEvent({ cwd: 'missing' }),
      config: buildConfig(tempRoot),
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });

    expect(hoisted.runOpenCodePrompt).not.toHaveBeenCalled();
    expect(hoisted.updateAgentSessionStatus).toHaveBeenCalledWith('session-1', 'failed');
    expect(notifier.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'discord', channelId: 'thread-1' }),
      expect.stringContaining('OpenCode agent session failed:'),
    );
  });

  it('does not run OpenCode when agent sessions are disabled', async () => {
    const notifier = buildNotifier();
    const config = buildConfig(tempRoot);
    config.agent.enabled = false;

    await runAgentSessionStart({
      event: buildEvent(),
      config,
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });

    expect(hoisted.runOpenCodePrompt).not.toHaveBeenCalled();
    expect(notifier.postMessage).not.toHaveBeenCalled();
  });
});
