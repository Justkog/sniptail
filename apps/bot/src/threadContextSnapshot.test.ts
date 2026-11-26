import { describe, expect, it, vi } from 'vitest';
import { fetchSlackThreadContext } from './slack/lib/threadContext.js';
import { fetchDiscordThreadContext } from './discord/threadContext.js';

describe('structured thread context snapshots', () => {
  it('captures Slack message ids while excluding the triggering mention', async () => {
    const client = {
      conversations: {
        replies: vi.fn().mockResolvedValue({
          messages: [
            { ts: '111.100', user: 'U1', text: '<@BOT> old request' },
            { ts: '111.200', user: 'U2', text: 'new context' },
            { ts: '111.300', user: 'U3', text: '<@BOT> current mention' },
          ],
        }),
      },
    };

    const result = await fetchSlackThreadContext(
      client as never,
      'C1',
      'thread-1',
      '111.300',
      true,
    );

    expect(result?.rendered).toBe('U1: old request\nU2: new context');
    expect(result?.snapshot.messages.map((message) => message.externalId)).toEqual([
      '111.100',
      '111.200',
    ]);
    expect(result?.snapshot.coversThreadRoot).toBe(true);
    expect(result?.snapshot.cursor?.messageId).toBe('111.300');
  });

  it('preserves the legacy Slack string return mode', async () => {
    const client = {
      conversations: {
        replies: vi.fn().mockResolvedValue({
          messages: [{ ts: '111.100', user: 'U1', text: 'hello' }],
        }),
      },
    };

    await expect(fetchSlackThreadContext(client as never, 'C1', 'thread-1')).resolves.toBe(
      'U1: hello',
    );
  });

  it('captures Discord snowflake ordering while excluding the triggering mention', async () => {
    const messages = new Map([
      ['300', { id: '300', content: '<@123> current', author: { username: 'user-3' } }],
      ['200', { id: '200', content: 'new context', author: { username: 'user-2' } }],
      ['100', { id: '100', content: 'old request', author: { username: 'user-1' } }],
    ]);
    const client = {
      channels: {
        fetch: vi.fn().mockResolvedValue({
          isTextBased: () => true,
          isThread: () => true,
          messages: {
            fetch: vi.fn().mockResolvedValue(messages),
          },
        }),
      },
    };

    const result = await fetchDiscordThreadContext(client as never, 'thread-1', '300', true, true);

    expect(result?.rendered).toBe('user-1: old request\nuser-2: new context');
    expect(result?.snapshot.messages.map((message) => message.externalId)).toEqual(['100', '200']);
    expect(result?.snapshot.coversThreadRoot).toBe(true);
    expect(result?.snapshot.cursor?.messageId).toBe('300');
  });
});
