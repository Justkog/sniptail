import { Worker } from 'bullmq';
import type { Job, Queue } from 'bullmq';
import type { JobSpec } from '../types/job.js';
import { queueName, createConnectionOptions } from '../queue/index.js';
import { runJob } from './pipeline.js';
import { logger } from '../logger.js';
import type { App } from '@slack/bolt';

export function startWorker(app: App, redisUrl: string, _queue: Queue<JobSpec>) {
  const connection = createConnectionOptions(redisUrl);
  const worker = new Worker<JobSpec>(
    queueName,
    async (job) => {
      logger.info({ jobId: job.id }, 'Worker picked up job');
      return runJob(app, job.data);
    },
    { connection, concurrency: 2 },
  );

  worker.on('failed', (job: Job<JobSpec> | undefined, err: Error) => {
    logger.error({ jobId: job?.id, err }, 'Job failed');
  });

  worker.on('completed', (job: Job<JobSpec> | undefined) => {
    logger.info({ jobId: job?.id }, 'Job completed');
  });

  return worker;
}
