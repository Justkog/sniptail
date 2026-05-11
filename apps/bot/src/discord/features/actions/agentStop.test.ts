import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerEvent } from '@sniptail/core/types/worker-event.js';
import { handleAgentStopButton } from './agentStop.js';

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
    channelId: 'channel-1',
    threadId: 'thread-1',
    userId: 'user-1',
    workspaceKey: 'snatch',
    agentProfileKey: 'build',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildInteraction(overrides: Record<string, unknown> = {}) {
  return {
    channelId: 'thread-1',
    guildId: 'guild-1',
    user: { id: 'user-2' },
    member: {},
    client: {},
    message: {
      id: 'message-1',
      content: 'Agent session requested by <@user-1>.\n\n```\ninspect this\n```',
    },
    channel: {
      isThread: () => true,
    },
    reply: vi.fn(),
    update: vi.fn(),
    ...overrides,
  };
}

const config = { botName: 'Sniptail' };
const queue = {};
const permissions = {};

describe('handleAgentStopButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.loadAgentSession.mockResolvedValue(buildSession());
    hoisted.authorizeDiscordOperationAndRespond.mockResolvedValue(true);
    hoisted.enqueueWorkerEvent.mockResolvedValue(undefined);
  });

  it('authorizes and enqueues stop events for active agent sessions', async () => {
    const interaction = buildInteraction();

    await handleAgentStopButton(
      interaction as never,
      'session-1',
      config as never,
      queue as never,
      permissions as never,
    );

    const authInput = hoisted.authorizeDiscordOperationAndRespond.mock.calls[0]?.[0] as
      | { action: string; operation: { event: WorkerEvent } }
      | undefined;
    expect(authInput?.action).toBe('agent.stop');
    expect(authInput?.operation.event.type).toBe('agent.prompt.stop');
    expect(authInput?.operation.event.payload).toMatchObject({
      sessionId: 'session-1',
      messageId: 'message-1',
      response: {
        channelId: 'thread-1',
        threadId: 'thread-1',
        userId: 'user-2',
      },
    });
    expect(hoisted.enqueueWorkerEvent).toHaveBeenCalledWith(
      queue,
      expect.objectContaining({ type: 'agent.prompt.stop' }),
    );
    expect(interaction.update).toHaveBeenCalledWith({
      content:
        'Agent session requested by <@user-1>.\n\n```\ninspect this\n```\n\nStop request sent by <@user-2>.',
      components: [],
    });
  });

  it('accepts stop controls from the parent channel thread starter message', async () => {
    const interaction = buildInteraction({
      channelId: 'channel-1',
      channel: {
        isThread: () => false,
      },
      message: {
        id: 'message-1',
        content: 'Agent session requested by <@user-1>.\n\n```\ninspect this\n```',
        thread: { id: 'thread-1' },
      },
    });

    await handleAgentStopButton(
      interaction as never,
      'session-1',
      config as never,
      queue as never,
      permissions as never,
    );

    expect(hoisted.enqueueWorkerEvent).toHaveBeenCalledWith(
      queue,
      expect.objectContaining({ type: 'agent.prompt.stop' }),
    );
    expect(interaction.update).toHaveBeenCalledWith({
      content:
        'Agent session requested by <@user-1>.\n\n```\ninspect this\n```\n\nStop request sent by <@user-2>.',
      components: [],
    });
  });

  it('rejects non-active sessions', async () => {
    const interaction = buildInteraction();
    hoisted.loadAgentSession.mockResolvedValueOnce(buildSession({ status: 'completed' }));

    await handleAgentStopButton(
      interaction as never,
      'session-1',
      config as never,
      queue as never,
      permissions as never,
    );

    expect(hoisted.enqueueWorkerEvent).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'This agent session is completed.',
      ephemeral: true,
    });
  });

  it('rejects stop controls used outside the bound thread', async () => {
    const interaction = buildInteraction({ channelId: 'other-thread' });

    await handleAgentStopButton(
      interaction as never,
      'session-1',
      config as never,
      queue as never,
      permissions as never,
    );

    expect(hoisted.enqueueWorkerEvent).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'This stop control does not belong to this agent session thread.',
      ephemeral: true,
    });
  });
});
