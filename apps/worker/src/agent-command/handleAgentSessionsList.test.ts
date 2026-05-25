import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAgentSessionsList } from './handleAgentSessionsList.js';
import { listAgentSessionsForWorker } from './agentSessionListService.js';
import { logger } from '@sniptail/core/logger.js';

vi.mock('./agentSessionListService.js', () => ({
  listAgentSessionsForWorker: vi.fn(),
}));

vi.mock('@sniptail/core/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createConfig() {
  return {
    workerId: 'worker-a',
    repoCacheRoot: '/tmp/repos',
    agent: {
      profiles: {},
      workspaces: {},
    },
  } as never;
}

function createEvent(
  overrides: Partial<{
    requestId: string;
    agentProfileKey: string;
    userId: string | undefined;
    workspaceId: string;
    guildId: string;
  }> = {},
) {
  return {
    schemaVersion: 1,
    ...(overrides.requestId ? { requestId: overrides.requestId } : {}),
    type: 'agent.sessions.list',
    payload: {
      response: {
        provider: 'discord',
        channelId: 'channel-1',
        ...('userId' in overrides
          ? overrides.userId
            ? { userId: overrides.userId }
            : {}
          : { userId: 'user-1' }),
        ...(overrides.workspaceId ? { workspaceId: overrides.workspaceId } : {}),
        ...(overrides.guildId ? { guildId: overrides.guildId } : {}),
      },
      workerId: 'worker-a',
      pageSize: 4,
      ...(overrides.agentProfileKey ? { agentProfileKey: overrides.agentProfileKey } : {}),
    },
  } as const;
}

describe('handleAgentSessionsList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishes listed sessions with preserved routing and pagination metadata', async () => {
    vi.mocked(listAgentSessionsForWorker).mockResolvedValue({
      sessions: [
        {
          id: 'acp-1',
          provider: 'acp',
          agentProfileKey: 'acp-build',
          title: 'ACP session',
        },
        {
          id: 'copilot-1',
          provider: 'copilot',
          agentProfileKey: 'copilot-build',
          title: 'Copilot session',
        },
      ],
      previousCursor: 'prev-1',
      nextCursor: 'next-1',
    });
    const botEvents = {
      publish: vi.fn(() => Promise.resolve(undefined)),
    };
    const config = createConfig();
    const event = createEvent({
      requestId: 'request-1',
      workspaceId: 'workspace-1',
      guildId: 'guild-1',
    });

    await handleAgentSessionsList({
      event,
      config,
      botEvents,
    });

    expect(listAgentSessionsForWorker).toHaveBeenCalledWith({
      config,
      payload: event.payload,
    });
    const publishCall = botEvents.publish.mock.calls[0];
    expect(publishCall).toBeDefined();
    expect(publishCall?.[0]).toMatchObject({
      schemaVersion: 1,
      requestId: 'request-1',
      provider: 'discord',
      type: 'agent.sessions.listed',
      payload: {
        channelId: 'channel-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        guildId: 'guild-1',
        workerId: 'worker-a',
        sessions: [
          {
            id: 'acp-1',
            provider: 'acp',
            agentProfileKey: 'acp-build',
            title: 'ACP session',
          },
          {
            id: 'copilot-1',
            provider: 'copilot',
            agentProfileKey: 'copilot-build',
            title: 'Copilot session',
          },
        ],
        previousCursor: 'prev-1',
        nextCursor: 'next-1',
      },
    });
  });

  it('publishes service-owned user-facing errors unchanged', async () => {
    vi.mocked(listAgentSessionsForWorker).mockResolvedValue({
      sessions: [],
      errorMessage:
        'Session listing is not supported for Codex profiles because the Codex SDK does not expose previous sessions.',
    });
    const botEvents = {
      publish: vi.fn(() => Promise.resolve(undefined)),
    };
    const event = createEvent({
      agentProfileKey: 'codex-review',
    });

    await handleAgentSessionsList({
      event,
      config: createConfig(),
      botEvents,
    });

    const publishCall = botEvents.publish.mock.calls[0];
    expect(publishCall).toBeDefined();
    expect(publishCall?.[0]).toMatchObject({
      type: 'agent.sessions.listed',
      payload: {
        agentProfileKey: 'codex-review',
        workerId: 'worker-a',
        sessions: [],
        errorMessage:
          'Session listing is not supported for Codex profiles because the Codex SDK does not expose previous sessions.',
      },
    });
  });

  it('converts unexpected service failures into a listed error response', async () => {
    vi.mocked(listAgentSessionsForWorker).mockRejectedValue(new Error('adapter crashed'));
    const botEvents = {
      publish: vi.fn(() => Promise.resolve(undefined)),
    };

    await handleAgentSessionsList({
      event: createEvent(),
      config: createConfig(),
      botEvents,
    });

    const errorCall = vi.mocked(logger.error).mock.calls[0];
    expect(errorCall).toBeDefined();
    expect(errorCall?.[1]).toBe('Failed to list agent sessions');
    const errorDetails = errorCall?.[0] as { err: Error; event: unknown } | undefined;
    expect(errorDetails?.err).toBeInstanceOf(Error);
    expect(errorDetails?.event).toBeDefined();

    const publishCall = botEvents.publish.mock.calls[0];
    expect(publishCall).toBeDefined();
    expect(publishCall?.[0]).toMatchObject({
      type: 'agent.sessions.listed',
      payload: {
        sessions: [],
        errorMessage: 'Failed to list sessions: adapter crashed',
      },
    });
  });

  it('skips publishing when the reply target has no user id', async () => {
    const botEvents = {
      publish: vi.fn(() => Promise.resolve(undefined)),
    };

    await handleAgentSessionsList({
      event: createEvent({ userId: undefined }),
      config: createConfig(),
      botEvents,
    });

    expect(listAgentSessionsForWorker).not.toHaveBeenCalled();
    expect(botEvents.publish).not.toHaveBeenCalled();
    const warnCall = vi.mocked(logger.warn).mock.calls[0];
    expect(warnCall).toBeDefined();
    expect(warnCall?.[1]).toBe(
      'Cannot publish session list response for worker "worker-a" without a reply user id.',
    );
    const warnDetails = warnCall?.[0] as { event: unknown } | undefined;
    expect(warnDetails?.event).toBeDefined();
  });
});
