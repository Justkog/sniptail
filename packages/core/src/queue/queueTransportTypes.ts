import type { QueueDriver } from '../config/types.js';
import type { BotEvent } from '../types/bot-event.js';
import type { BootstrapRequest } from '../types/bootstrap.js';
import type { JobSpec } from '../types/job.js';
import type { WorkerEvent } from '../types/worker-event.js';

export type QueueAddOptions = {
  jobId?: string;
  removeOnComplete?: number;
  removeOnFail?: number;
};

export type QueueJob<T> = {
  id?: string;
  name: string;
  data: T;
};

export interface QueuePublisher<T> {
  add(name: string, payload: T, options?: QueueAddOptions): Promise<QueueJob<T>>;
}

export interface QueueConsumerHandle {
  close(): Promise<void>;
}

export type QueueChannel = 'jobs' | 'bootstrap' | 'worker-events' | 'bot-events';

export type QueueChannelPayloadMap = {
  jobs: JobSpec;
  bootstrap: BootstrapRequest;
  'worker-events': WorkerEvent;
  'bot-events': BotEvent;
};

export type QueueConsumerOptions<T> = {
  concurrency: number;
  handler: (job: QueueJob<T>) => Promise<void>;
  onFailed?: (job: QueueJob<T> | undefined, err: Error) => Promise<void> | void;
  onCompleted?: (job: QueueJob<T>) => Promise<void> | void;
};

export type QueueTransportConfig = {
  driver: QueueDriver;
  redisUrl?: string;
};

export interface QueueTransportRuntime {
  driver: QueueDriver;
  queues: {
    jobs: QueuePublisher<JobSpec>;
    bootstrap: QueuePublisher<BootstrapRequest>;
    workerEvents: QueuePublisher<WorkerEvent>;
    botEvents: QueuePublisher<BotEvent>;
  };
  consumeJobs(options: QueueConsumerOptions<JobSpec>): QueueConsumerHandle;
  consumeBootstrap(options: QueueConsumerOptions<BootstrapRequest>): QueueConsumerHandle;
  consumeWorkerEvents(options: QueueConsumerOptions<WorkerEvent>): QueueConsumerHandle;
  consumeBotEvents(options: QueueConsumerOptions<BotEvent>): QueueConsumerHandle;
  close(): Promise<void>;
}
