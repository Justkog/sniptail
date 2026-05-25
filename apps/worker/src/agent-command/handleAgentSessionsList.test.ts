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
    const event = createEvent({
      requestId: 'request-1',
      workspaceId: 'workspace-1',
      guildId: 'guild-1',
    });

    await handleAgentSessionsList({
      event,
      config: createConfig(),
      botEvents,
    });

    expect(listAgentSessionsForWorker).toHaveBeenCalledWith({
      config: expect.anything(),
      payload: event.payload,
    });
    expect(botEvents.publish).toHaveBeenCalledWith({
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

    expect(botEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'agent.sessions.listed',
        payload: expect.objectContaining({
          agentProfileKey: 'codex-review',
          workerId: 'worker-a',
          sessions: [],
          errorMessage:
            'Session listing is not supported for Codex profiles because the Codex SDK does not expose previous sessions.',
        }),
      }),
    );
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

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        err: expect.any(Error),
        event: expect.anything(),
      }),
      'Failed to list agent sessions',
    );
    expect(botEvents.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'agent.sessions.listed',
        payload: expect.objectContaining({
          sessions: [],
          errorMessage: 'Failed to list sessions: adapter crashed',
        }),
      }),
    );
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
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.anything(),
      }),
      'Cannot publish session list response for worker "worker-a" without a reply user id.',
    );
  });
});
