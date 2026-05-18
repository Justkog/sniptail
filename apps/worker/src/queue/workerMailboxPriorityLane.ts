import { Mutex } from 'async-mutex';
import type {
  QueueConsumerHandle,
  WorkerMailboxJobCounts,
} from '@sniptail/core/queue/queueTransportTypes.js';

export type WorkerMailboxPriorityLaneOptions = {
  getSharedConsumer: () => QueueConsumerHandle | undefined;
  countMailboxJobs: () => Promise<WorkerMailboxJobCounts>;
};

export type WorkerMailboxPriorityLane = {
  runShared<T>(fn: () => Promise<T>): Promise<T>;
  runMailbox<T>(fn: () => Promise<T>): Promise<T>;
  pauseShared(): Promise<void>;
  resumeSharedIfMailboxIdle(): Promise<void>;
  pauseSharedIfMailboxPendingOnStartup(): Promise<void>;
};

export function createWorkerMailboxPriorityLane(
  options: WorkerMailboxPriorityLaneOptions,
): WorkerMailboxPriorityLane {
  const mutex = new Mutex();

  return {
    runShared<T>(fn: () => Promise<T>): Promise<T> {
      return mutex.runExclusive(fn);
    },
    runMailbox<T>(fn: () => Promise<T>): Promise<T> {
      return mutex.runExclusive(fn);
    },
    async pauseShared(): Promise<void> {
      const consumer = options.getSharedConsumer();
      if (!consumer?.pause) {
        return;
      }
      await consumer.pause();
    },
    async resumeSharedIfMailboxIdle(): Promise<void> {
      const consumer = options.getSharedConsumer();
      if (!consumer?.resume) {
        return;
      }
      const counts = await options.countMailboxJobs();
      if (counts.waiting === 0 && counts.prioritized === 0) {
        await consumer.resume();
      }
    },
    async pauseSharedIfMailboxPendingOnStartup(): Promise<void> {
      const counts = await options.countMailboxJobs();
      if (counts.waiting > 0 || counts.prioritized > 0) {
        await this.pauseShared();
      }
    },
  };
}
