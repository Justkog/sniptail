import 'dotenv/config';
import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { loadWorkerConfig } from '@sniptail/core/config/index.js';
import { logger } from '@sniptail/core/logger.js';
import {
  bootstrapQueueName,
  createBotQueue,
  createConnectionOptions,
  jobQueueName,
} from '@sniptail/core/queue/index.js';
import type { BootstrapRequest } from '@sniptail/core/types/bootstrap.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
import { runBootstrap } from './bootstrap.js';
import { runJob } from './pipeline.js';

const config = loadWorkerConfig();
const connection = createConnectionOptions(config.redisUrl);
const botQueue = createBotQueue(config.redisUrl);

const worker = new Worker<JobSpec>(
  jobQueueName,
  async (job) => {
    logger.info({ jobId: job.id }, 'Worker picked up job');
    return runJob(botQueue, job.data);
  },
  { connection, concurrency: 2 },
);

const bootstrapWorker = new Worker<BootstrapRequest>(
  bootstrapQueueName,
  async (job) => {
    logger.info({ requestId: job.id }, 'Worker picked up bootstrap request');
    await runBootstrap(botQueue, job.data);
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
