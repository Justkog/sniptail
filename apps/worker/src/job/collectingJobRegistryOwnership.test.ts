import { describe, expect, it } from 'vitest';
import { CollectingJobRegistry } from './collectingJobRegistry.js';

describe('CollectingJobRegistry ownership fields', () => {
  it('preserves owner metadata across later updates', async () => {
    const registry = new CollectingJobRegistry({
      now: () => new Date('2026-05-18T13:00:00.000Z'),
    });

    registry.seedJob({
      jobId: 'job-1',
      type: 'IMPLEMENT',
      repoKeys: ['repo-1'],
      gitRef: 'main',
      requestText: 'Implement fix',
      channel: {
        provider: 'slack',
        channelId: 'C1',
        threadId: 'T1',
        userId: 'U1',
      },
    });

    await registry.updateJobRecord('job-1', {
      ownerWorkerId: 'worker-a',
      ownerWorkerLabel: 'Worker A',
      workerClaimedAt: '2026-05-18T13:01:00.000Z',
    });
    await registry.updateJobRecord('job-1', {
      summary: 'Done',
      status: 'ok',
    });

    await expect(registry.loadJobRecord('job-1')).resolves.toMatchObject({
      status: 'ok',
      summary: 'Done',
      ownerWorkerId: 'worker-a',
      ownerWorkerLabel: 'Worker A',
      workerClaimedAt: '2026-05-18T13:01:00.000Z',
    });
  });
});
