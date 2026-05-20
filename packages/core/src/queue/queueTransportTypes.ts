import type { QueueDriver } from '../config/types.js';
import type { BotEvent } from '../types/bot-event.js';
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
  pause?(): Promise<void>;
  resume?(): Promise<void>;
}

export type QueueChannel = 'jobs' | 'worker-events' | 'bot-events';

export type QueueChannelPayloadMap = {
  jobs: JobSpec;
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

export type WorkerMailboxJobCounts = {
  waiting: number;
  prioritized: number;
};

export type WorkerMailboxObserverOptions = {
  onJobAvailable: () => Promise<void> | void;
};

export interface QueueTransportRuntime {
  driver: QueueDriver;
  queues: {
    jobs: QueuePublisher<JobSpec>;
    workerEvents: QueuePublisher<WorkerEvent>;
    botEvents: QueuePublisher<BotEvent>;
  };
  consumeJobs(options: QueueConsumerOptions<JobSpec>): QueueConsumerHandle;
  consumeWorkerEvents(options: QueueConsumerOptions<WorkerEvent>): QueueConsumerHandle;
  publishWorkerEventToMailbox(
    workerId: string,
    event: WorkerEvent,
    options?: QueueAddOptions,
  ): Promise<QueueJob<WorkerEvent>>;
  publishJobToWorkerMailbox(
    workerId: string,
    job: JobSpec,
    options?: QueueAddOptions,
  ): Promise<QueueJob<JobSpec>>;
  consumeWorkerMailbox(
    workerId: string,
    options: QueueConsumerOptions<WorkerEvent>,
  ): QueueConsumerHandle;
  consumeWorkerJobMailbox(
    workerId: string,
    options: QueueConsumerOptions<JobSpec>,
  ): QueueConsumerHandle;
  observeWorkerMailbox(
    workerId: string,
    options: WorkerMailboxObserverOptions,
  ): QueueConsumerHandle;
  observeWorkerJobMailbox(
    workerId: string,
    options: WorkerMailboxObserverOptions,
  ): QueueConsumerHandle;
  countWorkerMailboxJobs(workerId: string): Promise<WorkerMailboxJobCounts>;
  countWorkerJobMailboxJobs(workerId: string): Promise<WorkerMailboxJobCounts>;
  consumeBotEvents(options: QueueConsumerOptions<BotEvent>): QueueConsumerHandle;
  close(): Promise<void>;
}
