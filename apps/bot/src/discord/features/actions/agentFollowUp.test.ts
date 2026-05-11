import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerEvent } from '@sniptail/core/types/worker-event.js';
import { handleAgentFollowUpButton } from './agentFollowUp.js';

const hoisted = vi.hoisted(() => ({
  loadAgentSession: vi.fn(),
  authorizeDiscordOperationAndRespond: vi.fn(),
  enqueueWorkerEvent: vi.fn(),
}));

vi.mock('@sniptail/core/agent-sessions/registry.js', () => ({
  loadAgentSession: hoisted.loadAgentSession,
}));

vi.mock('@sniptail/core/queue/queue.js', () => ({
  enqueueWorkerEvent: hoisted.enqueueWorkerEvent,
}));

vi.mock('../../permissions/discordPermissionGuards.js', () => ({
  authorizeDiscordOperationAndRespond: hoisted.authorizeDiscordOperationAndRespond,
}));

function buildSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'session-1',
    provider: 'discord',
    channelId: 'C1',
    threadId: 'T1',
    userId: 'U_REQUESTER',
    workspaceKey: 'snatch',
    agentProfileKey: 'build',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildInteraction() {
  return {
    channelId: 'T1',
    guildId: 'G1',
    user: { id: 'U1' },
    member: {},
    client: {},
    reply: vi.fn(),
    update: vi.fn(),
    message: {
      content: 'busy',
      id: 'busy-message',
    },
    channel: {
      isThread: () => true,
      isTextBased: () => true,
      messages: {
        fetch: vi.fn().mockResolvedValue({
          id: 'M1',
          content: 'follow up text',
        }),
      },
    },
  };
}

const config = { botName: 'Sniptail' };
const queue = {};
const permissions = {};

describe('handleAgentFollowUpButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.loadAgentSession.mockResolvedValue(buildSession());
    hoisted.authorizeDiscordOperationAndRespond.mockResolvedValue(true);
    hoisted.enqueueWorkerEvent.mockResolvedValue(undefined);
  });

  it('enqueues queued follow-ups from the original thread message', async () => {
    const interaction = buildInteraction();

    await handleAgentFollowUpButton(
      interaction as never,
      { action: 'queue', sessionId: 'session-1', messageId: 'M1' },
      config as never,
      queue as never,
      permissions as never,
    );

    const authInput = hoisted.authorizeDiscordOperationAndRespond.mock.calls[0]?.[0] as
      | { operation: { event: WorkerEvent } }
      | undefined;
    expect(authInput?.operation.event.payload).toMatchObject({
      sessionId: 'session-1',
      message: 'follow up text',
      messageId: 'M1',
      mode: 'queue',
    });
    expect(hoisted.enqueueWorkerEvent).toHaveBeenCalledWith(
      queue,
      expect.objectContaining({ type: 'agent.session.message' }),
    );
    const updateInput = interaction.update.mock.calls[0]?.[0] as
      | { components: unknown[]; content: string }
      | undefined;
    expect(updateInput?.components).toEqual([]);
    expect(updateInput?.content).toContain('Queue');
  });

  it('runs immediately when a busy control is clicked after the session completed', async () => {
    hoisted.loadAgentSession.mockResolvedValueOnce(buildSession({ status: 'completed' }));
    const interaction = buildInteraction();

    await handleAgentFollowUpButton(
      interaction as never,
      { action: 'steer', sessionId: 'session-1', messageId: 'M1' },
      config as never,
      queue as never,
      permissions as never,
    );

    const authInput = hoisted.authorizeDiscordOperationAndRespond.mock.calls[0]?.[0] as
      | { operation: { event: WorkerEvent } }
      | undefined;
    expect(authInput?.operation.event.payload).toMatchObject({
      mode: 'run',
      message: 'follow up text',
    });
  });
});
