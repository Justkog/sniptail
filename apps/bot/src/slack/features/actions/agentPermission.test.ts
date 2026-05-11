import { beforeEach, describe, expect, it, vi } from 'vitest';
import { registerAgentPermissionActions } from './agentPermission.js';

type SlackActionHandlerArgs = {
  ack: () => Promise<void>;
  client: {
    chat: {
      update: (input: unknown) => Promise<void>;
      postEphemeral: (input: unknown) => Promise<void>;
    };
  };
  action: { value: string };
  body: {
    channel: { id: string };
    user: { id: string };
    team: { id: string };
    message: { ts: string; thread_ts: string; text: string };
  };
};

const hoisted = vi.hoisted(() => ({
  loadAgentSession: vi.fn(),
  enqueueWorkerEvent: vi.fn(),
  authorizeSlackOperationAndRespond: vi.fn(),
  getSlackAgentPermissionMessageState: vi.fn(),
}));

vi.mock('@sniptail/core/agent-sessions/registry.js', () => ({
  loadAgentSession: hoisted.loadAgentSession,
}));

vi.mock('@sniptail/core/queue/queue.js', () => ({
  enqueueWorkerEvent: hoisted.enqueueWorkerEvent,
}));

vi.mock('../../permissions/slackPermissionGuards.js', () => ({
  authorizeSlackOperationAndRespond: hoisted.authorizeSlackOperationAndRespond,
}));

vi.mock('../../slackBotChannelAdapter.js', () => ({
  getSlackAgentPermissionMessageState: hoisted.getSlackAgentPermissionMessageState,
}));

function buildSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'session-1',
    provider: 'slack',
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

describe('registerAgentPermissionActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.loadAgentSession.mockResolvedValue(buildSession());
    hoisted.enqueueWorkerEvent.mockResolvedValue(undefined);
    hoisted.authorizeSlackOperationAndRespond.mockResolvedValue(true);
    hoisted.getSlackAgentPermissionMessageState.mockReturnValue(undefined);
  });

  it('uses the stored canonical permission request text for optimistic updates', async () => {
    const actionHandlers = new Map<string, (args: SlackActionHandlerArgs) => Promise<void>>();
    const ack = vi.fn().mockResolvedValue(undefined);
    const chatUpdate = vi.fn().mockResolvedValue(undefined);
    const chatPostEphemeral = vi.fn().mockResolvedValue(undefined);

    registerAgentPermissionActions({
      app: {
        action(actionId: string, handler: (args: SlackActionHandlerArgs) => Promise<void>) {
          actionHandlers.set(actionId, handler);
        },
      } as never,
      slackIds: {
        actions: {
          agentPermissionOnce: 'permission-once',
          agentPermissionAlways: 'permission-always',
          agentPermissionReject: 'permission-reject',
        },
      } as never,
      config: {} as never,
      queue: {} as never,
      bootstrapQueue: {} as never,
      workerEventQueue: {} as never,
      permissions: {} as never,
    });

    hoisted.getSlackAgentPermissionMessageState.mockReturnValue({
      ts: 'message-ts-1',
      requestText: '*Permission requested*\n\nTool: `bash`\n\nAction: `run command`',
    });

    const handler = actionHandlers.get('permission-always');
    expect(handler).toBeDefined();

    await handler?.({
      ack,
      client: {
        chat: {
          update: chatUpdate,
          postEphemeral: chatPostEphemeral,
        },
      },
      action: {
        value: JSON.stringify({
          sessionId: 'session-1',
          interactionId: 'interaction-1',
          decision: 'always',
        }),
      },
      body: {
        channel: { id: 'channel-1' },
        user: { id: 'user-2' },
        team: { id: 'workspace-1' },
        message: {
          ts: 'message-ts-1',
          thread_ts: 'thread-1',
          text: '*Permission requested* Tool: `bash`',
        },
      },
    });

    expect(chatUpdate).toHaveBeenCalledWith({
      channel: 'channel-1',
      ts: 'message-ts-1',
      text: '*Permission requested*\n\nTool: `bash`\n\nAction: `run command`\n\nAlways allow selected by <@user-2>.',
      blocks: [],
    });
  });
});
