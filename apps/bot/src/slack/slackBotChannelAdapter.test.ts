type SlackPostEphemeralCall = [
  unknown,
  {
    channel: string;
    user: string;
    threadTs: string;
    text: string;
    blocks?: Array<{
      type?: string;
      text?: { text?: string };
      elements?: Array<{ text?: { text?: string }; value?: string }>;
    }>;
  },
];
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreBotEvent } from '@sniptail/core/types/bot-event.js';
import {
  clearPendingSlackAgentSessionBrowserRequest,
  getPendingSlackAgentSessionBrowserRequest,
  parseSlackAgentActionValue,
  setPendingSlackAgentSessionBrowserRequest,
  type SlackAgentSessionsPageActionPayload,
} from './agentCommandState.js';

const hoisted = vi.hoisted(() => ({
  postMessage: vi.fn().mockResolvedValue({ ts: 'message-ts-1' }),
  postEphemeral: vi.fn().mockResolvedValue(undefined),
  chatUpdate: vi.fn().mockResolvedValue(undefined),
  loadBotConfig: vi.fn(() => ({ botName: 'Sniptail' })),
}));

vi.mock('@sniptail/core/config/config.js', () => ({
  loadBotConfig: hoisted.loadBotConfig,
}));

vi.mock('@sniptail/core/slack/ids.js', () => ({
  buildSlackIds: vi.fn(() => ({
    actions: {
      agentSessionsPrevious: 'sessions-prev',
      agentSessionsNext: 'sessions-next',
      agentSessionsAttach: 'sessions-attach',
    },
  })),
}));

