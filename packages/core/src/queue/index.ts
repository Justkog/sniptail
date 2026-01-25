import { Queue, type ConnectionOptions } from 'bullmq';
import type { BotEvent } from '../types/bot-event.js';
import type { BootstrapRequest } from '../types/bootstrap.js';
import type { JobSpec } from '../types/job.js';
import type { WorkerEvent } from '../types/worker-event.js';

export const jobQueueName = 'sniptail-jobs';
export const botEventQueueName = 'sniptail-bot-events';
export const bootstrapQueueName = 'sniptail-bootstrap';
export const workerEventQueueName = 'sniptail-worker-events';

export function createConnectionOptions(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl);
  const options: Record<string, string | number> = {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
  };

  if (url.username) options.username = url.username;
  if (url.password) options.password = url.password;
  if (url.pathname && url.pathname.length > 1) {
    const db = Number(url.pathname.slice(1));
    if (!Number.isNaN(db)) options.db = db;
  }

  return options as ConnectionOptions;
}

export function createJobQueue(
  redisUrl: string,
): Queue<JobSpec> {
  const connection = createConnectionOptions(redisUrl);
  return new Queue<JobSpec>(jobQueueName, { connection });
}

export async function enqueueJob(queue: Queue<JobSpec>, job: JobSpec) {
  return queue.add(job.type, job, {
    jobId: job.jobId,
    removeOnComplete: 100,
    removeOnFail: 100,
  });
}

export function createBootstrapQueue(
  redisUrl: string,
): Queue<BootstrapRequest> {
  const connection = createConnectionOptions(redisUrl);
  return new Queue<BootstrapRequest>(bootstrapQueueName, { connection });
}

export async function enqueueBootstrap(queue: Queue<BootstrapRequest>, request: BootstrapRequest) {
  return queue.add(bootstrapQueueName, request, {
    jobId: request.requestId,
    removeOnComplete: 100,
    removeOnFail: 100,
  });
}

export function createBotQueue(
  redisUrl: string,
): Queue<BotEvent> {
  const connection = createConnectionOptions(redisUrl);
  return new Queue<BotEvent>(botEventQueueName, { connection });
}

export async function enqueueBotEvent(queue: Queue<BotEvent>, event: BotEvent) {
  return queue.add(event.type, event, {
    removeOnComplete: 200,
    removeOnFail: 200,
  });
}

export function createWorkerEventQueue(
  redisUrl: string,
): Queue<WorkerEvent> {
  const connection = createConnectionOptions(redisUrl);
  return new Queue<WorkerEvent>(workerEventQueueName, { connection });
}

export async function enqueueWorkerEvent(queue: Queue<WorkerEvent>, event: WorkerEvent) {
  return queue.add(event.type, event, {
    removeOnComplete: 200,
    removeOnFail: 200,
  });
}
