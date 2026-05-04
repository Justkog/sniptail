import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import type { BotEvent } from '@sniptail/core/types/bot-event.js';
import type { CoreWorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { Notifier } from '../channels/notifier.js';
import {
  clearActiveOpenCodeRuntimes,
  setActiveOpenCodeRuntime,
  setPendingOpenCodeInteraction,
} from './activeOpenCodeRuntimes.js';

const hoisted = vi.hoisted(() => ({
  loadAgentSession: vi.fn(),
  replyOpenCodePermission: vi.fn(),
  replyOpenCodeQuestion: vi.fn(),
  rejectOpenCodeQuestion: vi.fn(),
}));

vi.mock('@sniptail/core/agent-sessions/registry.js', () => ({
  loadAgentSession: hoisted.loadAgentSession,
}));

vi.mock('@sniptail/core/opencode/prompt.js', () => ({
  replyOpenCodePermission: hoisted.replyOpenCodePermission,
  replyOpenCodeQuestion: hoisted.replyOpenCodeQuestion,
  rejectOpenCodeQuestion: hoisted.rejectOpenCodeQuestion,
}));

import { resolveAgentInteraction } from './resolveOpenCodeInteraction.js';

function buildConfig(): WorkerConfig {
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
    copilot: { executionMode: 'local', idleRetries: 3 },
    opencode: {
      executionMode: 'local',
      startupTimeoutMs: 10_000,
      dockerStreamLogs: false,
    },
    includeRawRequestInMr: false,
    agent: {
      enabled: true,
      interactionTimeoutMs: 1_800_000,
      outputDebounceMs: 15_000,
      workspaces: {},
      profiles: {},
    },
    run: { actions: {} },
    codex: { executionMode: 'local' },
  };
}

function buildEvent(
  decision: 'once' | 'always' | 'reject' = 'once',
): CoreWorkerEvent<'agent.interaction.resolve'> {
  return {
    schemaVersion: 1,
    type: 'agent.interaction.resolve',
    payload: {
      sessionId: 'session-1',
      response: {
        provider: 'discord',
        channelId: 'thread-1',
        threadId: 'thread-1',
        userId: 'user-1',
      },
      interactionId: 'interaction-1',
      resolution: {
        kind: 'permission',
        decision,
        message: 'approved from Discord',
      },
    },
  };
}

