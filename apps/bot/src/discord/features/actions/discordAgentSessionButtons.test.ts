import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDiscordAgentSessionsActionState,
  setDiscordAgentSessionsActionState,
} from '../../state.js';
import { handleDiscordAgentSessionsButton } from './discordAgentSessionButtons.js';

type QueuedAgentSessionsListEvent = {
  requestId: string;
  type: 'agent.sessions.list';
  payload: {
    cursor?: string;
    filters?: {
      workspaceKey?: string;
      cwd?: string;
    };
  };
};

const hoisted = vi.hoisted(() => ({
  loadAgentCommandMetadata: vi.fn(),
  enqueueWorkerMailboxEvent: vi.fn(),
  authorizeDiscordOperationAndRespond: vi.fn(),
  authorizeDiscordPrecheckAndRespond: vi.fn(),
  createJobId: vi.fn(() => 'request-2'),
  createAgentSession: vi.fn(),
  postDiscordMessage: vi.fn(),
}));

vi.mock('../../../agentCommandMetadataCache.js', () => ({
  loadAgentCommandMetadata: hoisted.loadAgentCommandMetadata,
}));

vi.mock('@sniptail/core/queue/queue.js', () => ({
  enqueueWorkerMailboxEvent: hoisted.enqueueWorkerMailboxEvent,
}));

vi.mock('../../../lib/jobs.js', () => ({
  createJobId: hoisted.createJobId,
}));

vi.mock('@sniptail/core/agent-sessions/registry.js', () => ({
  createAgentSession: hoisted.createAgentSession,
}));

vi.mock('../../helpers.js', () => ({
  isSendableTextChannel: vi.fn(() => true),
  postDiscordMessage: hoisted.postDiscordMessage,
}));

vi.mock('../../permissions/discordPermissionGuards.js', () => ({
  authorizeDiscordOperationAndRespond: hoisted.authorizeDiscordOperationAndRespond,
  authorizeDiscordPrecheckAndRespond: hoisted.authorizeDiscordPrecheckAndRespond,
}));

vi.mock('@sniptail/core/logger.js', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

function createMetadata() {
  return {
    enabled: true,
    aggregated: {
      liveWorkers: [
        {
          workerId: 'worker-a',
          workerLabel: 'Worker A',
          workspaces: [{ key: 'snatch' }],
          profiles: [{ key: 'build', provider: 'acp' }],
        },
      ],
    },
  } as never;
}

function buildInteraction(overrides: Record<string, unknown> = {}) {
  return {
    applicationId: 'app-1',
    token: 'token-1',
    channelId: 'channel-1',
    guildId: 'guild-1',
    user: { id: 'user-1' },
    member: {},
    client: {},
    channel: {
      isTextBased: () => true,
      isThread: () => false,
    },
    reply: vi.fn(),
    deferReply: vi.fn(),
    editReply: vi.fn(),
    update: vi.fn(),
    ...overrides,
  };
}

describe('handleDiscordAgentSessionsButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.loadAgentCommandMetadata.mockResolvedValue(createMetadata());
    hoisted.enqueueWorkerMailboxEvent.mockResolvedValue(undefined);
    hoisted.authorizeDiscordOperationAndRespond.mockResolvedValue(true);
    hoisted.authorizeDiscordPrecheckAndRespond.mockResolvedValue(true);
    hoisted.createAgentSession.mockResolvedValue(undefined);
    hoisted.postDiscordMessage.mockResolvedValue({
      id: 'message-1',
      startThread: vi.fn().mockResolvedValue({ id: 'thread-1' }),
    });
  });

  it('paginates forward with the worker cursor', async () => {
    const token = setDiscordAgentSessionsActionState({
      kind: 'next',
      payload: {
        channelId: 'channel-1',
        userId: 'user-1',
        guildId: 'guild-1',
        workerId: 'worker-a',
        agentProfileKey: 'build',
        filters: {
          workspaceKey: 'snatch',
          cwd: 'apps/worker',
        },
        currentCursor: 'cursor-1',
        cursorHistory: [],
        nextCursor: 'cursor-2',
      },
    });
    const interaction = buildInteraction();

    await handleDiscordAgentSessionsButton(
      interaction as never,
      { action: 'next', token },
      { botName: 'Sniptail' } as never,
      {} as never,
      {} as never,
    );

    expect(interaction.update).toHaveBeenCalledWith({
      content: 'Loading agent sessions...',
      components: [],
    });
    expect(interaction.deferReply).not.toHaveBeenCalled();
    const enqueueCalls = hoisted.enqueueWorkerMailboxEvent.mock.calls as Array<
      [unknown, string, QueuedAgentSessionsListEvent]
    >;
    const [, workerId, event] = enqueueCalls[0] ?? [];

    expect(workerId).toBe('worker-a');
    expect(event).toMatchObject({
      requestId: 'request-2',
      type: 'agent.sessions.list',
      payload: {
        cursor: 'cursor-2',
        filters: {
          workspaceKey: 'snatch',
          cwd: 'apps/worker',
        },
      },
    });
  });

  it('rejects buttons from a different user', async () => {
    const token = setDiscordAgentSessionsActionState({
      kind: 'next',
      payload: {
        channelId: 'channel-1',
        userId: 'user-1',
        guildId: 'guild-1',
        workerId: 'worker-a',
        cursorHistory: [],
        nextCursor: 'cursor-2',
      },
    });
    const interaction = buildInteraction({ user: { id: 'user-2' } });

    await handleDiscordAgentSessionsButton(
      interaction as never,
      { action: 'next', token },
      { botName: 'Sniptail' } as never,
      {} as never,
      {} as never,
    );

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'This session browser action belongs to a different user.',
      ephemeral: true,
    });
    expect(hoisted.enqueueWorkerMailboxEvent).not.toHaveBeenCalled();
    expect(getDiscordAgentSessionsActionState(token)).toBeDefined();
  });

  it('attaches a provider session without starting a prompt', async () => {
    const token = setDiscordAgentSessionsActionState({
      kind: 'attach',
      payload: {
        channelId: 'channel-1',
        userId: 'user-1',
        guildId: 'guild-1',
        workerId: 'worker-a',
        provider: 'acp',
        providerSessionId: 'provider-session-1',
        sessionAgentProfileKey: 'build',
        workspaceKey: 'snatch',
        cwd: 'apps/worker',
        title: 'Investigate flaky tests',
      },
    });
    const interaction = buildInteraction();

    await handleDiscordAgentSessionsButton(
      interaction as never,
      { action: 'attach', token },
      { botName: 'Sniptail' } as never,
      {} as never,
      {} as never,
    );

    expect(hoisted.createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'discord',
        channelId: 'channel-1',
        threadId: 'thread-1',
        userId: 'user-1',
        guildId: 'guild-1',
        workspaceKey: 'snatch',
        agentProfileKey: 'build',
        codingAgentSessionId: 'provider-session-1',
        cwd: 'apps/worker',
        ownerWorkerId: 'worker-a',
        ownerWorkerLabel: 'Worker A',
        status: 'completed',
      }),
    );
    expect(hoisted.enqueueWorkerMailboxEvent).not.toHaveBeenCalled();
  });
});
