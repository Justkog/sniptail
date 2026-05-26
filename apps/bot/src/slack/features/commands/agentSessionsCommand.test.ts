import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPendingSlackAgentSessionBrowserRequest } from '../../agentCommandState.js';
import { registerAgentSessionsCommand } from './agentSessions.js';

type SlackCommandHandlerArgs = {
  ack: (input?: unknown) => Promise<void>;
  body: {
    user_id: string;
    channel_id: string;
    team_id: string;
    trigger_id: string;
    thread_ts?: string;
    text?: string;
  };
  client: {
    chat: {
      postEphemeral: (input: unknown) => Promise<void>;
    };
  };
};

type SlackCommandHandler = (args: SlackCommandHandlerArgs) => Promise<void>;

type SlackAgentSessionsListOperation = {
  operation: {
    targetWorkerId: string;
    event: {
      requestId: string;
      type: 'agent.sessions.list';
      payload: {
        workerId: string;
        agentProfileKey: string;
        pageSize: number;
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
  createJobId: vi.fn(() => 'request-1'),
  dedupe: vi.fn(() => false),
}));

vi.mock('../../../agentCommandMetadataCache.js', () => ({
  loadAgentCommandMetadata: hoisted.loadAgentCommandMetadata,
}));

vi.mock('@sniptail/core/queue/queue.js', () => ({
  enqueueWorkerMailboxEvent: hoisted.enqueueWorkerMailboxEvent,
}));

vi.mock('../../permissions/slackPermissionGuards.js', () => ({
  authorizeSlackOperationAndRespond: hoisted.authorizeSlackOperationAndRespond,
}));

vi.mock('../../../lib/jobs.js', () => ({
  createJobId: hoisted.createJobId,
}));

vi.mock('../../lib/dedupe.js', () => ({
  dedupe: hoisted.dedupe,
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
  const handlers = new Map<string, SlackCommandHandler>();
  registerAgentSessionsCommand({
    app: {
      command: vi.fn((id: string, handler: SlackCommandHandler) => {
        handlers.set(id, handler);
      }),
    } as never,
    slackIds: {
      commands: {
        agentSessions: '/sniptail-agent-sessions',
      },
    } as never,
    queueRuntime: {},
    permissions: {},
  } as never);

  return handlers.get('/sniptail-agent-sessions') as SlackCommandHandler;
}

function buildArgs(text = 'worker:worker-a agent_profile:build workspace:snatch cwd:apps/worker') {
  return {
    ack: vi.fn(() => Promise.resolve(undefined)),
    body: {
      user_id: 'U1',
      channel_id: 'C1',
      team_id: 'W1',
      trigger_id: 'trigger-1',
      thread_ts: 'T1',
      text,
    },
    client: {
      chat: {
        postEphemeral: vi.fn(() => Promise.resolve(undefined)),
      },
    },
  };
}

describe('registerAgentSessionsCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPendingSlackAgentSessionBrowserRequest('request-1');
    hoisted.loadAgentCommandMetadata.mockResolvedValue(createMetadata());
    hoisted.enqueueWorkerMailboxEvent.mockResolvedValue(undefined);
    hoisted.authorizeSlackOperationAndRespond.mockResolvedValue(true);
  });

  it('enqueues a worker mailbox list request and stores pending browser state', async () => {
    const handler = buildContext();
    const args = buildArgs();

    await handler(args);

    expect(args.ack).toHaveBeenCalledWith({
      response_type: 'ephemeral',
      text: 'Loading agent sessions...',
    });
    const authorizeCall = hoisted.authorizeSlackOperationAndRespond.mock.calls[0] as
      | [{ action: string; operation: SlackAgentSessionsListOperation['operation'] }]
      | undefined;
    expect(authorizeCall).toBeDefined();
    expect(authorizeCall?.[0]).toMatchObject({
      action: 'agent.start',
      operation: {
        targetWorkerId: 'worker-a',
        event: {
          requestId: 'request-1',
          type: 'agent.sessions.list',
          payload: {
            workerId: 'worker-a',
            agentProfileKey: 'build',
            pageSize: 5,
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
      requestId: 'request-1',
      type: 'agent.sessions.list',
    });
  });

  it('returns usage guidance for invalid selectors', async () => {
    const handler = buildContext();
    const args = buildArgs('worker:worker-a cwd:/tmp/abs');

    await handler(args);

    expect(args.ack).toHaveBeenCalledWith({
      response_type: 'ephemeral',
      text: '`cwd` must be a relative path.\nUsage: /sniptail-agent-sessions worker:<worker-id> [agent_profile:<profile-key>] [workspace:<workspace-key>] [cwd:<relative-path>]',
    });
    expect(hoisted.enqueueWorkerMailboxEvent).not.toHaveBeenCalled();
  });

  it('rejects workers that are no longer live', async () => {
    const handler = buildContext();
    const args = buildArgs('worker:worker-b');

    await handler(args);

    expect(args.ack).toHaveBeenCalledWith({
      response_type: 'ephemeral',
      text: 'Worker `worker-b` is not live. Refresh the worker list and try again.',
    });
    expect(hoisted.authorizeSlackOperationAndRespond).not.toHaveBeenCalled();
  });
});
