import { Queue, type ConnectionOptions } from 'bullmq';
import type { JobSpec } from '../types/job.js';

export const queueName = 'sniptail-jobs';

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

export function createQueue(redisUrl: string): Queue<JobSpec, unknown, string, JobSpec, unknown, string> {
  const connection = createConnectionOptions(redisUrl);
  return new Queue<JobSpec>(queueName, { connection });
}

export async function enqueueJob(queue: Queue<JobSpec>, job: JobSpec) {
  return queue.add(queueName, job, {
    jobId: job.jobId,
    removeOnComplete: 100,
    removeOnFail: 100,
  });
}
