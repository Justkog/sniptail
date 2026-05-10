import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BotEvent } from '@sniptail/core/types/bot-event.js';
import type { CoreWorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { Notifier } from '../channels/notifier.js';
import {
  clearAcpQuestionInteractions,
  requestAcpQuestion,
  resolveAcpQuestionInteraction,
} from './acpQuestionBridge.js';

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

function buildResponse() {
  return {
    provider: 'discord' as const,
    channelId: 'thread-1',
    threadId: 'thread-1',
    userId: 'user-1',
  };
}

function getPublishedInteractionId(botEvents: ReturnType<typeof buildBotEvents>): string {
  const event = botEvents.publish.mock.calls[0]?.[0] as BotEvent | undefined;
  if (!event || event.type !== 'agent.question.requested') {
    throw new Error('Missing question request event');
  }
  return event.payload.interactionId;
}

function buildResolveEvent(
  interactionId: string,
  answers?: string[][],
  reject = false,
): CoreWorkerEvent<'agent.interaction.resolve'> {
  return {
    schemaVersion: 1,
    type: 'agent.interaction.resolve',
    payload: {
      sessionId: 'session-1',
      response: buildResponse(),
      interactionId,
      resolution: {
        kind: 'question',
        ...(answers ? { answers } : {}),
        ...(reject ? { reject: true } : {}),
        message: 'resolved from Discord',
      },
    },
  };
}

describe('ACP question bridge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await clearAcpQuestionInteractions({ sessionId: 'session-1' });
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('publishes ACP form elicitations as Sniptail question requests and flushes output first', async () => {
    const botEvents = buildBotEvents();
    const callOrder: string[] = [];
    const pending = requestAcpQuestion({
      sessionId: 'session-1',
      response: buildResponse(),
      workspaceKey: 'snatch',
      cwd: '/tmp/work',
      timeoutMs: 60_000,
      botEvents,
      flushOutput: async () => {
        callOrder.push('flush');
        await Promise.resolve();
      },
      request: {
        mode: 'form',
        sessionId: 'acp-session-1',
        message: 'Provide build settings.',
        requestedSchema: {
          type: 'object',
          required: ['package'],
          properties: {
            package: {
              type: 'string',
              title: 'Package',
              oneOf: [
                { const: 'core', title: 'Core' },
                { const: 'worker', title: 'Worker' },
              ],
            },
          },
        },
      },
    });

    await vi.waitFor(() => expect(botEvents.publish).toHaveBeenCalledTimes(1));
    callOrder.push('publish');

    expect(callOrder).toEqual(['flush', 'publish']);
    expect(botEvents.publish.mock.calls[0]?.[0]).toMatchObject({
      type: 'agent.question.requested',
      payload: {
        workspaceKey: 'snatch',
        cwd: '/tmp/work',
        questions: [
          {
            header: 'Package',
            options: [{ label: 'Core' }, { label: 'Worker' }],
            multiple: false,
            custom: false,
          },
        ],
      },
    });

    await resolveAcpQuestionInteraction({
      event: buildResolveEvent(getPublishedInteractionId(botEvents), [['Worker']]),
      notifier: buildNotifier(),
      botEvents,
    });

    await expect(pending).resolves.toEqual({
      action: 'accept',
      content: {
        package: 'worker',
      },
    });
  });

  it('coerces mixed ACP answers into typed elicitation content', async () => {
    const botEvents = buildBotEvents();
    const pending = requestAcpQuestion({
      sessionId: 'session-1',
      response: buildResponse(),
      workspaceKey: 'snatch',
      timeoutMs: 60_000,
      botEvents,
      request: {
        mode: 'form',
        sessionId: 'acp-session-1',
        message: 'Configure the run.',
        requestedSchema: {
          type: 'object',
          required: ['title', 'count', 'enabled', 'targets'],
          properties: {
            title: { type: 'string', title: 'Title' },
            count: { type: 'integer', title: 'Count' },
            enabled: { type: 'boolean', title: 'Enabled' },
            targets: {
              type: 'array',
              title: 'Targets',
              items: { enum: ['api', 'worker'], type: 'string' },
            },
            score: { type: 'number', title: 'Score' },
          },
        },
      },
    });

    await vi.waitFor(() => expect(botEvents.publish).toHaveBeenCalledTimes(1));

    await resolveAcpQuestionInteraction({
      event: buildResolveEvent(getPublishedInteractionId(botEvents), [
        ['Release build'],
        ['3'],
        ['True'],
        ['api', 'worker'],
        ['1.5'],
      ]),
      notifier: buildNotifier(),
      botEvents,
    });

    await expect(pending).resolves.toEqual({
      action: 'accept',
      content: {
        title: 'Release build',
        count: 3,
        enabled: true,
        targets: ['api', 'worker'],
        score: 1.5,
      },
    });
  });

  it('returns decline when the user rejects the ACP elicitation', async () => {
    const botEvents = buildBotEvents();
    const pending = requestAcpQuestion({
      sessionId: 'session-1',
      response: buildResponse(),
      workspaceKey: 'snatch',
      timeoutMs: 60_000,
      botEvents,
      request: {
        mode: 'form',
        sessionId: 'acp-session-1',
        message: 'Provide a title.',
        requestedSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', title: 'Title' },
          },
        },
      },
    });

    await vi.waitFor(() => expect(botEvents.publish).toHaveBeenCalledTimes(1));

    await resolveAcpQuestionInteraction({
      event: buildResolveEvent(getPublishedInteractionId(botEvents), undefined, true),
      notifier: buildNotifier(),
      botEvents,
    });

    await expect(pending).resolves.toEqual({ action: 'decline' });
  });

  it('expires ACP question requests as cancelled', async () => {
    const botEvents = buildBotEvents();
    const pending = requestAcpQuestion({
      sessionId: 'session-1',
      response: buildResponse(),
      workspaceKey: 'snatch',
      timeoutMs: 100,
      botEvents,
      request: {
        mode: 'form',
        sessionId: 'acp-session-1',
        message: 'Provide a title.',
        requestedSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', title: 'Title' },
          },
        },
      },
    });

    await vi.waitFor(() =>
      expect(botEvents.publish.mock.calls[0]?.[0]).toMatchObject({
        type: 'agent.question.requested',
      }),
    );
    await vi.advanceTimersByTimeAsync(100);

    await expect(pending).resolves.toEqual({ action: 'cancel' });
    const published = botEvents.publish.mock.calls.map((call) => call[0] as BotEvent);
    expect(published[1]).toMatchObject({
      type: 'agent.question.updated',
      payload: { status: 'expired' },
    });
  });

  it('fails closed on unsupported ACP URL elicitations', async () => {
    const botEvents = buildBotEvents();

    await expect(
      requestAcpQuestion({
        sessionId: 'session-1',
        response: buildResponse(),
        workspaceKey: 'snatch',
        timeoutMs: 60_000,
        botEvents,
        request: {
          mode: 'url',
          requestId: 1,
          elicitationId: 'elicitation-1',
          url: 'https://example.com/complete',
          message: 'Open the form.',
        },
      }),
    ).resolves.toEqual({ action: 'cancel' });

    expect(botEvents.publish).not.toHaveBeenCalled();
  });

  it('keeps ACP question requests pending when the submitted answer is invalid', async () => {
    const botEvents = buildBotEvents();
    const notifier = buildNotifier();
    const pending = requestAcpQuestion({
      sessionId: 'session-1',
      response: buildResponse(),
      workspaceKey: 'snatch',
      timeoutMs: 60_000,
      botEvents,
      request: {
        mode: 'form',
        sessionId: 'acp-session-1',
        message: 'Provide a count.',
        requestedSchema: {
          type: 'object',
          required: ['count'],
          properties: {
            count: { type: 'integer', title: 'Count' },
          },
        },
      },
    });

    await vi.waitFor(() => expect(botEvents.publish).toHaveBeenCalledTimes(1));
    const interactionId = getPublishedInteractionId(botEvents);

    await resolveAcpQuestionInteraction({
      event: buildResolveEvent(interactionId, [['not-a-number']]),
      notifier,
      botEvents,
    });

    expect(notifier.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'thread-1' }),
      'Count must be a valid number.',
    );
    expect(botEvents.publish).toHaveBeenCalledTimes(1);

    await resolveAcpQuestionInteraction({
      event: buildResolveEvent(interactionId, [['4']]),
      notifier,
      botEvents,
    });

    await expect(pending).resolves.toEqual({
      action: 'accept',
      content: {
        count: 4,
      },
    });
  });
});
