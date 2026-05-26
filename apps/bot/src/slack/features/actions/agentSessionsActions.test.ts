import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSlackAgentActionValue } from '../../agentCommandState.js';
import { registerAgentSessionsActions } from './agentSessionsActions.js';

type SlackActionHandlerArgs = {
  ack: () => Promise<void>;
  client: {
    chat: {
      postEphemeral: (input: unknown) => Promise<void>;
    };
  };
  action: { value: string };
  body: {
    channel: { id: string };
    user: { id: string };
    team: { id: string };
  };
};

type SlackActionHandler = (args: SlackActionHandlerArgs) => Promise<void>;

type SlackAgentSessionsListOperation = {
  operation: {
    targetWorkerId: string;
    event: {
      requestId: string;
      type: 'agent.sessions.list';
      payload: {
        cursor?: string;
        filters?: {
          workspaceKey: string;
          cwd: string;
        };
      };
    };
  };
};

type SlackMailboxEvent = {
  requestId: string;
  type: 'agent.sessions.list';
};

const hoisted = vi.hoisted(() => ({
  loadAgentCommandMetadata: vi.fn(),
  enqueueWorkerMailboxEvent: vi.fn(),
  authorizeSlackOperationAndRespond: vi.fn(),
  authorizeSlackPrecheckAndRespond: vi.fn(),
  createJobId: vi.fn(() => 'request-2'),
  createAgentSession: vi.fn(),
  postMessage: vi.fn(() => Promise.resolve({ ts: 'thread-ts-1' })),
}));

vi.mock('../../../agentCommandMetadataCache.js', () => ({
  loadAgentCommandMetadata: hoisted.loadAgentCommandMetadata,
}));

vi.mock('@sniptail/core/queue/queue.js', () => ({
  enqueueWorkerMailboxEvent: hoisted.enqueueWorkerMailboxEvent,
}));

vi.mock('../../permissions/slackPermissionGuards.js', () => ({
  authorizeSlackOperationAndRespond: hoisted.authorizeSlackOperationAndRespond,
  authorizeSlackPrecheckAndRespond: hoisted.authorizeSlackPrecheckAndRespond,
}));

vi.mock('../../../lib/jobs.js', () => ({
  createJobId: hoisted.createJobId,
}));

vi.mock('@sniptail/core/agent-sessions/registry.js', () => ({
  createAgentSession: hoisted.createAgentSession,
}));

vi.mock('../../helpers.js', () => ({
  postMessage: hoisted.postMessage,
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
          profiles: [
            {
              key: 'build',
              provider: 'acp',
            },
          ],
        },
      ],
    },
  } as never;
}

function buildContext() {
  const handlers = new Map<string, SlackActionHandler>();
  registerAgentSessionsActions({
    app: {
      action: vi.fn((id: string, handler: SlackActionHandler) => {
        handlers.set(id, handler);
      }),
    } as never,
    slackIds: {
      actions: {
        agentSessionsPrevious: 'sessions-prev',
        agentSessionsNext: 'sessions-next',
        agentSessionsAttach: 'sessions-attach',
      },
    } as never,
    config: {
      agentCommand: {
        defaultWorkspace: 'snatch',
      },
    },
    queueRuntime: {},
    permissions: {},
  } as never);

  return handlers;
}

function buildArgs(value: string, userId = 'U1'): SlackActionHandlerArgs {
  return {
    ack: vi.fn(() => Promise.resolve(undefined)),
    client: {
      chat: {
        postEphemeral: vi.fn(() => Promise.resolve(undefined)),
      },
    },
    action: { value },
    body: {
      channel: { id: 'C1' },
      user: { id: userId },
      team: { id: 'W1' },
    },
  };
}

