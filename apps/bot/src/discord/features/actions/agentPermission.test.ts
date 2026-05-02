import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerEvent } from '@sniptail/core/types/worker-event.js';
import { handleAgentPermissionButton } from './agentPermission.js';

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
      content: '**Permission requested**\n\nTool: `bash`',
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

describe('handleAgentPermissionButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.loadAgentSession.mockResolvedValue(buildSession());
    hoisted.authorizeDiscordOperationAndRespond.mockResolvedValue(true);
    hoisted.enqueueWorkerEvent.mockResolvedValue(undefined);
  });

  it('authorizes and enqueues permission resolution events', async () => {
    const interaction = buildInteraction();

    await handleAgentPermissionButton(
      interaction as never,
      { sessionId: 'session-1', interactionId: 'interaction-1', decision: 'always' },
      config as never,
      queue as never,
      permissions as never,
    );

    const authInput = hoisted.authorizeDiscordOperationAndRespond.mock.calls[0]?.[0] as
      | { action: string; operation: { event: WorkerEvent } }
      | undefined;
    expect(authInput?.action).toBe('agent.interaction.resolve');
    expect(authInput?.operation.event.type).toBe('agent.interaction.resolve');
    expect(authInput?.operation.event.payload).toMatchObject({
      sessionId: 'session-1',
      interactionId: 'interaction-1',
      resolution: {
        kind: 'permission',
        decision: 'always',
      },
    });
    expect(authInput?.operation.event.payload.resolution).not.toHaveProperty('message');
    expect(hoisted.enqueueWorkerEvent).toHaveBeenCalledWith(
      queue,
      expect.objectContaining({ type: 'agent.interaction.resolve' }),
    );
    expect(interaction.update).toHaveBeenCalledWith({
      content: '**Permission requested**\n\nTool: `bash`\n\nAlways allow selected by <@user-2>.',
      components: [],
    });
  });

  it('rejects controls used outside the bound thread', async () => {
    const interaction = buildInteraction({ channelId: 'other-thread' });

    await handleAgentPermissionButton(
      interaction as never,
      { sessionId: 'session-1', interactionId: 'interaction-1', decision: 'reject' },
      config as never,
      queue as never,
      permissions as never,
    );

    expect(hoisted.enqueueWorkerEvent).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'This permission control does not belong to this agent session thread.',
      ephemeral: true,
    });
  });
});
