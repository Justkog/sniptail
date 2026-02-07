import 'dotenv/config';
import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { loadWorkerConfig } from '@sniptail/core/config/config.js';
import { logger } from '@sniptail/core/logger.js';
import { seedRepoCatalogFromAllowlistFile } from '@sniptail/core/repos/catalog.js';
import {
  bootstrapQueueName,
  createBotQueue,
  createConnectionOptions,
  jobQueueName,
  workerEventQueueName,
} from '@sniptail/core/queue/queue.js';
import type { BootstrapRequest } from '@sniptail/core/types/bootstrap.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import type { WorkerEvent } from '@sniptail/core/types/worker-event.js';
import { runBootstrap } from './bootstrap.js';
import { runJob } from './pipeline.js';
import { handleWorkerEvent } from './workerEvents.js';
import { BullMqBotEventSink } from './channels/botEventSink.js';
import { createJobRegistry } from './job/createJobRegistry.js';

const config = loadWorkerConfig();
await seedRepoCatalogFromAllowlistFile({
  mode: 'if-empty',
  ...(config.repoAllowlistPath ? { filePath: config.repoAllowlistPath } : {}),
});
const connection = createConnectionOptions(config.redisUrl);
const botQueue = createBotQueue(config.redisUrl);
const botEvents = new BullMqBotEventSink(botQueue);
const jobRegistry = createJobRegistry(config);

const worker = new Worker<JobSpec>(
  jobQueueName,
  async (job) => {
    logger.info({ jobId: job.id }, 'Worker picked up job');
    return runJob(botEvents, job.data, jobRegistry);
  },
  { connection, concurrency: 2 },
);

const bootstrapWorker = new Worker<BootstrapRequest>(
  bootstrapQueueName,
  async (job) => {
    logger.info({ requestId: job.id }, 'Worker picked up bootstrap request');
    await runBootstrap(botEvents, job.data);
  },
  { connection, concurrency: 2 },
);

const workerEventWorker = new Worker<WorkerEvent>(
  workerEventQueueName,
  async (job) => {
    logger.info({ requestId: job.data.requestId, type: job.data.type }, 'Worker event received');
    await handleWorkerEvent(job.data, jobRegistry, botEvents);
  },
  { connection, concurrency: 2 },
);

worker.on('failed', (job: Job<JobSpec> | undefined, err: Error) => {
  logger.error({ jobId: job?.id, err }, 'Job failed');
});

worker.on('completed', (job: Job<JobSpec> | undefined) => {
  logger.info({ jobId: job?.id }, 'Job completed');
});

bootstrapWorker.on('failed', (job: Job<BootstrapRequest> | undefined, err: Error) => {
  logger.error({ requestId: job?.id, err }, 'Bootstrap request failed');
});

bootstrapWorker.on('completed', (job: Job<BootstrapRequest> | undefined) => {
  logger.info({ requestId: job?.id }, 'Bootstrap request completed');
});

workerEventWorker.on('failed', (job: Job<WorkerEvent> | undefined, err: Error) => {
  logger.error({ requestId: job?.data?.requestId, err }, 'Worker event failed');
});

workerEventWorker.on('completed', (job: Job<WorkerEvent> | undefined) => {
  logger.info({ requestId: job?.data?.requestId, type: job?.data?.type }, 'Worker event completed');
});
