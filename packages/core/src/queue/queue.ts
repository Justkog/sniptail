import type { ConnectionOptions } from 'bullmq';
import type { BotEvent } from '../types/bot-event.js';
import type { BootstrapRequest } from '../types/bootstrap.js';
import type { JobSpec } from '../types/job.js';
import type { WorkerEvent } from '../types/worker-event.js';
import type { QueuePublisher } from './queueTransportTypes.js';

export const jobQueueName = 'sniptail-jobs';
export const botEventQueueName = 'sniptail-bot-events';
export const bootstrapQueueName = 'sniptail-bootstrap';
export const workerEventQueueName = 'sniptail-worker-events';

export function createConnectionOptions(redisUrl: string): ConnectionOptions {
  return { url: redisUrl };
}

export async function enqueueJob(queue: QueuePublisher<JobSpec>, job: JobSpec) {
  return queue.add(job.type, job, {
    jobId: job.jobId,
    removeOnComplete: 100,
    removeOnFail: 100,
  });
}

export async function enqueueBootstrap(
  queue: QueuePublisher<BootstrapRequest>,
  request: BootstrapRequest,
) {
  return queue.add(bootstrapQueueName, request, {
    jobId: request.requestId,
    removeOnComplete: 100,
    removeOnFail: 100,
  });
}

export async function enqueueBotEvent(queue: QueuePublisher<BotEvent>, event: BotEvent) {
  return queue.add(event.type, event, {
    removeOnComplete: 200,
    removeOnFail: 200,
  });
}

export async function enqueueWorkerEvent(queue: QueuePublisher<WorkerEvent>, event: WorkerEvent) {
  return queue.add(event.type, event, {
    removeOnComplete: 200,
    removeOnFail: 200,
  });
}