vi.mock('@sniptail/core/logger.js', () => ({
  debugFor: vi.fn(() => vi.fn()),
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('./helpers.js', () => ({
  addReaction: vi.fn(),
  postEphemeral: hoisted.postEphemeral,
  postMessage: hoisted.postMessage,
  uploadFile: vi.fn(),
}));

import { SlackBotChannelAdapter } from './slackBotChannelAdapter.js';

function buildPermissionRequestedEvent(): CoreBotEvent<'agent.permission.requested'> {
  return {
    schemaVersion: 1,
    provider: 'slack',
    type: 'agent.permission.requested',
    payload: {
      channelId: 'channel-1',
      threadId: 'thread-1',
      sessionId: 'session-1',
      interactionId: 'interaction-1',
      workspaceKey: 'snatch',
      cwd: 'apps/bot',
      toolName: 'bash',
      action: 'run command',
      details: ['pnpm run check'],
      allowAlways: true,
      expiresAt: '2026-01-01T00:30:00.000Z',
    },
  };
}

function buildPermissionUpdatedEvent(): CoreBotEvent<'agent.permission.updated'> {
  return {
    schemaVersion: 1,
    provider: 'slack',
    type: 'agent.permission.updated',
    payload: {
      channelId: 'channel-1',
      threadId: 'thread-1',
      sessionId: 'session-1',
      interactionId: 'interaction-1',
      status: 'approved_always',
      actorUserId: 'user-1',
    },
  };
}

function buildQuestionRequestedEvent(): CoreBotEvent<'agent.question.requested'> {
  return {
    schemaVersion: 1,
    provider: 'slack',
    type: 'agent.question.requested',
    payload: {
      channelId: 'channel-1',
      threadId: 'thread-1',
      sessionId: 'session-1',
      interactionId: 'interaction-1',
      workspaceKey: 'snatch',
      cwd: 'apps/bot',
      expiresAt: '2026-01-01T00:30:00.000Z',
      questions: [
        {
          question: 'Pick one number for this test:',
          options: [{ label: 'One' }, { label: 'Two' }],
          multiple: false,
          custom: true,
        },
      ],
    },
  };
}

function buildQuestionUpdatedEvent(): CoreBotEvent<'agent.question.updated'> {
  return {
    schemaVersion: 1,
    provider: 'slack',
    type: 'agent.question.updated',
    payload: {
      channelId: 'channel-1',
      threadId: 'thread-1',
      sessionId: 'session-1',
      interactionId: 'interaction-1',
      status: 'answered',
      actorUserId: 'user-1',
    },
  };
}

function buildSessionsListedEvent(
  overrides: Partial<CoreBotEvent<'agent.sessions.listed'>['payload']> = {},
): CoreBotEvent<'agent.sessions.listed'> {
  return {
    schemaVersion: 1,
    requestId: 'request-1',
    provider: 'slack',
    type: 'agent.sessions.listed',
    payload: {
      channelId: 'channel-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workerId: 'worker-a',
      filters: {
        workspaceKey: 'snatch',
        roots: ['docs', 'packages/core'],
      },
      sessions: [
        {
          id: 'provider-session-1',
          provider: 'acp',
          agentProfileKey: 'build',
          workspaceKey: 'snatch',
          cwd: 'apps/worker',
          title: 'ACP session',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      previousCursor: 'cursor-0',
      nextCursor: 'cursor-2',
      ...overrides,
    },
  };
}

describe('SlackBotChannelAdapter permission updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPendingSlackAgentSessionBrowserRequest('request-1');
    hoisted.postMessage.mockResolvedValue({ ts: 'message-ts-1' });
    hoisted.postEphemeral.mockResolvedValue(undefined);
    hoisted.chatUpdate.mockResolvedValue(undefined);
  });

  it('preserves the original permission request text when updating the message status', async () => {
    const adapter = new SlackBotChannelAdapter();
    const app = {
      client: {
        chat: {
          update: hoisted.chatUpdate,
        },
      },
    };

    await adapter.handleEvent(buildPermissionRequestedEvent(), { slackApp: app as never });
    await adapter.handleEvent(buildPermissionUpdatedEvent(), { slackApp: app as never });

    expect(hoisted.chatUpdate).toHaveBeenCalledWith({
      channel: 'channel-1',
      ts: 'message-ts-1',
      text: [
        '*Permission requested*',
        'Tool: `bash`',
        'Action: `run command`',
        'Workspace: `snatch / apps/bot`',
        'Expires: 2026-01-01T00:30:00.000Z',
        'Details:',
        '• pnpm run check',
        '',
        'Permission always allowed by <@user-1>.',
      ].join('\n'),
      blocks: [],
    });
  });

  it('preserves the original question request text when updating the message status', async () => {
    const adapter = new SlackBotChannelAdapter();
    const app = {
      client: {
        chat: {
          update: hoisted.chatUpdate,
        },
      },
    };

    await adapter.handleEvent(buildQuestionRequestedEvent(), { slackApp: app as never });
    await adapter.handleEvent(buildQuestionUpdatedEvent(), { slackApp: app as never });

    expect(hoisted.chatUpdate).toHaveBeenCalledWith({
      channel: 'channel-1',
      ts: 'message-ts-1',
      text: [
        '*Question requested*',
        'Workspace: `snatch / apps/bot`',
        'Expires: 2026-01-01T00:30:00.000Z',
        '',
        'Pick one number for this test:',
        '• One',
        '• Two',
        '_Custom answer allowed._',
        '',
        'Question answered by <@user-1>.',
      ].join('\n'),
      blocks: [],
    });
  });

  it('renders listed session rows ephemerally for the matching pending browser request', async () => {
    const adapter = new SlackBotChannelAdapter();
    setPendingSlackAgentSessionBrowserRequest({
      requestId: 'request-1',
      channelId: 'channel-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      sourceThreadId: 'thread-1',
      workerId: 'worker-a',
      filters: {
        workspaceKey: 'snatch',
        roots: ['packages/core', 'docs', 'docs'],
      },
      cursorHistory: [],
    });

    await adapter.handleEvent(buildSessionsListedEvent(), {
      slackApp: {
        client: {
          chat: {
            update: hoisted.chatUpdate,
          },
        },
      } as never,
    });

    const postEphemeralCall = hoisted.postEphemeral.mock.calls[0] as
      | SlackPostEphemeralCall
      | undefined;
    expect(postEphemeralCall?.[1]).toMatchObject({
      channel: 'channel-1',
      user: 'user-1',
      threadTs: 'thread-1',
      text: 'Select a session to attach.',
    });

    const actionsBlock = postEphemeralCall?.[1].blocks?.find((block) => block.type === 'actions');
    const previousButton = actionsBlock?.elements?.find(
      (element) => element.text?.text === 'Previous',
    );
    const previousPayload = parseSlackAgentActionValue<SlackAgentSessionsPageActionPayload>(
      previousButton?.value,
    );
    expect(previousPayload?.previousCursor).toBe('cursor-0');
  });

  it('ignores listed responses whose filters do not match the pending browser scope', async () => {
    const adapter = new SlackBotChannelAdapter();
    setPendingSlackAgentSessionBrowserRequest({
      requestId: 'request-1',
      channelId: 'channel-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workerId: 'worker-a',
      filters: {
        workspaceKey: 'snatch',
        cwd: 'apps/worker',
      },
      cursorHistory: [],
    });

    await adapter.handleEvent(
      buildSessionsListedEvent({
        filters: {
          workspaceKey: 'snatch',
          cwd: 'apps/bot',
        },
      }),
      {
        slackApp: {
          client: {
            chat: {
              update: hoisted.chatUpdate,
            },
          },
        } as never,
      },
    );

    expect(hoisted.postEphemeral).not.toHaveBeenCalled();
    expect(getPendingSlackAgentSessionBrowserRequest('request-1')).toBeDefined();
  });

  it('renders listed responses when filters are equivalent after normalization', async () => {
    const adapter = new SlackBotChannelAdapter();
    setPendingSlackAgentSessionBrowserRequest({
      requestId: 'request-1',
      channelId: 'channel-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      workerId: 'worker-a',
      filters: {
        workspaceKey: ' snatch ',
        roots: ['packages/core', 'docs', 'docs'],
      },
      cursorHistory: [],
    });

    await adapter.handleEvent(
      buildSessionsListedEvent({
        filters: {
          workspaceKey: 'snatch',
          roots: ['docs', 'packages/core'],
        },
      }),
      {
        slackApp: {
          client: {
            chat: {
              update: hoisted.chatUpdate,
            },
          },
        } as never,
      },
    );

    expect(hoisted.postEphemeral).toHaveBeenCalled();
  });
});
