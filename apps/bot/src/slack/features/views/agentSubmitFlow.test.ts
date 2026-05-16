import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerAgentSubmitView } from './agentSubmit.js';

type SlackViewHandlerArgs = {
  ack: () => Promise<void> | void;
  body: {
    user: {
      id: string;
    };
  };
  view: {
    private_metadata?: string;
    state: {
      values: ReturnType<typeof buildViewState>;
    };
  };
  client: Record<string, unknown>;
};

type SlackViewHandler = (args: SlackViewHandlerArgs) => Promise<void>;

const hoisted = vi.hoisted(() => ({
  loadAgentCommandMetadata: vi.fn(),
  findAgentProfileMetadata: vi.fn(),
  buildAgentWorkerSelectionError: vi.fn(),
  resolveAgentStartWorker: vi.fn(),
  loadSlackModalContextFiles: vi.fn(),
  postEphemeral: vi.fn(),
  postMessage: vi.fn(),
  createAgentSession: vi.fn(),
  updateAgentSessionStatus: vi.fn(),
  enqueueWorkerMailboxEvent: vi.fn(),
  upsertSlackAgentDefaults: vi.fn(),
  authorizeSlackOperationAndRespond: vi.fn(),
  auditAgentSessionStart: vi.fn(),
}));

vi.mock('../../../agentCommandMetadataCache.js', () => ({
  loadAgentCommandMetadata: hoisted.loadAgentCommandMetadata,
  findAgentProfileMetadata: hoisted.findAgentProfileMetadata,
}));

vi.mock('../../../agentCommandWorkerRouting.js', () => ({
  buildAgentWorkerSelectionError: hoisted.buildAgentWorkerSelectionError,
  resolveAgentStartWorker: hoisted.resolveAgentStartWorker,
}));

vi.mock('../../helpers.js', () => ({
  loadSlackModalContextFiles: hoisted.loadSlackModalContextFiles,
  postEphemeral: hoisted.postEphemeral,
  postMessage: hoisted.postMessage,
}));

vi.mock('@sniptail/core/agent-sessions/registry.js', () => ({
  createAgentSession: hoisted.createAgentSession,
  updateAgentSessionStatus: hoisted.updateAgentSessionStatus,
}));

vi.mock('@sniptail/core/queue/queue.js', () => ({
  enqueueWorkerMailboxEvent: hoisted.enqueueWorkerMailboxEvent,
}));

