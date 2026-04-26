import { beforeEach, describe, expect, it, vi } from 'vitest';
import { postDiscordJobAcceptance } from './threads.js';

describe('discord/lib postDiscordJobAcceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes Discord channel context to the created thread id', async () => {
    const threadChannel = {
      id: 'thread-1',
      send: vi.fn(),
    };
    const fetch = vi.fn();
    const client = {
      channels: {
        fetch,
      },
    };
    const rootChannel = {
      id: 'parent-1',
      type: 0,
      partial: false,
      client,
      isTextBased: () => true,
      isThread: () => false,
      send: vi.fn(),
    };
    const rootMessage = {
      id: 'message-1',
      channel: rootChannel,
      startThread: vi.fn(() => Promise.resolve(threadChannel)),
    };
    fetch.mockResolvedValue(rootChannel);
    rootChannel.send.mockResolvedValue(rootMessage);

    const interaction = {
      channel: rootChannel,
    };
    const job = {
      jobId: 'explore-1',
      type: 'EXPLORE' as const,
      repoKeys: ['repo-1'],
      gitRef: 'main',
      requestText: 'Inspect the service',
      channel: {
        provider: 'discord' as const,
        channelId: 'parent-1',
        userId: 'user-1',
      },
    };

    await expect(
      postDiscordJobAcceptance(interaction as never, job, 'Inspect the service', 'sniptail', {
        requestAsPrimaryMessage: true,
      }),
    ).resolves.toMatchObject({
      acceptancePosted: true,
      requestMessageId: 'message-1',
      channelId: 'thread-1',
      threadId: 'thread-1',
    });
  });
});
