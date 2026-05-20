import { describe, expect, it, vi } from 'vitest';
import { enqueueBootstrapWorkerEvent } from './queue.js';

describe('enqueueBootstrapWorkerEvent', () => {
  it('uses the worker event request id as the queue job id', async () => {
    const add = vi.fn().mockResolvedValue(undefined);
    const queue = { add };
    const event = {
      schemaVersion: 1 as const,
      requestId: 'bootstrap-1',
      type: 'repos.bootstrap' as const,
      payload: {
        requestId: 'bootstrap-1',
        repoName: 'repo',
        repoKey: 'repo',
        service: 'local',
        localPath: '/tmp/repo',
        channel: {
          provider: 'slack' as const,
          channelId: 'C1',
          userId: 'U1',
        },
      },
    };

    await enqueueBootstrapWorkerEvent(queue, event);

    expect(add).toHaveBeenCalledWith('repos.bootstrap', event, {
      jobId: 'bootstrap-1',
      removeOnComplete: 200,
      removeOnFail: 200,
    });
  });
});
