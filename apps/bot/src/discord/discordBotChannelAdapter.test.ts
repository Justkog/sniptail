import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreBotEvent } from '@sniptail/core/types/bot-event.js';

const hoisted = vi.hoisted(() => ({
  postDiscordMessage: vi.fn().mockResolvedValue({ id: 'message-1' }),
}));

vi.mock('./helpers.js', () => ({
  postDiscordMessage: hoisted.postDiscordMessage,
  postDiscordEphemeral: vi.fn(),
  editDiscordInteractionReply: vi.fn(),
  addDiscordReaction: vi.fn(),
  uploadDiscordFile: vi.fn(),
  fetchDiscordMessage: vi.fn(),
  editDiscordMessage: vi.fn(),
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

describe('DiscordBotChannelAdapter question formatting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.postDiscordMessage.mockResolvedValue({ id: 'message-1' });
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
});
