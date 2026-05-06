import { access, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRunOptions } from '@sniptail/core/agents/types.js';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import type { OpenCodePromptRunOptions } from '@sniptail/core/opencode/prompt.js';
import type { BotEvent } from '@sniptail/core/types/bot-event.js';
import type { CoreWorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { Notifier } from '../channels/notifier.js';

const hoisted = vi.hoisted(() => ({
  runCodex: vi.fn(),
  runCopilot: vi.fn(),
  runOpenCodePrompt: vi.fn(),
  abortOpenCodeSession: vi.fn(),
  replyOpenCodePermission: vi.fn(),
  rejectOpenCodeQuestion: vi.fn(),
  loadAgentSession: vi.fn(),
  updateAgentSessionCodingAgentSessionId: vi.fn(),
  updateAgentSessionStatus: vi.fn(),
}));

vi.mock('@sniptail/core/codex/codex.js', () => ({
  runCodex: hoisted.runCodex,
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

import { clearActiveCodexRuntimes, getActiveCodexRuntime } from '../codex/codexInteractionState.js';
import {
  clearActiveOpenCodeRuntimes,
  getActiveOpenCodeRuntime,
} from '../opencode/openCodeInteractionState.js';
import { clearActiveCopilotRuntimes } from '../copilot/copilotInteractionState.js';
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
      idleTimeoutMs: 300_000,
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
    hoisted.runCodex.mockResolvedValue({
      finalResponse: 'codex final response',
      threadId: 'codex-thread-1',
    });
    hoisted.updateAgentSessionStatus.mockResolvedValue(undefined);
    hoisted.updateAgentSessionCodingAgentSessionId.mockResolvedValue(undefined);
    hoisted.replyOpenCodePermission.mockResolvedValue(undefined);
    hoisted.rejectOpenCodeQuestion.mockResolvedValue(undefined);
    hoisted.abortOpenCodeSession.mockResolvedValue(undefined);
    hoisted.loadAgentSession.mockResolvedValue({ status: 'active' });
  });

  afterEach(async () => {
    clearActiveCodexRuntimes();
    clearActiveOpenCodeRuntimes();
    clearActiveCopilotRuntimes();
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
        copilotIdleRetries: 3,
        copilotIdleTimeoutMs: 1_800_000,
      }),
    );
    const firstCopilotCall = hoisted.runCopilot.mock.calls[0];
    expect(firstCopilotCall).toBeDefined();
    const firstCopilotOptions = firstCopilotCall?.[3] as AgentRunOptions | undefined;
    expect(firstCopilotOptions?.copilot?.agent).toBe('build');
    expect(firstCopilotOptions?.copilot?.streaming).toBe(true);
    expect(firstCopilotOptions?.model).toBeUndefined();
    expect(firstCopilotOptions?.modelProvider).toBeUndefined();
    expect(firstCopilotOptions?.modelReasoningEffort).toBeUndefined();
    expect(typeof firstCopilotOptions?.copilot?.onPermissionRequest).toBe('function');
    expect(typeof firstCopilotOptions?.copilot?.onUserInputRequest).toBe('function');
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

  it('materializes initial attachment files into a temporary directory for Copilot and cleans them up', async () => {
    const notifier = buildNotifier();
    const config = buildConfig(tempRoot);
    config.agent.profiles.build = {
      provider: 'copilot',
      name: 'build',
      label: 'Build',
    };

    await runAgentSessionStart({
      event: buildEvent({
        contextFiles: [
          {
            originalName: 'diagram.png',
            mediaType: 'image/png',
            byteSize: 7,
            contentBase64: Buffer.from('pngdata').toString('base64'),
          },
          {
            originalName: 'notes.md',
            mediaType: 'text/markdown',
            byteSize: 5,
            contentBase64: Buffer.from('notes').toString('base64'),
          },
        ],
      }),
      config,
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });

    const copilotOptions = hoisted.runCopilot.mock.calls[0]?.[3] as AgentRunOptions | undefined;
    expect(copilotOptions?.currentTurnAttachments).toHaveLength(2);
    expect(copilotOptions?.additionalDirectories).toHaveLength(1);
    const attachmentDirectory = copilotOptions?.additionalDirectories?.[0];
    expect(attachmentDirectory).toBeDefined();
    expect(copilotOptions?.currentTurnAttachments?.[0]).toMatchObject({
      displayName: 'diagram.png',
      mediaType: 'image/png',
    });
    expect(copilotOptions?.currentTurnAttachments?.[1]).toMatchObject({
      displayName: 'notes.md',
      mediaType: 'text/markdown',
    });
    expect(copilotOptions?.currentTurnAttachments?.every((entry) => entry.path.startsWith(`${attachmentDirectory}/`))).toBe(true);
    await expect(access(attachmentDirectory!)).rejects.toThrow();
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
    hoisted.runCopilot.mockImplementationOnce(
      async (_job, _workDir, _env, options: AgentRunOptions | undefined) => {
        await options?.onEvent?.({
          type: 'assistant.message_delta',
          data: { deltaContent: 'Copilot says hi' },
        });
        return {
          finalResponse: 'Copilot says hi',
          threadId: 'copilot-session-1',
        };
      },
    );

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
      }),
    );
    const profileCopilotCall = hoisted.runCopilot.mock.calls[0];
    expect(profileCopilotCall).toBeDefined();
    const profileCopilotOptions = profileCopilotCall?.[3] as AgentRunOptions | undefined;
    expect(profileCopilotOptions?.copilot?.agent).toBeUndefined();
  });

  it('lets named Copilot agents supply default model settings', async () => {
    const notifier = buildNotifier();
    const config = buildConfig(tempRoot);
    config.copilot.defaultModel = {
      model: 'default-copilot-model',
      modelProvider: 'openai',
      modelReasoningEffort: 'medium',
    };
    config.agent.profiles.build = {
      provider: 'copilot',
      name: 'reviewer',
      label: 'Reviewer',
    };

    await runAgentSessionStart({
      event: buildEvent(),
      config,
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });

    const copilotCall = hoisted.runCopilot.mock.calls[0];
    expect(copilotCall).toBeDefined();
    const copilotOptions = copilotCall?.[3] as AgentRunOptions | undefined;
    expect(copilotOptions?.copilot?.agent).toBe('reviewer');
    expect(copilotOptions?.model).toBeUndefined();
    expect(copilotOptions?.modelProvider).toBeUndefined();
    expect(copilotOptions?.modelReasoningEffort).toBeUndefined();
  });

  it('steers active Copilot prompts through the SDK immediate mode', async () => {
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
    const sendImmediate = vi.fn(() => Promise.resolve());
    hoisted.runCopilot.mockImplementationOnce(
      async (_job, _workDir, _env, options: AgentRunOptions | undefined) => {
        await options?.copilot?.onSessionReady?.({
          sessionId: 'copilot-session-1',
          abort: vi.fn(),
          sendImmediate,
          enqueue: vi.fn(),
        });
        return await new Promise((resolve) => {
          releasePrompt = () =>
            resolve({
              finalResponse: 'first done',
              threadId: 'copilot-session-1',
            });
        });
      },
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

    expect(sendImmediate).toHaveBeenCalledWith('steer');
    expect(hoisted.runCopilot).toHaveBeenCalledTimes(1);
    expect(notifier.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'thread-1' }),
      'Steering current prompt.',
    );
  });

  it('queues active Copilot follow-ups through the SDK enqueue mode', async () => {
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
    const enqueue = vi.fn(() => Promise.resolve());
    hoisted.runCopilot.mockImplementationOnce(
      async (_job, _workDir, _env, options: AgentRunOptions | undefined) => {
        await options?.copilot?.onSessionReady?.({
          sessionId: 'copilot-session-1',
          abort: vi.fn(),
          sendImmediate: vi.fn(),
          enqueue,
        });
        return await new Promise((resolve) => {
          releasePrompt = () =>
            resolve({
              finalResponse: 'first done',
              threadId: 'copilot-session-1',
            });
        });
      },
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
      event: buildMessageEvent({ message: 'queued', mode: 'queue' }),
      config,
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });

    releasePrompt();
    await first;

    expect(enqueue).toHaveBeenCalledWith('queued');
    expect(hoisted.runCopilot).toHaveBeenCalledTimes(1);
    expect(notifier.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'thread-1' }),
      'Follow-up queued for the current Copilot session.',
    );
  });

  it('reports Copilot steer failures while a prompt is active', async () => {
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
      async (_job, _workDir, _env, options: AgentRunOptions | undefined) => {
        await options?.copilot?.onSessionReady?.({
          sessionId: 'copilot-session-1',
          abort: vi.fn(),
          sendImmediate: vi.fn(() => Promise.reject(new Error('send failed'))),
          enqueue: vi.fn(),
        });
        return await new Promise((resolve) => {
          releasePrompt = () =>
            resolve({
              finalResponse: 'first done',
              threadId: 'copilot-session-1',
            });
        });
      },
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
      'Failed to steer current prompt: send failed',
    );
  });

  it('falls back to worker steer failure when Copilot active runtime is unavailable', async () => {
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

  it('runs Codex with the selected profile and stores the thread id', async () => {
    const notifier = buildNotifier();
    const config = buildConfig(tempRoot);
    config.agent.profiles.build = {
      provider: 'codex',
      name: 'deep-review',
      model: 'gpt-5',
      reasoningEffort: 'high',
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
    expect(hoisted.runCopilot).not.toHaveBeenCalled();
    expect(hoisted.runCodex).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: 'session-1',
        requestText: 'inspect this',
        agent: 'codex',
      }),
      tempRoot,
      {},
      expect.objectContaining({
        botName: 'Sniptail',
        promptOverride: 'inspect this',
        configProfile: 'deep-review',
        model: 'gpt-5',
        modelReasoningEffort: 'high',
      }),
    );
    expect(hoisted.updateAgentSessionCodingAgentSessionId).toHaveBeenCalledWith(
      'session-1',
      'codex-thread-1',
    );
    expect(notifier.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'thread-1' }),
      'codex final response',
    );
  });

  it('passes only image attachments to Codex and appends a note for non-image files', async () => {
    const notifier = buildNotifier();
    const config = buildConfig(tempRoot);
    config.agent.profiles.build = {
      provider: 'codex',
      name: 'deep-review',
      label: 'Build',
    };

    await runAgentSessionStart({
      event: buildEvent({
        contextFiles: [
          {
            originalName: 'diagram.png',
            mediaType: 'image/png',
            byteSize: 7,
            contentBase64: Buffer.from('pngdata').toString('base64'),
          },
          {
            originalName: 'notes.md',
            mediaType: 'text/markdown',
            byteSize: 5,
            contentBase64: Buffer.from('notes').toString('base64'),
          },
        ],
      }),
      config,
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });

    const codexCall = hoisted.runCodex.mock.calls[0];
    const codexJob = codexCall?.[0] as { requestText: string } | undefined;
    const codexOptions = codexCall?.[3] as AgentRunOptions | undefined;

    expect(codexOptions?.currentTurnAttachments).toHaveLength(1);
    expect(codexOptions?.currentTurnAttachments?.[0]).toMatchObject({
      displayName: 'diagram.png',
      mediaType: 'image/png',
    });
    expect(codexOptions?.additionalDirectories).toHaveLength(1);
    expect(codexJob?.requestText).toContain('Additional user-provided files are available for this turn:');
    expect(codexJob?.requestText).toContain('/tmp/sniptail-agent-files-');
    expect(codexJob?.requestText).toContain('notes.md');
    expect(codexJob?.requestText).not.toContain('diagram.png');
  });

  it('lets Codex config profiles supply default model settings', async () => {
    const notifier = buildNotifier();
    const config = buildConfig(tempRoot);
    config.codex.defaultModel = {
      model: 'default-codex-model',
      modelReasoningEffort: 'medium',
    };
    config.agent.profiles.build = {
      provider: 'codex',
      name: 'readonly',
      label: 'Readonly',
    };

    await runAgentSessionStart({
      event: buildEvent(),
      config,
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });

    expect(hoisted.runCodex).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'codex' }),
      tempRoot,
      {},
      expect.objectContaining({
        configProfile: 'readonly',
      }),
    );
    const codexOptions = hoisted.runCodex.mock.calls[0]?.[3] as AgentRunOptions | undefined;
    expect(codexOptions?.model).toBeUndefined();
    expect(codexOptions?.modelReasoningEffort).toBeUndefined();
  });

  it('resumes completed Codex sessions for follow-up turns', async () => {
    const notifier = buildNotifier();
    const config = buildConfig(tempRoot);
    config.agent.profiles.build = {
      provider: 'codex',
      model: 'gpt-5',
      label: 'Build',
    };
    hoisted.loadAgentSession.mockResolvedValueOnce(
      buildSession({
        agentProfileKey: 'build',
        codingAgentSessionId: 'codex-thread-9',
      }),
    );

    await runAgentSessionMessage({
      event: buildMessageEvent({ message: 'follow up' }),
      config,
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });

    expect(hoisted.runCodex).toHaveBeenCalledWith(
      expect.objectContaining({ requestText: 'follow up' }),
      tempRoot,
      {},
      expect.objectContaining({
        promptOverride: 'follow up',
        resumeThreadId: 'codex-thread-9',
      }),
    );
    const codexOptions = hoisted.runCodex.mock.calls[0]?.[3] as AgentRunOptions | undefined;
    expect(codexOptions?.currentTurnAttachments).toBeUndefined();
  });

  it('steers Codex by aborting the active prompt and running the steered message next', async () => {
    await mkdir(tempRoot, { recursive: true });
    const notifier = buildNotifier();
    const config = buildConfig(tempRoot);
    config.agent.profiles.build = {
      provider: 'codex',
      model: 'gpt-5',
      label: 'Build',
    };
    hoisted.loadAgentSession.mockResolvedValue(
      buildSession({
        status: 'completed',
        codingAgentSessionId: 'codex-thread-1',
      }),
    );

    let abortTurn: (() => void) | undefined;
    hoisted.runCodex
      .mockImplementationOnce(
        async (_job, _workDir, _env, options: AgentRunOptions | undefined) => {
          await options?.codex?.onTurnReady?.({
            threadId: 'codex-thread-1',
            abort: () => {
              abortTurn?.();
            },
          });
          return await new Promise((_, reject) => {
            abortTurn = () => reject(new Error('aborted'));
          });
        },
      )
      .mockResolvedValueOnce({
        finalResponse: 'steered done',
        threadId: 'codex-thread-1',
      });

    const first = runAgentSessionMessage({
      event: buildMessageEvent({ message: 'first' }),
      config,
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });
    await vi.waitFor(() => expect(getActiveCodexRuntime('session-1')).toBeDefined());

    await runAgentSessionMessage({
      event: buildMessageEvent({ message: 'steered', mode: 'steer' }),
      config,
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });
    await first;

    expect(hoisted.runCodex).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ requestText: 'steered' }),
      tempRoot,
      {},
      expect.objectContaining({ resumeThreadId: 'codex-thread-1' }),
    );
    expect(hoisted.updateAgentSessionStatus).not.toHaveBeenCalledWith('session-1', 'failed');
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
        opencode: expect.objectContaining({ agent: 'build', executionMode: 'local' }) as unknown,
      }),
    );
    const openCodeCall = hoisted.runOpenCodePrompt.mock.calls[0];
    expect(openCodeCall).toBeDefined();
    const openCodeOptions = openCodeCall?.[3] as AgentRunOptions | undefined;
    expect(openCodeOptions?.model).toBeUndefined();
    expect(openCodeOptions?.modelProvider).toBeUndefined();
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

  it('lets named OpenCode agents supply default model settings', async () => {
    const notifier = buildNotifier();
    const config = buildConfig(tempRoot);
    config.opencode.defaultModel = {
      provider: 'anthropic',
      model: 'default-opencode-model',
    };
    config.agent.profiles.build = {
      provider: 'opencode',
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

    expect(hoisted.runOpenCodePrompt).toHaveBeenCalledWith(
      'inspect this',
      tempRoot,
      {},
      expect.objectContaining({
        botName: 'Sniptail',
        opencode: expect.objectContaining({ agent: 'build', executionMode: 'local' }) as unknown,
      }),
    );
    const openCodeCall = hoisted.runOpenCodePrompt.mock.calls[0];
    expect(openCodeCall).toBeDefined();
    const openCodeOptions = openCodeCall?.[3] as AgentRunOptions | undefined;
    expect(openCodeOptions?.model).toBeUndefined();
    expect(openCodeOptions?.modelProvider).toBeUndefined();
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
    const openCodeOptions = hoisted.runOpenCodePrompt.mock.calls[0]?.[3] as
      | OpenCodePromptRunOptions
      | undefined;
    expect(openCodeOptions?.currentTurnAttachments).toBeUndefined();
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
