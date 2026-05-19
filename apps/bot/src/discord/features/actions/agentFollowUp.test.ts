import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerEvent } from '@sniptail/core/types/worker-event.js';
import { handleAgentFollowUpButton } from './agentFollowUp.js';

type AgentSessionMock = {
  sessionId: string;
  threadId: string;
  channelId: string;
  status: 'active' | 'completed' | 'failed';
};

type BuildAgentSessionMessageWorkerEventInput = {
  session: AgentSessionMock;
  actor: {
    userId: string;
    guildId?: string;
  };
  message: string;
  messageId?: string;
  mode?: 'run' | 'queue' | 'steer';
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

vi.mock('../../../lib/jobs.js', () => ({
  truncateRequestSummary: (value: string) => value,
}));

vi.mock('../../../agentCommandShared.js', () => {
  return {
    buildAgentSessionMessageWorkerEvent: ({
      session,
      actor,
      message,
      messageId,
      mode,
    }: BuildAgentSessionMessageWorkerEventInput) => ({
      type: 'agent.session.message',
      payload: {
        sessionId: session.sessionId,
        response: {
          channelId: session.threadId,
          threadId: session.threadId,
          userId: actor.userId,
        },
        message,
        ...(messageId ? { messageId } : {}),
        ...(mode ? { mode } : {}),
      },
    }),
    resolveAgentFollowUpMode: (status: string, requested: 'queue' | 'steer') =>
      status === 'active' ? requested : 'run',
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
const queueRuntime = {};
const permissions = {};

describe('handleAgentFollowUpButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.loadAgentSession.mockResolvedValue(buildSession());
    hoisted.authorizeDiscordOperationAndRespond.mockResolvedValue(true);
    hoisted.enqueueWorkerMailboxEvent.mockResolvedValue(undefined);
    hoisted.resolveAgentSessionOwnerMailboxRoute.mockResolvedValue({
      ok: true,
      targetWorkerId: 'worker-a',
    });
  });

  it('enqueues queued follow-ups from the original thread message', async () => {
    const interaction = buildInteraction();

    await handleAgentFollowUpButton(
      interaction as never,
      { action: 'queue', sessionId: 'session-1', messageId: 'M1' },
      config as never,
      queueRuntime as never,
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
    expect(authInput?.operation.targetWorkerId).toBe('worker-a');
    expect(hoisted.enqueueWorkerMailboxEvent).toHaveBeenCalledWith(
      queueRuntime,
      'worker-a',
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
      queueRuntime as never,
      permissions as never,
    );

    const authInput = hoisted.authorizeDiscordOperationAndRespond.mock.calls[0]?.[0] as
      | { operation: { event: WorkerEvent } }
      | undefined;
    expect(authInput?.operation.event.payload).toMatchObject({
      mode: 'run',
      message: 'follow up text',
    });
    expect(authInput?.operation.targetWorkerId).toBe('worker-a');
  });
});
