import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event as OpenCodeEvent } from '@opencode-ai/sdk/v2';
import { fetchCompletedAssistantMessageText } from './events.js';

const hoisted = vi.hoisted(() => ({
  createOpencodeClient: vi.fn(),
  client: {
    session: {
      message: vi.fn(),
    },
  },
}));

vi.mock('@opencode-ai/sdk/v2', () => ({
  createOpencodeClient: hoisted.createOpencodeClient,
}));

describe('OpenCode event helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.createOpencodeClient.mockReturnValue(hoisted.client);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches completed assistant message text from message.updated events', async () => {
    hoisted.client.session.message.mockResolvedValue({
      data: {
        info: { id: 'message-1', role: 'assistant' },
        parts: [{ type: 'text', text: 'completed assistant text' }],
      },
    });

    const text = await fetchCompletedAssistantMessageText(hoisted.client, {
      type: 'message.updated',
      properties: {
        info: {
          id: 'message-1',
          sessionID: 'session-1',
          role: 'assistant',
          time: { completed: 123 },
        },
      },
    } as OpenCodeEvent);

    expect(text).toBe('completed assistant text');
    expect(hoisted.client.session.message).toHaveBeenCalledWith({
      sessionID: 'session-1',
      messageID: 'message-1',
    });
  });

  it('ignores message updates that are not completed assistant messages', async () => {
    await expect(
      fetchCompletedAssistantMessageText(hoisted.client, {
        type: 'message.updated',
        properties: {
          info: {
            id: 'message-1',
            sessionID: 'session-1',
            role: 'assistant',
            time: {},
          },
        },
      } as OpenCodeEvent),
    ).resolves.toBe('');
    await expect(
      fetchCompletedAssistantMessageText(hoisted.client, {
        type: 'message.updated',
        properties: {
          info: {
            id: 'message-1',
            sessionID: 'session-1',
            role: 'user',
            time: { completed: 123 },
          },
        },
      } as OpenCodeEvent),
    ).resolves.toBe('');
    expect(hoisted.client.session.message).not.toHaveBeenCalled();
  });

  it('returns empty text when the completed assistant message has no text parts', async () => {
    hoisted.client.session.message.mockResolvedValue({
      data: {
        info: { id: 'message-1', role: 'assistant' },
        parts: [{ type: 'tool', tool: 'bash' }],
      },
    });

    await expect(
      fetchCompletedAssistantMessageText(hoisted.client, {
        type: 'message.updated',
        properties: {
          info: {
            id: 'message-1',
            sessionID: 'session-1',
            role: 'assistant',
            time: { completed: 123 },
          },
        },
      } as OpenCodeEvent),
    ).resolves.toBe('');
  });
});
