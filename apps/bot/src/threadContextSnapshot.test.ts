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

    expect(result?.threadContext).toBe('U1: old request\nU2: new context');
    expect(result?.threadContextSnapshot.messages.map((message) => message.externalId)).toEqual([
      '111.100',
      '111.200',
    ]);
    expect(result?.threadContextSnapshot.coversThreadRoot).toBe(true);
    expect(result?.threadContextSnapshot.cursor?.messageId).toBe('111.300');
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

    expect(result?.threadContext).toBe('user-1: old request\nuser-2: new context');
    expect(result?.threadContextSnapshot.messages.map((message) => message.externalId)).toEqual([
      '100',
      '200',
    ]);
    expect(result?.threadContextSnapshot.coversThreadRoot).toBe(true);
    expect(result?.threadContextSnapshot.cursor?.messageId).toBe('300');
  });

  it('applies the character cap to structured message bodies too', async () => {
    const client = {
      conversations: {
        replies: vi.fn().mockResolvedValue({
          messages: [{ ts: '111.100', user: 'U1', text: 'x'.repeat(6_000) }],
        }),
      },
    };

    const result = await fetchSlackThreadContext(
      client as never,
      'C1',
      'thread-1',
      undefined,
      true,
    );
    const snapshot = result?.threadContextSnapshot;
    const structuredRendered = snapshot?.messages
      .map((message) => `${message.author}: ${message.text}`)
      .join('\n');

    expect(result?.threadContext.length).toBeLessThanOrEqual(4_000);
    expect(structuredRendered).toBe(result?.threadContext);
    expect(snapshot?.messages[0]?.text.length).toBeLessThan(6_000);
    expect(snapshot?.coversThreadRoot).toBe(false);
  });
});
