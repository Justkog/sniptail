import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findLatestJobByChannelThread, findLatestJobByChannelThreadAndTypes } from './registry.js';
import type { JobRegistryStore } from './registryTypes.js';

const loadAllRecordsByPrefixMock = vi.fn<JobRegistryStore['loadAllRecordsByPrefix']>();

vi.mock('./registryStore.js', () => ({
  getJobRegistryStore: vi.fn(async () => ({
    loadAllRecordsByPrefix: loadAllRecordsByPrefixMock,
    loadRecordByKey: vi.fn(),
    upsertRecord: vi.fn(),
    deleteRecordsByKeys: vi.fn(),
    deleteRecordByKey: vi.fn(),
  })),
}));

describe('jobs/registry Discord thread lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('matches legacy Discord thread records when searching from the thread itself', async () => {
    loadAllRecordsByPrefixMock.mockResolvedValueOnce([
      {
        job: {
          jobId: 'explore-1',
          type: 'EXPLORE',
          repoKeys: ['repo-1'],
          gitRef: 'main',
          requestText: 'Investigate issue',
          channel: {
            provider: 'discord',
            channelId: 'parent-1',
            threadId: 'thread-1',
          },
          agentThreadIds: {
            codex: 'agent-thread-1',
          },
        },
        status: 'ok',
        createdAt: '2026-04-16T10:00:00.000Z',
        updatedAt: '2026-04-16T10:00:00.000Z',
      },
    ]);

    await expect(
      findLatestJobByChannelThread('discord', 'thread-1', 'thread-1', 'codex'),
    ).resolves.toMatchObject({
      job: {
        jobId: 'explore-1',
      },
    });
  });

  it('matches normalized Discord thread records when searching from parent-channel context', async () => {
    loadAllRecordsByPrefixMock.mockResolvedValueOnce([
      {
        job: {
          jobId: 'explore-legacy',
          type: 'EXPLORE',
          repoKeys: ['repo-1'],
          gitRef: 'main',
          requestText: 'Investigate issue',
          channel: {
            provider: 'discord',
            channelId: 'parent-1',
            threadId: 'thread-1',
          },
        },
        status: 'ok',
        createdAt: '2026-04-16T10:00:00.000Z',
        updatedAt: '2026-04-16T10:00:00.000Z',
      },
      {
        job: {
          jobId: 'explore-normalized',
          type: 'EXPLORE',
          repoKeys: ['repo-1'],
          gitRef: 'main',
          requestText: 'Investigate issue',
          channel: {
            provider: 'discord',
            channelId: 'thread-1',
            threadId: 'thread-1',
          },
        },
        status: 'ok',
        createdAt: '2026-04-16T10:05:00.000Z',
        updatedAt: '2026-04-16T10:05:00.000Z',
      },
    ]);

    await expect(
      findLatestJobByChannelThreadAndTypes('discord', 'parent-1', 'thread-1', ['EXPLORE']),
    ).resolves.toMatchObject({
      job: {
        jobId: 'explore-normalized',
      },
    });
  });

  it('keeps exact channel matching for non-Discord providers', async () => {
    loadAllRecordsByPrefixMock.mockResolvedValueOnce([
      {
        job: {
          jobId: 'slack-job',
          type: 'EXPLORE',
          repoKeys: ['repo-1'],
          gitRef: 'main',
          requestText: 'Investigate issue',
          channel: {
            provider: 'slack',
            channelId: 'C-parent',
            threadId: '123.456',
            userId: 'U1',
          },
          agentThreadIds: {
            codex: 'agent-thread-1',
          },
        },
        status: 'ok',
        createdAt: '2026-04-16T10:00:00.000Z',
        updatedAt: '2026-04-16T10:00:00.000Z',
      },
    ]);

    await expect(
      findLatestJobByChannelThread('slack', '123.456', '123.456', 'codex'),
    ).resolves.toBeUndefined();
  });
});
