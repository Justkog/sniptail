import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerEvent } from '@sniptail/core/types/worker-event.js';
import { handleAgentPermissionButton } from './agentPermission.js';

type AgentSessionMock = {
  sessionId: string;
  threadId: string;
  channelId: string;
  status: 'active' | 'completed' | 'failed';
};

type BuildAgentInteractionResolveWorkerEventInput = {
  session: AgentSessionMock;
  actor: {
    userId: string;
    guildId?: string;
  };
  interactionId: string;
  resolution: {
    kind: 'permission';
    decision: 'once' | 'always' | 'reject';
  };
};

type ValidateAgentSessionForThreadInput = {
  session: AgentSessionMock | undefined;
  threadId: string;
  allowedStatuses: AgentSessionMock['status'][];
  wrongThreadMessage: string;
};

const hoisted = vi.hoisted(() => ({
  loadAgentSession: vi.fn(),
  authorizeDiscordOperationAndRespond: vi.fn(),
  enqueueWorkerMailboxEvent: vi.fn(),
  resolveAgentSessionOwnerMailboxRoute: vi.fn(),
  getDiscordAgentPermissionMessageState: vi.fn(),
}));

vi.mock('@sniptail/core/agent-sessions/registry.js', () => ({
  loadAgentSession: hoisted.loadAgentSession,
}));

vi.mock('@sniptail/core/queue/queue.js', () => ({
  enqueueWorkerMailboxEvent: hoisted.enqueueWorkerMailboxEvent,
}));

vi.mock('../../permissions/discordPermissionGuards.js', () => ({
  authorizeDiscordOperationAndRespond: hoisted.authorizeDiscordOperationAndRespond,
}));

vi.mock('../../discordBotChannelAdapter.js', () => ({
  getDiscordAgentPermissionMessageState: hoisted.getDiscordAgentPermissionMessageState,
}));

vi.mock('../../../agentCommandShared.js', () => {
  return {
    buildAgentInteractionResolveWorkerEvent: ({
      session,
      actor,
      interactionId,
      resolution,
    }: BuildAgentInteractionResolveWorkerEventInput) => ({
      type: 'agent.interaction.resolve',
      payload: {
        sessionId: session.sessionId,
        response: {
          channelId: session.threadId,
          threadId: session.threadId,
          userId: actor.userId,
        },
        interactionId,
        resolution,
      },
    }),
    validateAgentSessionForThread: ({
      session,
      threadId,
      allowedStatuses,
      wrongThreadMessage,
    }: ValidateAgentSessionForThreadInput) => {
      if (!session) return 'Agent session not found.';
      if (session.threadId !== threadId) return wrongThreadMessage;
      if (!allowedStatuses.includes(session.status))
        return `This agent session is ${session.status}.`;
      return undefined;
    },
    resolveAgentSessionOwnerMailboxRoute: hoisted.resolveAgentSessionOwnerMailboxRoute,
  };
});

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
const queueRuntime = {};
const permissions = {};

describe('handleAgentPermissionButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.loadAgentSession.mockResolvedValue(buildSession());
    hoisted.authorizeDiscordOperationAndRespond.mockResolvedValue(true);
    hoisted.enqueueWorkerMailboxEvent.mockResolvedValue(undefined);
    hoisted.resolveAgentSessionOwnerMailboxRoute.mockResolvedValue({
      ok: true,
      targetWorkerId: 'worker-a',
    });
    hoisted.getDiscordAgentPermissionMessageState.mockReturnValue(undefined);
  });

  it('authorizes and enqueues permission resolution events', async () => {
    const interaction = buildInteraction();

    await handleAgentPermissionButton(
      interaction as never,
      { sessionId: 'session-1', interactionId: 'interaction-1', decision: 'always' },
      config as never,
      queueRuntime as never,
      permissions as never,
    );

    const authInput = hoisted.authorizeDiscordOperationAndRespond.mock.calls[0]?.[0] as
      | { action: string; operation: { event: WorkerEvent; targetWorkerId?: string } }
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
    expect(authInput?.operation.targetWorkerId).toBe('worker-a');
    expect(hoisted.enqueueWorkerMailboxEvent).toHaveBeenCalledWith(
      queueRuntime,
      'worker-a',
      expect.objectContaining({ type: 'agent.interaction.resolve' }),
    );
    expect(interaction.update).toHaveBeenCalledWith({
      content: '**Permission requested**\n\nTool: `bash`\n\nAlways allow selected by <@user-2>.',
      components: [],
    });
  });

  it('uses the stored canonical permission request text for optimistic updates', async () => {
    const interaction = buildInteraction({
      message: {
        id: 'message-1',
        content: '**Permission requested** Tool: `bash`',
      },
    });
    hoisted.getDiscordAgentPermissionMessageState.mockReturnValue({
      messageId: 'message-1',
      requestText: '**Permission requested**\n\nTool: `bash`\n\nAction: `run command`',
    });

    await handleAgentPermissionButton(
      interaction as never,
      { sessionId: 'session-1', interactionId: 'interaction-1', decision: 'always' },
      config as never,
      queueRuntime as never,
      permissions as never,
    );

    expect(interaction.update).toHaveBeenCalledWith({
      content:
        '**Permission requested**\n\nTool: `bash`\n\nAction: `run command`\n\nAlways allow selected by <@user-2>.',
      components: [],
    });
  });

  it('rejects controls used outside the bound thread', async () => {
    const interaction = buildInteraction({ channelId: 'other-thread' });

    await handleAgentPermissionButton(
      interaction as never,
      { sessionId: 'session-1', interactionId: 'interaction-1', decision: 'reject' },
      config as never,
      queueRuntime as never,
      permissions as never,
    );

    expect(hoisted.enqueueWorkerMailboxEvent).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'This permission control does not belong to this agent session thread.',
      ephemeral: true,
    });
  });
});
