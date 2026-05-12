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
    private_metadata: string;
    state: {
      values: ReturnType<typeof buildViewState>;
    };
  };
  client: Record<string, unknown>;
};

type SlackViewHandler = (args: SlackViewHandlerArgs) => Promise<void>;

const hoisted = vi.hoisted(() => ({
  getAgentCommandMetadata: vi.fn(),
  loadSlackModalContextFiles: vi.fn(),
  postMessage: vi.fn(),
  createAgentSession: vi.fn(),
  updateAgentSessionStatus: vi.fn(),
  enqueueWorkerEvent: vi.fn(),
  upsertSlackAgentDefaults: vi.fn(),
  authorizeSlackOperationAndRespond: vi.fn(),
  auditAgentSessionStart: vi.fn(),
}));

vi.mock('../../../agentCommandMetadataCache.js', () => ({
  getAgentCommandMetadata: hoisted.getAgentCommandMetadata,
}));

vi.mock('../../helpers.js', () => ({
  loadSlackModalContextFiles: hoisted.loadSlackModalContextFiles,
  postMessage: hoisted.postMessage,
}));

vi.mock('@sniptail/core/agent-sessions/registry.js', () => ({
  createAgentSession: hoisted.createAgentSession,
  updateAgentSessionStatus: hoisted.updateAgentSessionStatus,
}));

vi.mock('@sniptail/core/queue/queue.js', () => ({
  enqueueWorkerEvent: hoisted.enqueueWorkerEvent,
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
    workerEventQueue: {},
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
    hoisted.getAgentCommandMetadata.mockReturnValue({
      enabled: true,
      workspaces: [{ key: 'snatch' }],
      profiles: [{ key: 'build', provider: 'codex', profile: 'default' }],
    });
    hoisted.loadSlackModalContextFiles.mockResolvedValue([]);
    hoisted.postMessage.mockResolvedValue({ ts: 'T1' });
    hoisted.createAgentSession.mockResolvedValue(undefined);
    hoisted.updateAgentSessionStatus.mockResolvedValue(undefined);
    hoisted.enqueueWorkerEvent.mockResolvedValue(undefined);
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
    hoisted.getAgentCommandMetadata.mockReturnValue(undefined);

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
});
