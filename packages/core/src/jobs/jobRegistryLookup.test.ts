import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findLatestJobByChannelThread, findLatestJobByChannelThreadAndTypes } from './registry.js';
import type { JobRecord, JobRegistryStore } from './registryTypes.js';

const findLatestJobRecordByChannelThreadMock =
  vi.fn<JobRegistryStore['findLatestJobRecordByChannelThread']>();

vi.mock('./registryStore.js', () => ({
  // eslint-disable-next-line @typescript-eslint/require-await
  getJobRegistryStore: vi.fn(async () => ({
    kind: 'redis',
    loadAllRecordsByPrefix: vi.fn(),
    loadRecordByKey: vi.fn(),
    findLatestJobRecordByChannelThread: findLatestJobRecordByChannelThreadMock,
    listJobKeysCreatedBefore: vi.fn(),
    countJobRecordsByTypes: vi.fn(),
    listJobRecordsForCleanup: vi.fn(),
    upsertRecord: vi.fn(),
    conditionalUpdateRecord: vi.fn(),
    deleteRecordsByKeys: vi.fn(),
    deleteRecordByKey: vi.fn(),
  })),
}));

function buildLookupRecord(jobId: string): JobRecord {
  return {
    job: {
      jobId,
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
  };
}

describe('jobs/registry lookup delegation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates latest thread lookup with agent filtering to the store', async () => {
    const record = buildLookupRecord('explore-1');
    findLatestJobRecordByChannelThreadMock.mockResolvedValueOnce(record);

    await expect(
      findLatestJobByChannelThread('discord', 'thread-1', 'thread-1', 'codex'),
    ).resolves.toEqual(record);

    expect(findLatestJobRecordByChannelThreadMock).toHaveBeenCalledWith({
      provider: 'discord',
      channelId: 'thread-1',
      threadId: 'thread-1',
      agentId: 'codex',
    });
  });

  it('delegates latest thread lookup with type filtering to the store', async () => {
    const record = buildLookupRecord('explore-2');
    findLatestJobRecordByChannelThreadMock.mockResolvedValueOnce(record);

    await expect(
      findLatestJobByChannelThreadAndTypes('discord', 'parent-1', 'thread-1', ['EXPLORE']),
    ).resolves.toEqual(record);

    expect(findLatestJobRecordByChannelThreadMock).toHaveBeenCalledWith({
      provider: 'discord',
      channelId: 'parent-1',
      threadId: 'thread-1',
      types: ['EXPLORE'],
    });
  });
});
