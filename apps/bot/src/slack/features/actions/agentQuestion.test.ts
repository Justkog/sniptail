import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPendingSlackAgentQuestion,
  setPendingSlackAgentQuestion,
} from '../../agentCommandState.js';
import { registerAgentQuestionActions } from './agentQuestion.js';

const hoisted = vi.hoisted(() => ({
  loadAgentSession: vi.fn(),
  enqueueWorkerEvent: vi.fn(),
  authorizeSlackOperationAndRespond: vi.fn(),
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

type ActionHandler = (args: {
  ack: () => Promise<void>;
  body: {
    channel?: { id?: string };
    user?: { id?: string };
    team?: { id?: string };
    message?: { ts?: string; thread_ts?: string; text?: string };
  };
  action:
    | {
        block_id?: string;
        selected_option?: { value?: string };
      }
    | {
        value?: string;
      };
  client: {
    chat: {
      postEphemeral: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    views: {
      open: ReturnType<typeof vi.fn>;
    };
  };
}) => Promise<void>;

function buildSession() {
  return {
    sessionId: 'session-1',
    provider: 'slack',
    channelId: 'channel-1',
    threadId: 'thread-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
    workspaceKey: 'snatch',
    agentProfileKey: 'build',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function createContext() {
  const handlers = new Map<string, ActionHandler>();
  const app = {
    action: vi.fn((actionId: string, handler: ActionHandler) => {
      handlers.set(actionId, handler);
    }),
    view: vi.fn(),
    client: {},
  };
  const workerEventQueue = {};
  const permissions = {};
  const slackIds = {
    actions: {
      agentQuestionSelect: 'agent-question-select',
      agentQuestionSubmit: 'agent-question-submit',
      agentQuestionReject: 'agent-question-reject',
      agentQuestionCustom: 'agent-question-custom',
      agentQuestionCustomSubmit: 'agent-question-custom-submit',
    },
  };

  registerAgentQuestionActions({
    app,
    slackIds,
    config: { botName: 'Sniptail' },
    workerEventQueue,
    permissions,
  } as never);

  return { handlers, workerEventQueue };
}

function buildClient() {
  return {
    chat: {
      postEphemeral: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
    },
    views: {
      open: vi.fn().mockResolvedValue({}),
    },
  };
}

describe('registerAgentQuestionActions select flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPendingSlackAgentQuestion('session-1', 'interaction-1');
    hoisted.loadAgentSession.mockResolvedValue(buildSession());
    hoisted.enqueueWorkerEvent.mockResolvedValue(undefined);
    hoisted.authorizeSlackOperationAndRespond.mockResolvedValue(true);
  });

  it('posts Selection recorded as a thread-scoped ephemeral message for multi-question prompts', async () => {
    const { handlers } = createContext();
    const handler = handlers.get('agent-question-select');
    if (!handler) throw new Error('Expected select handler.');
    const client = buildClient();
    setPendingSlackAgentQuestion({
      sessionId: 'session-1',
      interactionId: 'interaction-1',
      channelId: 'channel-1',
      threadId: 'thread-1',
      workspaceKey: 'snatch',
      expiresAt: '2026-01-01T00:30:00.000Z',
      questions: [
        {
          question: 'Question A',
          options: [{ label: 'One' }, { label: 'Two' }],
          multiple: false,
          custom: false,
        },
        {
          question: 'Question B',
          options: [{ label: 'Three' }, { label: 'Four' }],
          multiple: false,
          custom: false,
        },
      ],
    });

    await handler({
      ack: vi.fn().mockResolvedValue(undefined),
      body: {
        channel: { id: 'channel-1' },
        user: { id: 'user-2' },
        message: { ts: 'message-1', thread_ts: 'thread-1', text: '*Question requested*' },
      },
      action: {
        block_id: 'agent-question:session-1:interaction-1:0',
        selected_option: { value: '0' },
      },
      client,
    });

    expect(client.chat.postEphemeral).toHaveBeenCalledWith({
      channel: 'channel-1',
      user: 'user-2',
      text: 'Selection recorded.',
      thread_ts: 'thread-1',
    });
    expect(client.chat.update).not.toHaveBeenCalled();
    expect(hoisted.enqueueWorkerEvent).not.toHaveBeenCalled();
  });

  it('resolves single-question selections immediately without posting Selection recorded', async () => {
    const { handlers, workerEventQueue } = createContext();
    const handler = handlers.get('agent-question-select');
    if (!handler) throw new Error('Expected select handler.');
    const client = buildClient();
    setPendingSlackAgentQuestion({
      sessionId: 'session-1',
      interactionId: 'interaction-1',
      channelId: 'channel-1',
      threadId: 'thread-1',
      workspaceKey: 'snatch',
      expiresAt: '2026-01-01T00:30:00.000Z',
      questions: [
        {
          question: 'Question A',
          options: [{ label: 'One' }, { label: 'Two' }],
          multiple: false,
          custom: false,
        },
      ],
    });

    await handler({
      ack: vi.fn().mockResolvedValue(undefined),
      body: {
        channel: { id: 'channel-1' },
        user: { id: 'user-2' },
        team: { id: 'workspace-1' },
        message: { ts: 'message-1', thread_ts: 'thread-1', text: '*Question requested*' },
      },
      action: {
        block_id: 'agent-question:session-1:interaction-1:0',
        selected_option: { value: '0' },
      },
      client,
    });

    expect(hoisted.authorizeSlackOperationAndRespond).toHaveBeenCalledTimes(1);
    expect(hoisted.enqueueWorkerEvent).toHaveBeenCalledTimes(1);
    const enqueuedEvent = hoisted.enqueueWorkerEvent.mock.calls[0]?.[1] as
      | {
          type?: string;
          payload?: {
            sessionId?: string;
            interactionId?: string;
          };
        }
      | undefined;
    expect(hoisted.enqueueWorkerEvent).toHaveBeenCalledWith(workerEventQueue, enqueuedEvent);
    expect(enqueuedEvent?.type).toBe('agent.interaction.resolve');
    expect(enqueuedEvent?.payload?.sessionId).toBe('session-1');
    expect(enqueuedEvent?.payload?.interactionId).toBe('interaction-1');
    expect(client.chat.update).toHaveBeenCalledWith({
      channel: 'channel-1',
      ts: 'message-1',
      text: '*Question requested*\n\nQuestion answer selected by <@user-2>.',
      blocks: [],
    });
    expect(client.chat.postEphemeral).not.toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Selection recorded.' }),
    );
  });
});