describe('registerAgentSessionsActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.loadAgentCommandMetadata.mockResolvedValue(createMetadata());
    hoisted.enqueueWorkerMailboxEvent.mockResolvedValue(undefined);
    hoisted.authorizeSlackOperationAndRespond.mockResolvedValue(true);
    hoisted.authorizeSlackPrecheckAndRespond.mockResolvedValue(true);
    hoisted.createAgentSession.mockResolvedValue(undefined);
    hoisted.postMessage.mockResolvedValue({ ts: 'thread-ts-1' });
  });

  it('paginates forward with the worker cursor and browser history', async () => {
    const handlers = buildContext();
    const nextHandler = handlers.get('sessions-next');
    const args = buildArgs(
      buildSlackAgentActionValue({
        channelId: 'C1',
        userId: 'U1',
        workspaceId: 'W1',
        sourceThreadId: 'T1',
        workerId: 'worker-a',
        agentProfileKey: 'build',
        filters: {
          workspaceKey: 'snatch',
          cwd: 'apps/worker',
        },
        currentCursor: 'cursor-1',
        cursorHistory: [],
        nextCursor: 'cursor-2',
      }),
    );

    await nextHandler?.(args);

    const authorizeCall = hoisted.authorizeSlackOperationAndRespond.mock.calls[0] as
      | [SlackAgentSessionsListOperation]
      | undefined;
    expect(authorizeCall).toBeDefined();
    expect(authorizeCall?.[0]).toMatchObject({
      operation: {
        targetWorkerId: 'worker-a',
        event: {
          requestId: 'request-2',
          type: 'agent.sessions.list',
          payload: {
            cursor: 'cursor-2',
            filters: {
              workspaceKey: 'snatch',
              cwd: 'apps/worker',
            },
          },
        },
      },
    });

    const enqueueCall = hoisted.enqueueWorkerMailboxEvent.mock.calls[0] as
      | [unknown, string, SlackMailboxEvent]
      | undefined;
    expect(enqueueCall).toBeDefined();
    expect(enqueueCall?.[1]).toBe('worker-a');
    expect(enqueueCall?.[2]).toMatchObject({
      requestId: 'request-2',
      type: 'agent.sessions.list',
    });
  });

  it('paginates backward with the worker previous cursor', async () => {
    const handlers = buildContext();
    const previousHandler = handlers.get('sessions-prev');
    const args = buildArgs(
      buildSlackAgentActionValue({
        channelId: 'C1',
        userId: 'U1',
        workspaceId: 'W1',
        sourceThreadId: 'T1',
        workerId: 'worker-a',
        agentProfileKey: 'build',
        filters: {
          workspaceKey: 'snatch',
          cwd: 'apps/worker',
        },
        currentCursor: 'cursor-2',
        cursorHistory: [],
        previousCursor: 'cursor-1',
      }),
    );

    await previousHandler?.(args);

    const authorizeCall = hoisted.authorizeSlackOperationAndRespond.mock.calls[0] as
      | [SlackAgentSessionsListOperation]
      | undefined;
    expect(authorizeCall).toBeDefined();
    expect(authorizeCall?.[0]).toMatchObject({
      operation: {
        targetWorkerId: 'worker-a',
        event: {
          requestId: 'request-2',
          type: 'agent.sessions.list',
          payload: {
            cursor: 'cursor-1',
            filters: {
              workspaceKey: 'snatch',
              cwd: 'apps/worker',
            },
          },
        },
      },
    });
  });

  it('creates a completed attached Slack session without starting a prompt', async () => {
    const handlers = buildContext();
    const attachHandler = handlers.get('sessions-attach');
    const args = buildArgs(
      buildSlackAgentActionValue({
        channelId: 'C1',
        userId: 'U1',
        workspaceId: 'W1',
        sourceThreadId: 'T1',
        workerId: 'worker-a',
        provider: 'acp',
        providerSessionId: 'provider-session-1',
        sessionAgentProfileKey: 'build',
        workspaceKey: 'snatch',
        cwd: 'apps/worker',
        title: 'Investigate flaky tests',
      }),
    );

    await attachHandler?.(args);

    expect(hoisted.postMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channel: 'C1',
        threadTs: 'T1',
      }),
    );
    expect(hoisted.createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'slack',
        channelId: 'C1',
        threadId: 'T1',
        userId: 'U1',
        workspaceId: 'W1',
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

  it('rejects attach actions from a different Slack user', async () => {
    const handlers = buildContext();
    const attachHandler = handlers.get('sessions-attach');
    const args = buildArgs(
      buildSlackAgentActionValue({
        channelId: 'C1',
        userId: 'U1',
        workspaceId: 'W1',
        workerId: 'worker-a',
        provider: 'acp',
        providerSessionId: 'provider-session-1',
        sessionAgentProfileKey: 'build',
      }),
      'U2',
    );

    await attachHandler?.(args);

    expect(hoisted.createAgentSession).not.toHaveBeenCalled();
    expect(args.client.chat.postEphemeral).toHaveBeenCalledWith({
      channel: 'C1',
      user: 'U2',
      text: 'This session browser action belongs to a different user.',
    });
  });
});
