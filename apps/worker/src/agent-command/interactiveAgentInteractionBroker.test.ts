import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BotEvent } from '@sniptail/core/types/bot-event.js';
import {
  clearBrokeredCopilotInteractions,
  requestCopilotPermission,
  requestCopilotUserInput,
  resolveBrokeredCopilotInteraction,
} from './interactiveAgentInteractionBroker.js';

function buildResponse() {
  return {
    provider: 'discord' as const,
    channelId: 'thread-1',
    threadId: 'thread-1',
    userId: 'user-1',
  };
}

function buildBotEvents() {
  return {
    publish: vi.fn(() => Promise.resolve()),
  };
}

function buildNotifier() {
  return {
    postMessage: vi.fn(() => Promise.resolve()),
    uploadFile: vi.fn(),
    addReaction: vi.fn(),
  };
}

function buildPermissionResolveEvent(
  interactionId: string,
  decision: 'once' | 'always' | 'reject' = 'once',
) {
  return {
    schemaVersion: 1 as const,
    type: 'agent.interaction.resolve' as const,
    payload: {
      sessionId: 'session-1',
      response: buildResponse(),
      interactionId,
      resolution: {
        kind: 'permission' as const,
        decision,
      },
    },
  };
}

function buildQuestionResolveEvent(
  interactionId: string,
  resolution:
    | { kind: 'question'; answers?: string[][]; reject?: boolean; message?: string }
    | undefined = { kind: 'question', answers: [['Worker']] },
) {
  return {
    schemaVersion: 1 as const,
    type: 'agent.interaction.resolve' as const,
    payload: {
      sessionId: 'session-1',
      response: buildResponse(),
      interactionId,
      resolution: resolution ?? { kind: 'question' as const, answers: [['Worker']] },
    },
  };
}

