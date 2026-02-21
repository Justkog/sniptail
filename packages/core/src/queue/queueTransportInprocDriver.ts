import {
  botEventQueueName,
  bootstrapQueueName,
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

type Deferred = {
  promise: Promise<void>;
  resolve: () => void;
};

type QueueItem<T> = {
  job: QueueJob<T>;
};

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

class InprocQueueChannel<T> {
  readonly #name: string;
  readonly #pending: QueueItem<T>[] = [];
  readonly #pendingJobIds = new Set<string>();
  #subscriber: QueueConsumerOptions<T> | undefined;
  #inFlight = 0;
  #scheduled = false;
  #closed = false;
  #idCounter = 0;
  #closeWaiter: Deferred | undefined;

  constructor(name: string) {
    this.#name = name;
  }

  createPublisher(): QueuePublisher<T> {
    return {
      add: async (name, payload, options) => this.enqueue(name, payload, options?.jobId),
    };
  }

  subscribe(options: QueueConsumerOptions<T>): QueueConsumerHandle {
    if (this.#subscriber) {
      throw new Error(`Inproc channel "${this.#name}" already has a subscriber.`);
    }
    this.#subscriber = options;
    this.#schedule();
    return {
      // eslint-disable-next-line @typescript-eslint/require-await
      close: async () => {
        this.#subscriber = undefined;
      },
    };
  }

  async close(): Promise<void> {
    if (this.#closed) {
      if (this.#closeWaiter) {
        await this.#closeWaiter.promise;
      }
      return;
    }
    this.#closed = true;
    this.#subscriber = undefined;
    this.#pending.length = 0;
    this.#pendingJobIds.clear();
    if (this.#inFlight === 0) {
      return;
    }
    this.#closeWaiter = createDeferred();
    await this.#closeWaiter.promise;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  private async enqueue(name: string, payload: T, requestedJobId?: string): Promise<QueueJob<T>> {
    if (this.#closed) {
      throw new Error(`Inproc queue channel "${this.#name}" is closed.`);
    }
    const jobId = requestedJobId?.trim();
    if (jobId && this.#pendingJobIds.has(jobId)) {
      throw new Error(`Duplicate inproc job id "${jobId}" on channel "${this.#name}".`);
    }

    const id = jobId ?? `${this.#name}-${++this.#idCounter}`;
    const job: QueueJob<T> = {
      id,
      name,
      data: payload,
    };
    if (jobId) {
      this.#pendingJobIds.add(jobId);
    }
    this.#pending.push({ job });
    this.#schedule();
    return job;
  }

  #schedule() {
    if (this.#scheduled || this.#closed) {
      return;
    }
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      void this.#dispatch();
    });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async #dispatch() {
    const subscriber = this.#subscriber;
    if (!subscriber || this.#closed) {
      return;
    }
    while (this.#inFlight < subscriber.concurrency && this.#pending.length > 0) {
      const item = this.#pending.shift();
      if (!item) {
        break;
      }
      this.#inFlight += 1;
      void this.#runItem(item, subscriber);
    }
  }

  async #runItem(item: QueueItem<T>, subscriber: QueueConsumerOptions<T>) {
    let failure: Error | undefined;
    try {
      await subscriber.handler(item.job);
      try {
        await subscriber.onCompleted?.(item.job);
      } catch {
        // Consumer completion hooks are best-effort.
      }
    } catch (err) {
      failure = err instanceof Error ? err : new Error(String(err));
      try {
        await subscriber.onFailed?.(item.job, failure);
      } catch {
        // Consumer failure hooks are best-effort.
      }
    } finally {
      this.#inFlight -= 1;
      if (item.job.id) {
        this.#pendingJobIds.delete(item.job.id);
      }
      if (this.#closed && this.#inFlight === 0 && this.#closeWaiter) {
        this.#closeWaiter.resolve();
        this.#closeWaiter = undefined;
      } else if (!this.#closed) {
        this.#schedule();
      }
    }
  }
}

export function createInprocQueueTransportRuntime(): QueueTransportRuntime {
  const channels = {
    jobs: new InprocQueueChannel<JobSpec>(jobQueueName),
    bootstrap: new InprocQueueChannel<BootstrapRequest>(bootstrapQueueName),
    workerEvents: new InprocQueueChannel<WorkerEvent>(workerEventQueueName),
    botEvents: new InprocQueueChannel<BotEvent>(botEventQueueName),
  };

  return {
    driver: 'inproc',
    queues: {
      jobs: channels.jobs.createPublisher(),
      bootstrap: channels.bootstrap.createPublisher(),
      workerEvents: channels.workerEvents.createPublisher(),
      botEvents: channels.botEvents.createPublisher(),
    },
    consumeJobs(options) {
      return channels.jobs.subscribe(options);
    },
    consumeBootstrap(options) {
      return channels.bootstrap.subscribe(options);
    },
    consumeWorkerEvents(options) {
      return channels.workerEvents.subscribe(options);
    },
    consumeBotEvents(options) {
      return channels.botEvents.subscribe(options);
    },
    async close() {
      await channels.jobs.close();
      await channels.bootstrap.close();
      await channels.workerEvents.close();
      await channels.botEvents.close();
    },
  };
}
