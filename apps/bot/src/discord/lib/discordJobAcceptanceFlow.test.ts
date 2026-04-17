import { beforeEach, describe, expect, it, vi } from 'vitest';
import { postDiscordJobAcceptance } from './threads.js';

const { updateJobRecordMock } = vi.hoisted(() => ({
  updateJobRecordMock: vi.fn(),
}));

vi.mock('@sniptail/core/jobs/registry.js', () => ({
  updateJobRecord: updateJobRecordMock,
}));

describe('discord/lib postDiscordJobAcceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateJobRecordMock.mockResolvedValue({});
  });

  it('normalizes Discord channel context to the created thread id', async () => {
    const threadChannel = {
      id: 'thread-1',
      send: vi.fn(),
    };
    const rootChannel = {
      type: 0,
      partial: false,
      isTextBased: () => true,
      isThread: () => false,
      send: vi.fn(),
    };
    const rootMessage = {
      channel: rootChannel,
      startThread: vi.fn(() => Promise.resolve(threadChannel)),
    };
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
      threadId: 'thread-1',
    });

    expect(updateJobRecordMock).toHaveBeenCalledWith('explore-1', {
      job: {
        ...job,
        channel: {
          ...job.channel,
          channelId: 'thread-1',
          threadId: 'thread-1',
        },
      },
    });
  });
});
