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
      coversThreadRoot: true,
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
    expect(result.cursor?.messageId).toBe('111.200');
  });

  it('uses a full bounded fallback when a provider cursor is unavailable', () => {
    const result = buildContinuationContext(buildJob(), undefined);

    expect(result.mode).toBe('full');
    expect(result.reason).toBe('missing_cursor');
    expect(result.rendered).toBe('U1: old\nU2: new');
    expect(result.cursor?.messageId).toBe('111.200');
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
    expect(result.cursor?.messageId).toBe('111.100');
  });

  it('retains the verified cursor when the retained snapshot has an unknown gap', () => {
    const job = buildJob();
    if (!job.threadContextSnapshot) throw new Error('Expected thread snapshot');
    job.threadContextSnapshot = {
      ...job.threadContextSnapshot,
      messages: [job.threadContextSnapshot.messages[1]!],
      rendered: 'U2: new',
      coversThreadRoot: false,
    };

    const result = buildContinuationContext(job, buildCursor('111.050'));

    expect(result.mode).toBe('full');
    expect(result.reason).toBe('uncertain_coverage');
    expect(result.rendered).toBe('U2: new');
    expect(result.cursor?.messageId).toBe('111.050');
  });

  it('does not treat a cursor match inside an incomplete snapshot as sufficient coverage', () => {
    const job = buildJob();
    if (!job.threadContextSnapshot) throw new Error('Expected thread snapshot');
    job.threadContextSnapshot = {
      ...job.threadContextSnapshot,
      coversThreadRoot: false,
    };

    const result = buildContinuationContext(job, buildCursor('111.100'));

    expect(result.mode).toBe('full');
    expect(result.reason).toBe('uncertain_coverage');
    expect(result.rendered).toBe('U1: old\nU2: new');
    expect(result.cursor?.messageId).toBe('111.100');
  });

  it('does not advance past new messages omitted by the character cap', () => {
    const job = buildJob();
    if (!job.threadContextSnapshot) throw new Error('Expected thread snapshot');
    job.threadContextSnapshot = {
      ...job.threadContextSnapshot,
      messages: [
        job.threadContextSnapshot.messages[0]!,
        {
          externalId: '111.200',
          orderKey: '111.200',
          author: 'U2',
          text: 'x'.repeat(5000),
        },
      ],
      rendered: `...${'x'.repeat(4000)}`,
      coversThreadRoot: false,
      cursor: buildCursor('111.200'),
    };

    const result = buildContinuationContext(job, buildCursor('111.100'));

    expect(result.mode).toBe('full');
    expect(result.reason).toBe('uncertain_coverage');
    expect(result.rendered).toBe(`...${'x'.repeat(4000)}`);
    expect(result.cursor?.messageId).toBe('111.100');
  });
});