function buildQuestionEvent(
  resolution: CoreWorkerEvent<'agent.interaction.resolve'>['payload']['resolution'] = {
    kind: 'question',
    answers: [['Worker']],
  },
): CoreWorkerEvent<'agent.interaction.resolve'> {
  return {
    schemaVersion: 1,
    type: 'agent.interaction.resolve',
    payload: {
      sessionId: 'session-1',
      response: {
        provider: 'discord',
        channelId: 'thread-1',
        threadId: 'thread-1',
        userId: 'user-1',
      },
      interactionId: 'interaction-1',
      resolution,
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

function buildBotEvents() {
  return {
    publish: vi.fn(),
  };
}

function buildPermissionRequestEvent(interactionId: string): BotEvent {
  return {
    schemaVersion: 1,
    provider: 'discord',
    type: 'agent.permission.requested',
    payload: {
      channelId: 'thread-1',
      threadId: 'thread-1',
      sessionId: 'session-1',
      interactionId,
      workspaceKey: 'snatch',
      toolName: 'bash',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      allowAlways: true,
    },
  };
}

describe('resolve OpenCode agent interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearActiveOpenCodeRuntimes();
    hoisted.loadAgentSession.mockResolvedValue({ status: 'active' });
    hoisted.replyOpenCodePermission.mockResolvedValue(undefined);
    hoisted.replyOpenCodeQuestion.mockResolvedValue(undefined);
    hoisted.rejectOpenCodeQuestion.mockResolvedValue(undefined);
    setActiveOpenCodeRuntime('session-1', {
      codingAgentSessionId: 'opencode-session-1',
      baseUrl: 'http://127.0.0.1:4096',
      directory: '/tmp/work',
      executionMode: 'local',
    });
    setPendingOpenCodeInteraction({
      sessionId: 'session-1',
      interactionId: 'interaction-1',
      kind: 'permission',
      displayState: 'visible',
      requestId: 'permission-request-1',
      baseUrl: 'http://127.0.0.1:4096',
      directory: '/tmp/work',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      requestEvent: buildPermissionRequestEvent('interaction-1'),
    });
  });

  it('replies to OpenCode permission requests and waits for OpenCode reply events', async () => {
    const notifier = buildNotifier();
    const botEvents = buildBotEvents();

    await resolveAgentInteraction({
      event: buildEvent('always'),
      config: buildConfig(),
      notifier,
      botEvents,
      env: {},
    });

    expect(hoisted.replyOpenCodePermission).toHaveBeenCalledWith(
      '/tmp/work',
      {},
      expect.objectContaining({
        baseUrl: 'http://127.0.0.1:4096',
        requestID: 'permission-request-1',
        reply: 'always',
      }),
    );
    expect(botEvents.publish).not.toHaveBeenCalled();
    expect(notifier.postMessage).not.toHaveBeenCalled();
  });

  it('does not reply twice after a permission reply is sent', async () => {
    const notifier = buildNotifier();

    await resolveAgentInteraction({
      event: buildEvent('always'),
      config: buildConfig(),
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });
    await resolveAgentInteraction({
      event: buildEvent('always'),
      config: buildConfig(),
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });

    expect(hoisted.replyOpenCodePermission).toHaveBeenCalledTimes(1);
    expect(notifier.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({ channelId: 'thread-1' }),
      'This agent permission is already being resolved.',
    );
  });

  it('publishes failed permission updates and promotes the next queued permission on reply failure', async () => {
    hoisted.replyOpenCodePermission.mockRejectedValueOnce(new Error('reply failed'));
    setPendingOpenCodeInteraction({
      sessionId: 'session-1',
      interactionId: 'interaction-2',
      kind: 'permission',
      displayState: 'queued',
      requestId: 'permission-request-2',
      baseUrl: 'http://127.0.0.1:4096',
      directory: '/tmp/work',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      requestEvent: buildPermissionRequestEvent('interaction-2'),
    });
    const notifier = buildNotifier();
    const botEvents = buildBotEvents();

    await resolveAgentInteraction({
      event: buildEvent('reject'),
      config: buildConfig(),
      notifier,
      botEvents,
      env: {},
    });

    const published = botEvents.publish.mock.calls.map((call) => call[0] as BotEvent);
    expect(published[0]).toMatchObject({
      type: 'agent.permission.updated',
      payload: { interactionId: 'interaction-1', status: 'failed' },
    });
    expect(published[1]).toMatchObject({
      type: 'agent.permission.requested',
      payload: { interactionId: 'interaction-2' },
    });
  });

  it('does not call OpenCode when the permission is no longer pending', async () => {
    clearActiveOpenCodeRuntimes();
    setActiveOpenCodeRuntime('session-1', {
      codingAgentSessionId: 'opencode-session-1',
      baseUrl: 'http://127.0.0.1:4096',
      directory: '/tmp/work',
      executionMode: 'local',
    });
    const notifier = buildNotifier();

    await resolveAgentInteraction({
      event: buildEvent('reject'),
      config: buildConfig(),
      notifier,
      botEvents: buildBotEvents(),
      env: {},
    });

    expect(hoisted.replyOpenCodePermission).not.toHaveBeenCalled();
    expect(notifier.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'thread-1' }),
      'This agent interaction is no longer pending.',
    );
  });

  it('replies to OpenCode question requests and publishes Discord updates', async () => {
    clearActiveOpenCodeRuntimes();
    setActiveOpenCodeRuntime('session-1', {
      codingAgentSessionId: 'opencode-session-1',
      baseUrl: 'http://127.0.0.1:4096',
      directory: '/tmp/work',
      executionMode: 'local',
    });
    setPendingOpenCodeInteraction({
      sessionId: 'session-1',
      interactionId: 'interaction-1',
      kind: 'question',
      requestId: 'question-request-1',
      baseUrl: 'http://127.0.0.1:4096',
      directory: '/tmp/work',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const notifier = buildNotifier();
    const botEvents = buildBotEvents();

    await resolveAgentInteraction({
      event: buildQuestionEvent({ kind: 'question', answers: [['Worker'], ['Tests', 'Build']] }),
      config: buildConfig(),
      notifier,
      botEvents,
      env: {},
    });

    expect(hoisted.replyOpenCodeQuestion).toHaveBeenCalledWith(
      '/tmp/work',
      {},
      expect.objectContaining({
        requestID: 'question-request-1',
        answers: [['Worker'], ['Tests', 'Build']],
      }),
    );
    const published = botEvents.publish.mock.calls[0]?.[0] as BotEvent | undefined;
    expect(published).toMatchObject({
      type: 'agent.question.updated',
      payload: {
        status: 'answered',
        actorUserId: 'user-1',
      },
    });
  });

  it('rejects OpenCode question requests when requested', async () => {
    clearActiveOpenCodeRuntimes();
    setActiveOpenCodeRuntime('session-1', {
      codingAgentSessionId: 'opencode-session-1',
      baseUrl: 'http://127.0.0.1:4096',
      directory: '/tmp/work',
      executionMode: 'local',
    });
    setPendingOpenCodeInteraction({
      sessionId: 'session-1',
      interactionId: 'interaction-1',
      kind: 'question',
      requestId: 'question-request-1',
      baseUrl: 'http://127.0.0.1:4096',
      directory: '/tmp/work',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const botEvents = buildBotEvents();

    await resolveAgentInteraction({
      event: buildQuestionEvent({ kind: 'question', reject: true }),
      config: buildConfig(),
      notifier: buildNotifier(),
      botEvents,
      env: {},
    });

    expect(hoisted.rejectOpenCodeQuestion).toHaveBeenCalledWith(
      '/tmp/work',
      {},
      expect.objectContaining({ requestID: 'question-request-1' }),
    );
    const published = botEvents.publish.mock.calls[0]?.[0] as BotEvent | undefined;
    expect(published).toMatchObject({
      type: 'agent.question.updated',
      payload: { status: 'rejected' },
    });
  });
});
