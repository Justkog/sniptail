import 'dotenv/config';
import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import { loadWorkerConfig } from '@sniptail/core/config/index.js';
import { logger } from '@sniptail/core/logger.js';
import {
  createBotQueue,
  createConnectionOptions,
  jobQueueName,
} from '@sniptail/core/queue/index.js';
import type { JobSpec } from '@sniptail/core/types/job.js';
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

worker.on('failed', (job: Job<JobSpec> | undefined, err: Error) => {
  logger.error({ jobId: job?.id, err }, 'Job failed');
});

worker.on('completed', (job: Job<JobSpec> | undefined) => {
  logger.info({ jobId: job?.id }, 'Job completed');
});