vi.mock('@sniptail/core/logger.js', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('../../../agentCommandShared.js', () => ({
  buildAgentSessionStartWorkerEvent: vi.fn((input: { session: { sessionId: string } }) => ({
    type: 'agent.session.start',
    payload: { sessionId: input.session.sessionId },
  })),
}));

vi.mock('@sniptail/core/agent-defaults/registry.js', () => ({
  upsertSlackAgentDefaults: hoisted.upsertSlackAgentDefaults,
}));

vi.mock('../../permissions/slackPermissionGuards.js', () => ({
  authorizeSlackOperationAndRespond: hoisted.authorizeSlackOperationAndRespond,
}));

vi.mock('../../../lib/requestAudit.js', () => ({
  auditAgentSessionStart: hoisted.auditAgentSessionStart,
}));

function buildContext() {
  const handlers = new Map<string, SlackViewHandler>();
  const app = {
    client: {},
    view: vi.fn((id: string, handler: SlackViewHandler) => {
      handlers.set(id, handler);
    }),
  };
  const context = {
    app,
    slackIds: {
      actions: {
        agentSubmit: 'agent-submit',
        agentStop: 'agent-stop',
      },
    },
    config: {
      botName: 'Sniptail',
    },
    queueRuntime: {},
    permissions: {},
  } as never;

  registerAgentSubmitView(context);

  return {
    handler: handlers.get('agent-submit') as SlackViewHandler,
    context,
  };
}

function buildViewState(prompt = 'inspect the failing tests') {
  return {
    prompt: { prompt: { value: prompt } },
    workspace: { workspace_key: { selected_option: { value: 'snatch' } } },
    profile: { agent_profile_key: { selected_option: { value: 'build' } } },
    cwd: { cwd: { value: 'apps/bot' } },
  };
}

function buildArgs(overrides: Partial<SlackViewHandlerArgs> = {}): SlackViewHandlerArgs {
  return {
    ack: vi.fn(),
    body: {
      user: { id: 'U1' },
    },
    view: {
      private_metadata: JSON.stringify({
        channelId: 'C1',
        userId: 'U1',
        threadId: 'T1',
        workspaceId: 'W1',
      }),
      state: {
        values: buildViewState(),
      },
    },
    client: {},
    ...overrides,
  };
}

describe('registerAgentSubmitView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.loadAgentCommandMetadata.mockResolvedValue({
      enabled: true,
      workspaces: [{ key: 'snatch' }],
      profiles: [{ key: 'build', status: 'available', provider: 'codex', profile: 'default' }],
    });
    hoisted.findAgentProfileMetadata.mockReturnValue({
      key: 'build',
      status: 'available',
      provider: 'codex',
      profile: 'default',
    });
    hoisted.buildAgentWorkerSelectionError.mockReturnValue(undefined);
    hoisted.resolveAgentStartWorker.mockReturnValue({
      workerId: 'worker-a',
      workerLabel: 'Worker A',
    });
    hoisted.loadSlackModalContextFiles.mockResolvedValue([]);
    hoisted.postMessage.mockResolvedValue({ ts: 'T1' });
    hoisted.postEphemeral.mockResolvedValue({});
    hoisted.createAgentSession.mockResolvedValue(undefined);
    hoisted.updateAgentSessionStatus.mockResolvedValue(undefined);
    hoisted.enqueueWorkerMailboxEvent.mockResolvedValue(undefined);
    hoisted.upsertSlackAgentDefaults.mockResolvedValue(undefined);
    hoisted.authorizeSlackOperationAndRespond.mockResolvedValue(true);
  });

  it('audits accepted starts', async () => {
    const { handler, context } = buildContext();
    await handler(buildArgs());

    expect(hoisted.auditAgentSessionStart).toHaveBeenCalledWith(
      context.config,
      expect.objectContaining({
        provider: 'slack',
        channelId: 'C1',
        threadId: 'T1',
        userId: 'U1',
        workspaceId: 'W1',
        requestText: 'inspect the failing tests',
        contextFileCount: 0,
        workspaceKey: 'snatch',
        agentProfileKey: 'build',
        cwd: 'apps/bot',
      }),
      'accepted',
    );
  });

  it('posts the start acknowledgment ephemerally', async () => {
    const { handler } = buildContext();

    await handler(buildArgs());

    expect(hoisted.postEphemeral).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channel: 'C1',
        user: 'U1',
        text: 'Agent session started on worker `worker-a`.',
        threadTs: 'T1',
      }),
    );
    expect(hoisted.postMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channel: 'C1',
        text: expect.stringContaining('Agent session requested by <@U1>.'),
        threadTs: 'T1',
      }),
    );
  });

  it('audits pending approvals', async () => {
    const { handler, context } = buildContext();
    hoisted.authorizeSlackOperationAndRespond.mockResolvedValue(false);

    await handler(buildArgs());

    expect(hoisted.auditAgentSessionStart).toHaveBeenCalledWith(
      context.config,
      expect.objectContaining({
        provider: 'slack',
        channelId: 'C1',
        threadId: 'T1',
        userId: 'U1',
      }),
      'pending',
    );
  });

  it('audits invalid metadata/state failures before session creation', async () => {
    const { handler, context } = buildContext();
    hoisted.loadAgentCommandMetadata.mockResolvedValue(undefined);

    await handler(buildArgs());

    expect(hoisted.auditAgentSessionStart).toHaveBeenCalledWith(
      context.config,
      expect.objectContaining({
        provider: 'slack',
        channelId: 'C1',
        threadId: 'T1',
        userId: 'U1',
      }),
      'invalid',
    );
    expect(hoisted.createAgentSession).not.toHaveBeenCalled();
  });

  it('treats missing channel metadata as invalid submission', async () => {
    const { handler, context } = buildContext();
    const args = buildArgs({
      view: {
        private_metadata: JSON.stringify({ userId: 'U1', threadId: 'T1', workspaceId: 'W1' }),
        state: { values: buildViewState() },
      },
    });

    await handler(args);

    expect(hoisted.auditAgentSessionStart).toHaveBeenCalledWith(
      context.config,
      expect.objectContaining({
        provider: 'slack',
        channelId: 'missing-channel-id',
        threadId: 'T1',
        userId: 'U1',
      }),
      'invalid',
    );
    expect(hoisted.postMessage).not.toHaveBeenCalled();
    expect(hoisted.createAgentSession).not.toHaveBeenCalled();
  });

  it('rejects conflicted profiles before session creation', async () => {
    const { handler } = buildContext();
    hoisted.findAgentProfileMetadata.mockReturnValue({
      key: 'build',
      status: 'conflicted',
    });

    await handler(buildArgs());

    expect(hoisted.postMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        channel: 'C1',
        text: 'Agent profile key: `build` is currently conflicted across live workers. Please ask an operator to fix worker configuration.',
        threadTs: 'T1',
      }),
    );
    expect(hoisted.createAgentSession).not.toHaveBeenCalled();
  });
});
