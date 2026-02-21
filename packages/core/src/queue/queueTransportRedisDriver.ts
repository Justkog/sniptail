import { Queue, Worker } from 'bullmq';
import type { Job } from 'bullmq';
import {
  botEventQueueName,
  bootstrapQueueName,
  createConnectionOptions,
  jobQueueName,
  workerEventQueueName,
} from './queue.js';
import type {
  QueueConsumerHandle,
  QueueConsumerOptions,
  QueueJob,
  QueuePublisher,
  QueueTransportRuntime,
} from './queueTransportTypes.js';
import type { BotEvent } from '../types/bot-event.js';
import type { BootstrapRequest } from '../types/bootstrap.js';
import type { JobSpec } from '../types/job.js';
import type { WorkerEvent } from '../types/worker-event.js';

function toQueueJob<T>(job: Job<T>): QueueJob<T> {
  return {
    ...(job.id ? { id: String(job.id) } : {}),
    name: job.name,
    data: job.data,
  };
}

function publishAsyncHook<TArgs extends unknown[]>(
  hook: ((...args: TArgs) => void | Promise<void>) | undefined,
  ...args: TArgs
) {
  if (!hook) return;
  void Promise.resolve(hook(...args)).catch(() => undefined);
}

function createPublisher<T>(queue: Queue): QueuePublisher<T> {
  const publishQueue = queue as Queue<unknown, unknown, string>;
  return {
    async add(name, payload, options) {
      const job = await publishQueue.add(name, payload, options);
      return {
        ...(job.id ? { id: String(job.id) } : {}),
        name: String(job.name),
        data: job.data as T,
      };
    },
  };
}

function createConsumer<T>(
  queueName: string,
  redisUrl: string,
  options: QueueConsumerOptions<T>,
): QueueConsumerHandle & { worker: Worker<T> } {
  const connection = createConnectionOptions(redisUrl);
  const worker = new Worker<T>(
    queueName,
    async (job) => {
      await options.handler(toQueueJob(job));
    },
    { connection, concurrency: options.concurrency },
  );

  worker.on('failed', (job: Job<T> | undefined, err: Error) => {
    publishAsyncHook(options.onFailed, job ? toQueueJob(job) : undefined, err);
  });

  worker.on('completed', (job: Job<T> | undefined) => {
    if (!job) return;
    publishAsyncHook(options.onCompleted, toQueueJob(job));
  });

  return {
    worker,
    async close() {
      await worker.close();
    },
  };
}

export function createRedisQueueTransportRuntime(redisUrl: string): QueueTransportRuntime {
  const connection = createConnectionOptions(redisUrl);
  const jobQueue = new Queue<JobSpec, unknown, string>(jobQueueName, { connection });
  const bootstrapQueue = new Queue<BootstrapRequest, unknown, string>(bootstrapQueueName, {
    connection,
  });
  const workerEventQueue = new Queue<WorkerEvent, unknown, string>(workerEventQueueName, {
    connection,
  });
  const botEventQueue = new Queue<BotEvent, unknown, string>(botEventQueueName, { connection });
  const consumers: Array<QueueConsumerHandle & { worker: Worker<unknown> }> = [];

  return {
    driver: 'redis',
    queues: {
      jobs: createPublisher<JobSpec>(jobQueue),
      bootstrap: createPublisher<BootstrapRequest>(bootstrapQueue),
      workerEvents: createPublisher<WorkerEvent>(workerEventQueue),
      botEvents: createPublisher<BotEvent>(botEventQueue),
    },
    consumeJobs(options) {
      const consumer = createConsumer<JobSpec>(jobQueueName, redisUrl, options);
      consumers.push(consumer as QueueConsumerHandle & { worker: Worker<unknown> });
      return consumer;
    },
    consumeBootstrap(options) {
      const consumer = createConsumer<BootstrapRequest>(bootstrapQueueName, redisUrl, options);
      consumers.push(consumer as QueueConsumerHandle & { worker: Worker<unknown> });
      return consumer;
    },
    consumeWorkerEvents(options) {
      const consumer = createConsumer<WorkerEvent>(workerEventQueueName, redisUrl, options);
      consumers.push(consumer as QueueConsumerHandle & { worker: Worker<unknown> });
      return consumer;
    },
    consumeBotEvents(options) {
      const consumer = createConsumer<BotEvent>(botEventQueueName, redisUrl, options);
      consumers.push(consumer as QueueConsumerHandle & { worker: Worker<unknown> });
      return consumer;
    },
    async close() {
      const closedWorkers = consumers.splice(0, consumers.length);
      for (const consumer of closedWorkers) {
        await consumer.close();
      }
      await Promise.all([
        jobQueue.close(),
        bootstrapQueue.close(),
        workerEventQueue.close(),
        botEventQueue.close(),
      ]);
    },
  };
}
