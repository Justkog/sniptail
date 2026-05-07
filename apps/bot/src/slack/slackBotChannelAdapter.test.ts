import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreBotEvent } from '@sniptail/core/types/bot-event.js';

const hoisted = vi.hoisted(() => ({
  postMessage: vi.fn().mockResolvedValue({ ts: 'message-ts-1' }),
  chatUpdate: vi.fn().mockResolvedValue(undefined),
  loadBotConfig: vi.fn(() => ({ botName: 'Sniptail' })),
}));

vi.mock('@sniptail/core/config/config.js', () => ({
  loadBotConfig: hoisted.loadBotConfig,
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
  postEphemeral: vi.fn(),
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

describe('SlackBotChannelAdapter permission updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.postMessage.mockResolvedValue({ ts: 'message-ts-1' });
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
});
