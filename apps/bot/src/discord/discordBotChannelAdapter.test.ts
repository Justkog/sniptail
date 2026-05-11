import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreBotEvent } from '@sniptail/core/types/bot-event.js';

const hoisted = vi.hoisted(() => ({
  postDiscordMessage: vi.fn().mockResolvedValue({ id: 'message-1' }),
  fetchDiscordMessage: vi.fn(),
  editDiscordMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./helpers.js', () => ({
  postDiscordMessage: hoisted.postDiscordMessage,
  postDiscordEphemeral: vi.fn(),
  editDiscordInteractionReply: vi.fn(),
  addDiscordReaction: vi.fn(),
  uploadDiscordFile: vi.fn(),
  fetchDiscordMessage: hoisted.fetchDiscordMessage,
  editDiscordMessage: hoisted.editDiscordMessage,
}));

import { DiscordBotChannelAdapter } from './discordBotChannelAdapter.js';

function buildQuestionEvent(
  questions: CoreBotEvent<'agent.question.requested'>['payload']['questions'],
): CoreBotEvent<'agent.question.requested'> {
  return {
    schemaVersion: 1,
    provider: 'discord',
    type: 'agent.question.requested',
    payload: {
      channelId: 'thread-1',
      threadId: 'thread-1',
      sessionId: 'session-1',
      interactionId: 'interaction-1',
      workspaceKey: 'snatch',
      expiresAt: '2026-01-01T00:30:00.000Z',
      questions,
    },
  };
}

function buildPermissionRequestedEvent(): CoreBotEvent<'agent.permission.requested'> {
  return {
    schemaVersion: 1,
    provider: 'discord',
    type: 'agent.permission.requested',
    payload: {
      channelId: 'thread-1',
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
    provider: 'discord',
    type: 'agent.permission.updated',
    payload: {
      channelId: 'thread-1',
      threadId: 'thread-1',
      sessionId: 'session-1',
      interactionId: 'interaction-1',
      status: 'approved_always',
      actorUserId: 'user-1',
    },
  };
}

describe('DiscordBotChannelAdapter question formatting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.postDiscordMessage.mockResolvedValue({ id: 'message-1' });
    hoisted.fetchDiscordMessage.mockResolvedValue({
      content: '**Permission requested** Tool: `bash`',
    });
    hoisted.editDiscordMessage.mockResolvedValue(undefined);
  });

  it('omits numbering and header text for a single question without a header', async () => {
    const adapter = new DiscordBotChannelAdapter();

    await adapter.handleEvent(
      buildQuestionEvent([
        {
          question: 'Pick one number for this test:',
          options: [{ label: 'One' }, { label: 'Two' }, { label: 'Three' }],
          multiple: false,
          custom: true,
        },
      ]),
      { discordClient: {} as never },
    );

    expect(hoisted.postDiscordMessage).toHaveBeenCalledWith(
      {} as never,
      expect.objectContaining({
        text: [
          '**Question requested**',
          '',
          'Workspace: `snatch`',
          'Expires: <t:1767227400:R>',
          '',
          'Pick one number for this test:',
          '- One',
          '- Two',
          '- Three',
          '_Custom answer allowed._',
        ].join('\n'),
      }),
    );
  });

  it('preserves the original permission request text when updating the message status', async () => {
    const adapter = new DiscordBotChannelAdapter();

    await adapter.handleEvent(buildPermissionRequestedEvent(), { discordClient: {} as never });
    await adapter.handleEvent(buildPermissionUpdatedEvent(), { discordClient: {} as never });

    expect(hoisted.editDiscordMessage).toHaveBeenCalledWith(
      {} as never,
      expect.objectContaining({
        channelId: 'thread-1',
        threadId: 'thread-1',
        messageId: 'message-1',
        text: [
          '**Permission requested**',
          '',
          'Tool: `bash`',
          'Action: `run command`',
          'Workspace: `snatch / apps/bot`',
          'Expires: <t:1767227400:R>',
          '',
          'Details:',
          '`pnpm run check`',
          '',
          'Permission always allowed by <@user-1>.',
        ].join('\n'),
        components: [],
      }),
    );
  });
});
