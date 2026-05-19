import type { QueueTransportRuntime } from '@sniptail/core/queue/queueTransportTypes.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { saveJobQueued } from '@sniptail/core/jobs/registry.js';
import { enqueueJob, enqueueWorkerMailboxJob } from '@sniptail/core/queue/queue.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import { auditJobRequest } from '../lib/requestAudit.js';
import { resolveManagedJobOwnerRoute } from './ownerRouting.js';

type ManagedJobQueueRuntime = Pick<QueueTransportRuntime, 'queues' | 'publishJobToWorkerMailbox'>;

export type ManagedJobEnqueueResult =
  | {
      status: 'accepted';
      target: 'shared' | 'worker-mailbox';
      targetWorkerId?: string;
    }
  | {
      status: 'invalid';
      message: string;
    }
  | {
      status: 'persist_failed';
      error: unknown;
    };

export async function saveAndEnqueueManagedJob(input: {
  config: BotConfig;
  queueRuntime: ManagedJobQueueRuntime;
  job: JobSpec;
}): Promise<ManagedJobEnqueueResult> {
  if (!input.job.resumeFromJobId) {
    try {
      await saveJobQueued(input.job);
    } catch (error) {
      auditJobRequest(input.config, input.job, 'persist_failed');
      return {
        status: 'persist_failed',
        error,
      };
    }

    await enqueueJob(input.queueRuntime.queues.jobs, input.job);
    auditJobRequest(input.config, input.job, 'accepted');
    return {
      status: 'accepted',
      target: 'shared',
    };
  }

  const route = await resolveManagedJobOwnerRoute({
    resumeFromJobId: input.job.resumeFromJobId,
  });
  if (!route.ok) {
    return {
      status: 'invalid',
      message: route.errorMessage,
    };
  }

  try {
    await saveJobQueued(input.job);
  } catch (error) {
    auditJobRequest(input.config, input.job, 'persist_failed');
    return {
      status: 'persist_failed',
      error,
    };
  }

  await enqueueWorkerMailboxJob(input.queueRuntime, route.targetWorkerId, input.job);
  auditJobRequest(input.config, input.job, 'accepted');
  return {
    status: 'accepted',
    target: 'worker-mailbox',
    targetWorkerId: route.targetWorkerId,
  };
}
