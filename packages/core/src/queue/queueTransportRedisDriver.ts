import { Queue, QueueEvents, Worker } from 'bullmq';
import type { Job } from 'bullmq';
import {
  assertValidWorkerId,
  botEventQueueName,
  bootstrapQueueName,
  createConnectionOptions,
  jobQueueName,
  workerJobMailboxQueueName,
  workerMailboxQueueName,
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
      const job = await Promise.resolve(publishQueue.add(name, payload, options));
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
    async pause() {
      await worker.pause(true);
    },
    resume() {
      return Promise.resolve(worker.resume());
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
  const workerMailboxQueues = new Map<string, Queue<WorkerEvent, unknown, string>>();
  const workerMailboxEvents = new Map<string, QueueEvents>();
  const workerJobMailboxQueues = new Map<string, Queue<JobSpec, unknown, string>>();
  const workerJobMailboxEvents = new Map<string, QueueEvents>();
  const consumers: Array<QueueConsumerHandle & { worker: Worker<unknown> }> = [];

  function getWorkerMailboxQueue(workerId: string): Queue<WorkerEvent, unknown, string> {
    const normalizedWorkerId = assertValidWorkerId(workerId);
    let queue = workerMailboxQueues.get(normalizedWorkerId);
    if (!queue) {
      queue = new Queue<WorkerEvent, unknown, string>(workerMailboxQueueName(normalizedWorkerId), {
        connection,
      });
      workerMailboxQueues.set(normalizedWorkerId, queue);
    }
    return queue;
  }

  function getWorkerMailboxEvents(workerId: string): QueueEvents {
    const normalizedWorkerId = assertValidWorkerId(workerId);
    let events = workerMailboxEvents.get(normalizedWorkerId);
    if (!events) {
      events = new QueueEvents(workerMailboxQueueName(normalizedWorkerId), { connection });
      workerMailboxEvents.set(normalizedWorkerId, events);
    }
    return events;
  }

  function getWorkerJobMailboxQueue(workerId: string): Queue<JobSpec, unknown, string> {
    const normalizedWorkerId = assertValidWorkerId(workerId);
    let queue = workerJobMailboxQueues.get(normalizedWorkerId);
    if (!queue) {
      queue = new Queue<JobSpec, unknown, string>(workerJobMailboxQueueName(normalizedWorkerId), {
        connection,
      });
      workerJobMailboxQueues.set(normalizedWorkerId, queue);
    }
    return queue;
  }

  function getWorkerJobMailboxEvents(workerId: string): QueueEvents {
    const normalizedWorkerId = assertValidWorkerId(workerId);
    let events = workerJobMailboxEvents.get(normalizedWorkerId);
    if (!events) {
      events = new QueueEvents(workerJobMailboxQueueName(normalizedWorkerId), { connection });
      workerJobMailboxEvents.set(normalizedWorkerId, events);
    }
    return events;
  }

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
    async publishWorkerEventToMailbox(workerId, event, options) {
      return createPublisher<WorkerEvent>(getWorkerMailboxQueue(workerId)).add(
        event.type,
        event,
        options,
      );
    },
    async publishJobToWorkerMailbox(workerId, job, options) {
      return createPublisher<JobSpec>(getWorkerJobMailboxQueue(workerId)).add(
        job.type,
        job,
        options,
      );
    },
    consumeWorkerMailbox(workerId, options) {
      const consumer = createConsumer<WorkerEvent>(
        workerMailboxQueueName(assertValidWorkerId(workerId)),
        redisUrl,
        options,
      );
      consumers.push(consumer as QueueConsumerHandle & { worker: Worker<unknown> });
      return consumer;
    },
    consumeWorkerJobMailbox(workerId, options) {
      const consumer = createConsumer<JobSpec>(
        workerJobMailboxQueueName(assertValidWorkerId(workerId)),
        redisUrl,
        options,
      );
      consumers.push(consumer as QueueConsumerHandle & { worker: Worker<unknown> });
      return consumer;
    },
    observeWorkerMailbox(workerId, options) {
      const events = getWorkerMailboxEvents(workerId);
      const onWaiting = () => {
        publishAsyncHook(options.onJobAvailable);
      };
      events.on('waiting', onWaiting);
      return {
        close() {
          events.off('waiting', onWaiting);
          return Promise.resolve();
        },
      };
    },
    observeWorkerJobMailbox(workerId, options) {
      const events = getWorkerJobMailboxEvents(workerId);
      const onWaiting = () => {
        publishAsyncHook(options.onJobAvailable);
      };
      events.on('waiting', onWaiting);
      return {
        close() {
          events.off('waiting', onWaiting);
          return Promise.resolve();
        },
      };
    },
    async countWorkerMailboxJobs(workerId) {
      const counts = await getWorkerMailboxQueue(workerId).getJobCounts('waiting', 'prioritized');
      return {
        waiting: counts.waiting ?? 0,
        prioritized: counts.prioritized ?? 0,
      };
    },
    async countWorkerJobMailboxJobs(workerId) {
      const counts = await getWorkerJobMailboxQueue(workerId).getJobCounts(
        'waiting',
        'prioritized',
      );
      return {
        waiting: counts.waiting ?? 0,
        prioritized: counts.prioritized ?? 0,
      };
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
        ...[...workerMailboxQueues.values()].map((queue) => queue.close()),
        ...[...workerMailboxEvents.values()].map((events) => events.close()),
        ...[...workerJobMailboxQueues.values()].map((queue) => queue.close()),
        ...[...workerJobMailboxEvents.values()].map((events) => events.close()),
      ]);
      workerMailboxQueues.clear();
      workerMailboxEvents.clear();
      workerJobMailboxQueues.clear();
      workerJobMailboxEvents.clear();
    },
  };
}
