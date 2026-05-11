import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BotEvent } from '@sniptail/core/types/bot-event.js';
import type { CoreWorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { Notifier } from '../channels/notifier.js';
import {
  clearAcpPermissionInteractions,
  requestAcpPermission,
  resolveAcpPermissionInteraction,
} from './acpPermissionBridge.js';

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

function buildRequest(
  optionKinds: Array<'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'> = [
    'allow_once',
    'allow_always',
    'reject_once',
  ],
) {
  return {
    sessionId: 'acp-session-1',
    options: optionKinds.map((kind) => ({
      optionId: kind,
      name: kind,
      kind,
    })),
    toolCall: {
      toolCallId: 'tool-1',
      title: 'Read README',
      kind: 'read' as const,
      locations: [{ path: '/tmp/work/README.md', line: 12 }],
      rawInput: { path: '/tmp/work/README.md' },
    },
  };
}

function getPublishedInteractionId(botEvents: ReturnType<typeof buildBotEvents>): string {
  const event = botEvents.publish.mock.calls[0]?.[0] as BotEvent | undefined;
  if (!event || event.type !== 'agent.permission.requested') {
    throw new Error('Missing permission request event');
  }
  return event.payload.interactionId;
}

function buildResolveEvent(
  interactionId: string,
  decision: 'once' | 'always' | 'reject' = 'once',
): CoreWorkerEvent<'agent.interaction.resolve'> {
  return {
    schemaVersion: 1,
    type: 'agent.interaction.resolve',
    payload: {
      sessionId: 'session-1',
      response: buildResponse(),
      interactionId,
      resolution: {
        kind: 'permission',
        decision,
        message: 'resolved from Discord',
      },
    },
  };
}

describe('ACP permission bridge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(async () => {
    await clearAcpPermissionInteractions({ sessionId: 'session-1' });
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('publishes ACP permission requests and resolves approve once to the selected option id', async () => {
    const botEvents = buildBotEvents();
    const pending = requestAcpPermission({
      sessionId: 'session-1',
      response: buildResponse(),
      workspaceKey: 'snatch',
      cwd: '/tmp/work',
      timeoutMs: 60_000,
      botEvents,
      request: buildRequest(),
    });

    await vi.waitFor(() => expect(botEvents.publish).toHaveBeenCalledTimes(1));
    const published = botEvents.publish.mock.calls[0]?.[0] as BotEvent | undefined;
    expect(published).toMatchObject({
      type: 'agent.permission.requested',
      payload: {
        workspaceKey: 'snatch',
        cwd: '/tmp/work',
        toolName: 'read',
        action: 'Read README',
        allowAlways: true,
      },
    });

    await resolveAcpPermissionInteraction({
      event: buildResolveEvent(getPublishedInteractionId(botEvents), 'once'),
      notifier: buildNotifier(),
      botEvents,
    });

    await expect(pending).resolves.toEqual({
      outcome: {
        outcome: 'selected',
        optionId: 'allow_once',
      },
    });
  });

  it('queues ACP permission requests and promotes the next request after resolution', async () => {
    const botEvents = buildBotEvents();
    const first = requestAcpPermission({
      sessionId: 'session-1',
      response: buildResponse(),
      workspaceKey: 'snatch',
      timeoutMs: 60_000,
      botEvents,
      request: buildRequest(),
    });
    const second = requestAcpPermission({
      sessionId: 'session-1',
      response: buildResponse(),
      workspaceKey: 'snatch',
      timeoutMs: 60_000,
      botEvents,
      request: {
        ...buildRequest(['allow_once', 'reject_always']),
        toolCall: {
          toolCallId: 'tool-2',
          title: 'Write config',
          kind: 'edit' as const,
        },
      },
    });

    await vi.waitFor(() => expect(botEvents.publish).toHaveBeenCalledTimes(1));
    const firstInteractionId = getPublishedInteractionId(botEvents);

    await resolveAcpPermissionInteraction({
      event: buildResolveEvent(firstInteractionId, 'reject'),
      notifier: buildNotifier(),
      botEvents,
    });

    await vi.waitFor(() => expect(botEvents.publish).toHaveBeenCalledTimes(3));
    const published = botEvents.publish.mock.calls.map((call) => call[0] as BotEvent);
    expect(published[1]).toMatchObject({
      type: 'agent.permission.updated',
      payload: { interactionId: firstInteractionId, status: 'rejected' },
    });
    expect(published[2]).toMatchObject({
      type: 'agent.permission.requested',
      payload: { action: 'Write config' },
    });

    await expect(first).resolves.toEqual({
      outcome: {
        outcome: 'selected',
        optionId: 'reject_once',
      },
    });

    const secondInteractionId = (
      published[2]?.payload as BotEvent['payload'] & {
        interactionId: string;
      }
    ).interactionId;
    await resolveAcpPermissionInteraction({
      event: buildResolveEvent(secondInteractionId, 'reject'),
      notifier: buildNotifier(),
      botEvents,
    });
    await expect(second).resolves.toEqual({
      outcome: {
        outcome: 'selected',
        optionId: 'reject_always',
      },
    });
  });

  it('expires visible ACP permission requests by resolving them as cancelled', async () => {
    const botEvents = buildBotEvents();
    const pending = requestAcpPermission({
      sessionId: 'session-1',
      response: buildResponse(),
      workspaceKey: 'snatch',
      timeoutMs: 100,
      botEvents,
      request: buildRequest(),
    });

    await vi.waitFor(() => expect(botEvents.publish).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(100);

    await expect(pending).resolves.toEqual({
      outcome: {
        outcome: 'cancelled',
      },
    });
    const published = botEvents.publish.mock.calls.map((call) => call[0] as BotEvent);
    expect(published[1]).toMatchObject({
      type: 'agent.permission.updated',
      payload: { status: 'expired' },
    });
  });

  it('fails closed when ACP permission options cannot be represented by the current UI', async () => {
    const botEvents = buildBotEvents();

    await expect(
      requestAcpPermission({
        sessionId: 'session-1',
        response: buildResponse(),
        workspaceKey: 'snatch',
        timeoutMs: 60_000,
        botEvents,
        request: buildRequest(['allow_always', 'reject_always']),
      }),
    ).resolves.toEqual({
      outcome: {
        outcome: 'cancelled',
      },
    });
    expect(botEvents.publish).not.toHaveBeenCalled();
  });

  it('clears pending ACP permissions as failed when the session ends', async () => {
    const botEvents = buildBotEvents();
    const pending = requestAcpPermission({
      sessionId: 'session-1',
      response: buildResponse(),
      workspaceKey: 'snatch',
      timeoutMs: 60_000,
      botEvents,
      request: buildRequest(),
    });

    await vi.waitFor(() => expect(botEvents.publish).toHaveBeenCalledTimes(1));
    await clearAcpPermissionInteractions({
      sessionId: 'session-1',
      botEvents,
      message: 'ACP runtime closed.',
    });

    await expect(pending).resolves.toEqual({
      outcome: {
        outcome: 'cancelled',
      },
    });
    const published = botEvents.publish.mock.calls.map((call) => call[0] as BotEvent);
    expect(published[1]).toMatchObject({
      type: 'agent.permission.updated',
      payload: {
        status: 'failed',
        message: 'ACP runtime closed.',
      },
    });
  });
});