describe('interactiveAgentInteractionBroker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await clearBrokeredCopilotInteractions({ sessionId: 'session-1' });
  });

  it('publishes Copilot permission requests and resolves approve once', async () => {
    const botEvents = buildBotEvents();
    const notifier = buildNotifier();
    const pending = requestCopilotPermission({
      sessionId: 'session-1',
      response: buildResponse(),
      workspaceKey: 'snatch',
      timeoutMs: 60_000,
      botEvents,
      request: { kind: 'read' },
    });

    await vi.waitFor(() => expect(botEvents.publish).toHaveBeenCalledTimes(1));
    const requestEvent = botEvents.publish.mock.calls[0]?.[0] as BotEvent;

    expect(requestEvent).toMatchObject({
      type: 'agent.permission.requested',
      payload: {
        sessionId: 'session-1',
        interactionId: expect.any(String),
        toolName: 'read',
        allowAlways: true,
      },
    });

    await resolveBrokeredCopilotInteraction({
      event: buildPermissionResolveEvent(requestEvent.payload.interactionId, 'once'),
      notifier,
      botEvents,
    });

    await expect(pending).resolves.toEqual({ kind: 'approve-once' });
    expect(botEvents.publish.mock.calls[1]?.[0]).toMatchObject({
      type: 'agent.permission.updated',
      payload: { status: 'approved_once' },
    });
  });

  it('queues Copilot permission requests and promotes the next request after resolution', async () => {
    const botEvents = buildBotEvents();
    const notifier = buildNotifier();
    const first = requestCopilotPermission({
      sessionId: 'session-1',
      response: buildResponse(),
      workspaceKey: 'snatch',
      timeoutMs: 60_000,
      botEvents,
      request: { kind: 'read' },
    });
    const second = requestCopilotPermission({
      sessionId: 'session-1',
      response: buildResponse(),
      workspaceKey: 'snatch',
      timeoutMs: 60_000,
      botEvents,
      request: { kind: 'write' },
    });

    await vi.waitFor(() => expect(botEvents.publish).toHaveBeenCalledTimes(1));
    const firstEvent = botEvents.publish.mock.calls[0]?.[0] as BotEvent;

    await resolveBrokeredCopilotInteraction({
      event: buildPermissionResolveEvent(firstEvent.payload.interactionId, 'once'),
      notifier,
      botEvents,
    });

    await expect(first).resolves.toEqual({ kind: 'approve-once' });
    await vi.waitFor(() => expect(botEvents.publish).toHaveBeenCalledTimes(3));
    expect(botEvents.publish.mock.calls[2]?.[0]).toMatchObject({
      type: 'agent.permission.requested',
      payload: { toolName: 'write' },
    });

    await clearBrokeredCopilotInteractions({ sessionId: 'session-1' });
    await expect(second).resolves.toEqual({ kind: 'user-not-available' });
  });

  it('resolves queued matching Copilot permissions when always allow is selected', async () => {
    const botEvents = buildBotEvents();
    const notifier = buildNotifier();
    const first = requestCopilotPermission({
      sessionId: 'session-1',
      response: buildResponse(),
      workspaceKey: 'snatch',
      timeoutMs: 60_000,
      botEvents,
      request: { kind: 'read' },
    });
    const second = requestCopilotPermission({
      sessionId: 'session-1',
      response: buildResponse(),
      workspaceKey: 'snatch',
      timeoutMs: 60_000,
      botEvents,
      request: { kind: 'read' },
    });
    const third = requestCopilotPermission({
      sessionId: 'session-1',
      response: buildResponse(),
      workspaceKey: 'snatch',
      timeoutMs: 60_000,
      botEvents,
      request: { kind: 'write' },
    });

    await vi.waitFor(() => expect(botEvents.publish).toHaveBeenCalledTimes(1));
    const firstEvent = botEvents.publish.mock.calls[0]?.[0] as BotEvent;

    await resolveBrokeredCopilotInteraction({
      event: buildPermissionResolveEvent(firstEvent.payload.interactionId, 'always'),
      notifier,
      botEvents,
    });

    const sessionDecision = {
      kind: 'approve-for-session' as const,
      approval: { kind: 'read' as const },
    };
    await expect(first).resolves.toEqual(sessionDecision);
    await expect(second).resolves.toEqual(sessionDecision);

    await vi.waitFor(() => expect(botEvents.publish).toHaveBeenCalledTimes(3));
    expect(botEvents.publish.mock.calls[1]?.[0]).toMatchObject({
      type: 'agent.permission.updated',
      payload: { status: 'approved_always' },
    });
    expect(botEvents.publish.mock.calls[2]?.[0]).toMatchObject({
      type: 'agent.permission.requested',
      payload: { toolName: 'write' },
    });

    await clearBrokeredCopilotInteractions({ sessionId: 'session-1' });
    await expect(third).resolves.toEqual({ kind: 'user-not-available' });
  });

  it('expires visible Copilot permission requests', async () => {
    vi.useFakeTimers();
    const botEvents = buildBotEvents();
    const pending = requestCopilotPermission({
      sessionId: 'session-1',
      response: buildResponse(),
      workspaceKey: 'snatch',
      timeoutMs: 100,
      botEvents,
      request: { kind: 'read' },
    });

    await vi.waitFor(() => expect(botEvents.publish).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(100);

    await expect(pending).resolves.toEqual({ kind: 'user-not-available' });
    expect(botEvents.publish.mock.calls[1]?.[0]).toMatchObject({
      type: 'agent.permission.updated',
      payload: { status: 'expired' },
    });
    vi.useRealTimers();
  });

  it('does not expose always allow for unsupported Copilot permission kinds', async () => {
    const botEvents = buildBotEvents();
    const pending = requestCopilotPermission({
      sessionId: 'session-1',
      response: buildResponse(),
      workspaceKey: 'snatch',
      timeoutMs: 60_000,
      botEvents,
      request: { kind: 'shell' },
    });

    await vi.waitFor(() => expect(botEvents.publish).toHaveBeenCalledTimes(1));
    const requestEvent = botEvents.publish.mock.calls[0]?.[0] as BotEvent;

    expect(requestEvent).toMatchObject({
      type: 'agent.permission.requested',
      payload: {
        toolName: 'shell',
        allowAlways: false,
      },
    });

    await clearBrokeredCopilotInteractions({ sessionId: 'session-1' });
    await expect(pending).resolves.toEqual({ kind: 'user-not-available' });
  });

  it('rejects always decisions for unsupported Copilot permission kinds', async () => {
    const botEvents = buildBotEvents();
    const notifier = buildNotifier();
    const pending = requestCopilotPermission({
      sessionId: 'session-1',
      response: buildResponse(),
      workspaceKey: 'snatch',
      timeoutMs: 60_000,
      botEvents,
      request: { kind: 'shell' },
    });

    await vi.waitFor(() => expect(botEvents.publish).toHaveBeenCalledTimes(1));
    const requestEvent = botEvents.publish.mock.calls[0]?.[0] as BotEvent;

    await resolveBrokeredCopilotInteraction({
      event: buildPermissionResolveEvent(requestEvent.payload.interactionId, 'always'),
      notifier,
      botEvents,
    });

    expect(notifier.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'thread-1' }),
      'This agent interaction no longer matches the selected control.',
    );
    expect(botEvents.publish).toHaveBeenCalledTimes(1);

    await clearBrokeredCopilotInteractions({ sessionId: 'session-1' });
    await expect(pending).resolves.toEqual({ kind: 'user-not-available' });
  });

  it('publishes Copilot question requests and resolves answers', async () => {
    const botEvents = buildBotEvents();
    const notifier = buildNotifier();
    const pending = requestCopilotUserInput({
      sessionId: 'session-1',
      response: buildResponse(),
      workspaceKey: 'snatch',
      timeoutMs: 60_000,
      botEvents,
      request: {
        question: 'Which package should I edit?',
        choices: ['Worker', 'Bot'],
        allowFreeform: false,
      },
    });

    await vi.waitFor(() => expect(botEvents.publish).toHaveBeenCalledTimes(1));
    const requestEvent = botEvents.publish.mock.calls[0]?.[0] as BotEvent;

    expect(requestEvent).toMatchObject({
      type: 'agent.question.requested',
      payload: {
        questions: [
          {
            question: 'Which package should I edit?',
            custom: false,
          },
        ],
      },
    });

    await resolveBrokeredCopilotInteraction({
      event: buildQuestionResolveEvent(requestEvent.payload.interactionId),
      notifier,
      botEvents,
    });

    await expect(pending).resolves.toEqual({
      answer: 'Worker',
      wasFreeform: false,
    });
    expect(botEvents.publish.mock.calls[1]?.[0]).toMatchObject({
      type: 'agent.question.updated',
      payload: { status: 'answered' },
    });
  });

  it('marks Copilot freeform answers correctly', async () => {
    const botEvents = buildBotEvents();
    const notifier = buildNotifier();
    const pending = requestCopilotUserInput({
      sessionId: 'session-1',
      response: buildResponse(),
      workspaceKey: 'snatch',
      timeoutMs: 60_000,
      botEvents,
      request: {
        question: 'Which package should I edit?',
        choices: ['Worker', 'Bot'],
        allowFreeform: true,
      },
    });

    await vi.waitFor(() => expect(botEvents.publish).toHaveBeenCalledTimes(1));
    const requestEvent = botEvents.publish.mock.calls[0]?.[0] as BotEvent;

    await resolveBrokeredCopilotInteraction({
      event: buildQuestionResolveEvent(requestEvent.payload.interactionId, {
        kind: 'question',
        answers: [['Custom package']],
      }),
      notifier,
      botEvents,
    });

    await expect(pending).resolves.toEqual({
      answer: 'Custom package',
      wasFreeform: true,
    });
    expect(botEvents.publish.mock.calls[1]?.[0]).toMatchObject({
      type: 'agent.question.updated',
      payload: { status: 'answered' },
    });
  });

  it('rejects multi-question answers for Copilot user input', async () => {
    const botEvents = buildBotEvents();
    const notifier = buildNotifier();
    const pending = requestCopilotUserInput({
      sessionId: 'session-1',
      response: buildResponse(),
      workspaceKey: 'snatch',
      timeoutMs: 60_000,
      botEvents,
      request: {
        question: 'Which package should I edit?',
      },
    });

    await vi.waitFor(() => expect(botEvents.publish).toHaveBeenCalledTimes(1));
    const requestEvent = botEvents.publish.mock.calls[0]?.[0] as BotEvent;

    await resolveBrokeredCopilotInteraction({
      event: buildQuestionResolveEvent(requestEvent.payload.interactionId, {
        kind: 'question',
        answers: [['Worker'], ['Bot']],
      }),
      notifier,
      botEvents,
    });

    expect(notifier.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'thread-1' }),
      'Copilot user input expects a single answer.',
    );
    expect(botEvents.publish).toHaveBeenCalledTimes(1);

    await clearBrokeredCopilotInteractions({ sessionId: 'session-1' });
    await expect(pending).rejects.toThrow('Agent session ended before this interaction was resolved.');
  });

  it('rejects multi-select answers for Copilot user input', async () => {
    const botEvents = buildBotEvents();
    const notifier = buildNotifier();
    const pending = requestCopilotUserInput({
      sessionId: 'session-1',
      response: buildResponse(),
      workspaceKey: 'snatch',
      timeoutMs: 60_000,
      botEvents,
      request: {
        question: 'Which package should I edit?',
      },
    });

    await vi.waitFor(() => expect(botEvents.publish).toHaveBeenCalledTimes(1));
    const requestEvent = botEvents.publish.mock.calls[0]?.[0] as BotEvent;

    await resolveBrokeredCopilotInteraction({
      event: buildQuestionResolveEvent(requestEvent.payload.interactionId, {
        kind: 'question',
        answers: [['Worker', 'Bot']],
      }),
      notifier,
      botEvents,
    });

    expect(notifier.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'thread-1' }),
      'Copilot user input expects a single answer.',
    );
    expect(botEvents.publish).toHaveBeenCalledTimes(1);

    await clearBrokeredCopilotInteractions({ sessionId: 'session-1' });
    await expect(pending).rejects.toThrow('Agent session ended before this interaction was resolved.');
  });

  it('rejects Copilot question requests', async () => {
    const botEvents = buildBotEvents();
    const notifier = buildNotifier();
    const pending = requestCopilotUserInput({
      sessionId: 'session-1',
      response: buildResponse(),
      workspaceKey: 'snatch',
      timeoutMs: 60_000,
      botEvents,
      request: {
        question: 'Which package should I edit?',
      },
    });

    await vi.waitFor(() => expect(botEvents.publish).toHaveBeenCalledTimes(1));
    const requestEvent = botEvents.publish.mock.calls[0]?.[0] as BotEvent;

    await resolveBrokeredCopilotInteraction({
      event: buildQuestionResolveEvent(requestEvent.payload.interactionId, {
        kind: 'question',
        reject: true,
        message: 'No answer',
      }),
      notifier,
      botEvents,
    });

    await expect(pending).rejects.toThrow('No answer');
    expect(botEvents.publish.mock.calls[1]?.[0]).toMatchObject({
      type: 'agent.question.updated',
      payload: { status: 'rejected' },
    });
  });
});
