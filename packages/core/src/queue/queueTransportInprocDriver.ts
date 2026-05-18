import {
  assertValidWorkerId,
  botEventQueueName,
  bootstrapQueueName,
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
  #subscriberPaused = false;
  #inFlight = 0;
  #scheduled = false;
  #closed = false;
  #idCounter = 0;
  #closeWaiter: Deferred | undefined;
  readonly #jobAvailableListeners = new Set<() => void | Promise<void>>();

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
        this.#subscriberPaused = false;
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      pause: async () => {
        this.#subscriberPaused = true;
      },
      // eslint-disable-next-line @typescript-eslint/require-await
      resume: async () => {
        this.#subscriberPaused = false;
        this.#schedule();
      },
    };
  }

  watchJobAvailable(listener: () => Promise<void> | void): QueueConsumerHandle {
    this.#jobAvailableListeners.add(listener);
    return {
      // eslint-disable-next-line @typescript-eslint/require-await
      close: async () => {
        this.#jobAvailableListeners.delete(listener);
      },
    };
  }

  countRunnableJobs(): number {
    return this.#pending.length;
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
    this.#pendingJobIds.add(id);
    this.#pending.push({ job });
    for (const listener of this.#jobAvailableListeners) {
      void Promise.resolve(listener()).catch(() => undefined);
    }
    this.#schedule();
    return job;
  }

  #schedule() {
    if (this.#scheduled || this.#closed || this.#subscriberPaused) {
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
    if (!subscriber || this.#closed || this.#subscriberPaused) {
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
  const mailboxChannels = new Map<string, InprocQueueChannel<WorkerEvent>>();
  const workerJobMailboxChannels = new Map<string, InprocQueueChannel<JobSpec>>();

  function getMailboxChannel(workerId: string): InprocQueueChannel<WorkerEvent> {
    const normalizedWorkerId = assertValidWorkerId(workerId);
    let channel = mailboxChannels.get(normalizedWorkerId);
    if (!channel) {
      channel = new InprocQueueChannel<WorkerEvent>(workerMailboxQueueName(normalizedWorkerId));
      mailboxChannels.set(normalizedWorkerId, channel);
    }
    return channel;
  }

  function getWorkerJobMailboxChannel(workerId: string): InprocQueueChannel<JobSpec> {
    const normalizedWorkerId = assertValidWorkerId(workerId);
    let channel = workerJobMailboxChannels.get(normalizedWorkerId);
    if (!channel) {
      channel = new InprocQueueChannel<JobSpec>(workerJobMailboxQueueName(normalizedWorkerId));
      workerJobMailboxChannels.set(normalizedWorkerId, channel);
    }
    return channel;
  }

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
    publishWorkerEventToMailbox(workerId, event, options) {
      return getMailboxChannel(workerId).createPublisher().add(event.type, event, options);
    },
    publishJobToWorkerMailbox(workerId, job, options) {
      return getWorkerJobMailboxChannel(workerId).createPublisher().add(job.type, job, options);
    },
    consumeWorkerMailbox(workerId, options) {
      return getMailboxChannel(workerId).subscribe(options);
    },
    consumeWorkerJobMailbox(workerId, options) {
      return getWorkerJobMailboxChannel(workerId).subscribe(options);
    },
    observeWorkerMailbox(workerId, options) {
      return getMailboxChannel(workerId).watchJobAvailable(options.onJobAvailable);
    },
    observeWorkerJobMailbox(workerId, options) {
      return getWorkerJobMailboxChannel(workerId).watchJobAvailable(options.onJobAvailable);
    },
    countWorkerMailboxJobs(workerId) {
      return Promise.resolve({
        waiting: getMailboxChannel(workerId).countRunnableJobs(),
        prioritized: 0,
      });
    },
    countWorkerJobMailboxJobs(workerId) {
      return Promise.resolve({
        waiting: getWorkerJobMailboxChannel(workerId).countRunnableJobs(),
        prioritized: 0,
      });
    },
    consumeBotEvents(options) {
      return channels.botEvents.subscribe(options);
    },
    async close() {
      await channels.jobs.close();
      await channels.bootstrap.close();
      await channels.workerEvents.close();
      await channels.botEvents.close();
      const activeMailboxChannels = [...mailboxChannels.values()];
      mailboxChannels.clear();
      for (const channel of activeMailboxChannels) {
        await channel.close();
      }
      const activeWorkerJobMailboxChannels = [...workerJobMailboxChannels.values()];
      workerJobMailboxChannels.clear();
      for (const channel of activeWorkerJobMailboxChannels) {
        await channel.close();
      }
    },
  };
}
