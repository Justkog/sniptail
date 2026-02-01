import { logger } from '@sniptail/core/logger.js';
import type { WorkerEvent } from '@sniptail/core/types/worker-event.js';
import type { JobRegistry } from './job/jobRegistry.js';

export async function handleWorkerEvent(event: WorkerEvent, registry: JobRegistry): Promise<void> {
  switch (event.type) {
    case 'clearJob': {
      const { jobId, ttlMs } = event.payload;
      await registry.markJobForDeletion(jobId, ttlMs).catch((err) => {
        logger.error({ err, jobId }, 'Failed to schedule job deletion');
      });
      return;
    }
    case 'clearJobsBefore': {
      const cutoff = new Date(event.payload.cutoffIso);
      if (Number.isNaN(cutoff.getTime())) {
        logger.warn({ cutoffIso: event.payload.cutoffIso }, 'Invalid cutoff date');
        return;
      }
      await registry.clearJobsBefore(cutoff).catch((err) => {
        logger.error({ err, cutoffIso: event.payload.cutoffIso }, 'Failed to clear jobs');
      });
      return;
    }
    default:
      logger.warn({ event }, 'Unknown worker event received');
  }
}
