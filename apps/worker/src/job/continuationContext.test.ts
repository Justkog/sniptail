import { describe, expect, it } from 'vitest';
import type { JobSpec, JobThreadContextCursor } from '@sniptail/core/types/job.js';
import { buildContinuationContext } from './continuationContext.js';

function buildCursor(messageId: string, threadId = 'thread-1'): JobThreadContextCursor {
  return {
    provider: 'slack',
    channelId: 'C1',
    threadId,
    messageId,
    orderKey: messageId,
  };
}

function buildJob(): JobSpec {
  return {
    jobId: 'job-1',
    type: 'ASK',
    repoKeys: ['repo-1'],
    gitRef: 'main',
    requestText: 'Continue',
    channel: {
      provider: 'slack',
      channelId: 'C1',
      threadId: 'thread-1',
      userId: 'U1',
      requestMessageId: '111.300',
    },
    threadContextSnapshot: {
      version: 1,
      provider: 'slack',
      channelId: 'C1',
      threadId: 'thread-1',
      messages: [
        {
          externalId: '111.100',
          orderKey: '111.100',
          author: 'U1',
          text: 'old',
        },
        {
          externalId: '111.200',
          orderKey: '111.200',
          author: 'U2',
          text: 'new',
        },
      ],
      rendered: 'U1: old\nU2: new',
      cursor: buildCursor('111.200'),
    },
  };
}

describe('buildContinuationContext', () => {
  it('includes only messages newer than a compatible cursor', () => {
    const result = buildContinuationContext(buildJob(), buildCursor('111.100'));

    expect(result.mode).toBe('delta');
    expect(result.rendered).toBe('U2: new');
    expect(result.messageCount).toBe(1);
    expect(result.cursor?.messageId).toBe('111.300');
  });

  it('uses a full bounded fallback when a provider cursor is unavailable', () => {
    const result = buildContinuationContext(buildJob(), undefined);

    expect(result.mode).toBe('full');
    expect(result.reason).toBe('missing_cursor');
    expect(result.rendered).toBe('U1: old\nU2: new');
  });

  it('uses a full fallback for a cursor from another channel thread', () => {
    const result = buildContinuationContext(buildJob(), buildCursor('111.100', 'thread-other'));

    expect(result.mode).toBe('full');
    expect(result.reason).toBe('incompatible_cursor');
    expect(result.rendered).toBe('U1: old\nU2: new');
  });

  it('preserves legacy rendered context and establishes a cursor from the request message', () => {
    const job = buildJob();
    delete job.threadContextSnapshot;
    job.threadContext = 'U2: legacy context';

    const result = buildContinuationContext(job, buildCursor('111.100'));

    expect(result.mode).toBe('full');
    expect(result.reason).toBe('legacy_snapshot_missing');
    expect(result.rendered).toBe('U2: legacy context');
    expect(result.cursor?.messageId).toBe('111.300');
  });
});
