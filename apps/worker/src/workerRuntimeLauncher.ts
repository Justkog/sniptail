import { mkdir } from 'node:fs/promises';
import { loadWorkerConfig } from '@sniptail/core/config/config.js';
import { logger } from '@sniptail/core/logger.js';
import { createQueueTransportRuntime } from '@sniptail/core/queue/queueTransportFactory.js';
import type {
  QueueConsumerHandle,
  QueueTransportRuntime,
} from '@sniptail/core/queue/queueTransportTypes.js';
import { seedRepoCatalogFromAllowlistFile } from '@sniptail/core/repos/catalog.js';
import { runBootstrap } from './bootstrap.js';
import { runJob } from './pipeline.js';
import { handleWorkerEvent } from './workerEvents.js';
import { BullMqBotEventSink } from './channels/botEventSink.js';
import { createJobRegistry } from './job/createJobRegistry.js';
import { assertDockerPreflight } from './docker/dockerPreflight.js';
import { assertGitCommitIdentityPreflight } from './git/gitPreflight.js';
import { syncRunActionMetadata } from './repos/syncRunActionMetadata.js';

export type WorkerRuntimeHandle = {
  close(): Promise<void>;
};

export type StartWorkerRuntimeOptions = {
  queueRuntime?: QueueTransportRuntime;
};

export async function startWorkerRuntime(
  options: StartWorkerRuntimeOptions = {},
): Promise<WorkerRuntimeHandle> {
  const config = loadWorkerConfig();
  if (config.queueDriver === 'inproc' && !options.queueRuntime) {
    throw new Error(
      'queue_driver="inproc" requires a shared local runtime. Use "sniptail local" instead of running "sniptail worker" directly.',
    );
  }

  await mkdir(config.repoCacheRoot, { recursive: true });
  await assertDockerPreflight(config);
  await assertGitCommitIdentityPreflight();
  await seedRepoCatalogFromAllowlistFile({
    mode: 'if-empty',
    ...(config.repoAllowlistPath ? { filePath: config.repoAllowlistPath } : {}),
  });
  const runActionSync = await syncRunActionMetadata().catch((err) => {
    logger.warn({ err }, 'Failed to sync run action metadata on worker startup');
    return undefined;
  });
  if (runActionSync) {
    logger.info(
      {
        scanned: runActionSync.scanned,
        updated: runActionSync.updated,
        failures: runActionSync.failures.length,
      },
      'Completed run action metadata sync',
    );
  }

  const queueRuntime =
    options.queueRuntime ??
    createQueueTransportRuntime({
      driver: config.queueDriver,
      ...(config.redisUrl ? { redisUrl: config.redisUrl } : {}),
    });
  const closeQueueRuntimeOnShutdown = !options.queueRuntime;
  const botEvents = new BullMqBotEventSink(queueRuntime.queues.botEvents);
  const jobRegistry = createJobRegistry(config);
  const consumers: QueueConsumerHandle[] = [];

  consumers.push(
    queueRuntime.consumeJobs({
      concurrency: config.jobConcurrency,
      handler: async (job) => {
        logger.info({ jobId: job.data.jobId }, 'Worker picked up job');
        await runJob(botEvents, job.data, jobRegistry);
      },
      onFailed: (job, err) => {
        logger.error({ jobId: job?.data?.jobId, err }, 'Job failed');
      },
      onCompleted: (job) => {
        logger.info({ jobId: job.data.jobId }, 'Job completed');
      },
    }),
  );

  consumers.push(
    queueRuntime.consumeBootstrap({
      concurrency: config.bootstrapConcurrency,
      handler: async (job) => {
        logger.info({ requestId: job.data.requestId }, 'Worker picked up bootstrap request');
        await runBootstrap(botEvents, job.data);
      },
      onFailed: (job, err) => {
        logger.error({ requestId: job?.data?.requestId, err }, 'Bootstrap request failed');
      },
      onCompleted: (job) => {
        logger.info({ requestId: job.data.requestId }, 'Bootstrap request completed');
      },
    }),
  );

  consumers.push(
    queueRuntime.consumeWorkerEvents({
      concurrency: config.workerEventConcurrency,
      handler: async (job) => {
        logger.info(
          { requestId: job.data.requestId, type: job.data.type },
          'Worker event received',
        );
        await handleWorkerEvent(job.data, jobRegistry, botEvents);
      },
      onFailed: (job, err) => {
        logger.error({ requestId: job?.data?.requestId, err }, 'Worker event failed');
      },
      onCompleted: (job) => {
        logger.info(
          { requestId: job.data.requestId, type: job.data.type },
          'Worker event completed',
        );
      },
    }),
  );

  return {
    async close() {
      const activeConsumers = consumers.splice(0, consumers.length);
      for (const consumer of activeConsumers) {
        await consumer.close();
      }
      if (closeQueueRuntimeOnShutdown) {
        await queueRuntime.close();
      }
    },
  };
}
