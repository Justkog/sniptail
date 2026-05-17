import { mkdir } from 'node:fs/promises';
import { Mutex } from 'async-mutex';
import { loadWorkerConfig } from '@sniptail/core/config/config.js';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import { logger } from '@sniptail/core/logger.js';
import { createQueueTransportRuntime } from '@sniptail/core/queue/queueTransportFactory.js';
import type {
  QueueConsumerHandle,
  QueueTransportRuntime,
} from '@sniptail/core/queue/queueTransportTypes.js';
import { createAgentSessionOwnershipRegistryStore } from '@sniptail/core/registry/registryStoreFactory.js';
import { seedRepoCatalogFromAllowlistFile } from '@sniptail/core/repos/catalog.js';
import { runBootstrap } from './bootstrap.js';
import { runJob } from './pipeline.js';
import { handleWorkerEvent } from './workerEvents.js';
import { BullMqBotEventSink } from './channels/botEventSink.js';
import { startWorkerCapabilityPublisher } from './agent-command/workerCapabilityPublisher.js';
import { createJobRegistry } from './job/createJobRegistry.js';
import { assertDockerPreflight } from './docker/dockerPreflight.js';
import { assertGitCommitIdentityPreflight } from './git/gitPreflight.js';
import { assertLocalAgentPreflight } from './preflight/agentPreflight.js';
import { syncRunActionMetadata } from './repos/syncRunActionMetadata.js';

export type WorkerRuntimeHandle = {
  close(): Promise<void>;
};

export type StartWorkerRuntimeOptions = {
  queueRuntime?: QueueTransportRuntime;
};

function getWorkerMailboxQueueName(workerId: string): string {
  return `sniptail-worker-mailbox:${workerId}`;
}

async function loadWorkerActiveSessionCount(config: WorkerConfig): Promise<number> {
  const ownershipStore = await createAgentSessionOwnershipRegistryStore(config);
  const counts = await ownershipStore.listActiveSessionCountsByWorkerIds([config.workerId]);
  return counts[config.workerId] ?? 0;
}

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
  logger.info(
    {
      workerId: config.workerId,
      queueDriver: config.queueDriver,
      registryDriver: config.registryDriver,
      registryNamespace: config.registryNamespace,
    },
    'Starting worker runtime',
  );
  await assertDockerPreflight(config);
  await assertLocalAgentPreflight(config, config.primaryAgent);
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
  const workerCapabilityPublisher = await startWorkerCapabilityPublisher(config);
  const jobRegistry = createJobRegistry(config);
  const consumers: QueueConsumerHandle[] = [];
  const shouldConsumeAgentMailbox =
    config.agent.enabled &&
    Object.keys(config.agent.workspaces).length > 0 &&
    Object.keys(config.agent.profiles).length > 0;
  const effectiveWorkerEventConcurrency = shouldConsumeAgentMailbox
    ? 1
    : config.workerEventConcurrency;
  const workerEventMutex = shouldConsumeAgentMailbox ? new Mutex() : undefined;
  async function pauseSharedWorkerEvents(): Promise<void> {
    if (!sharedWorkerEventConsumer?.pause) {
      return;
    }
    await sharedWorkerEventConsumer.pause();
  }

  async function resumeSharedWorkerEventsIfMailboxIdle(): Promise<void> {
    if (!shouldConsumeAgentMailbox || !sharedWorkerEventConsumer?.resume) {
      return;
    }
    const counts = await queueRuntime.countWorkerMailboxJobs(config.workerId);
    if (counts.waiting === 0 && counts.prioritized === 0) {
      await sharedWorkerEventConsumer.resume();
    }
  }

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

  if (shouldConsumeAgentMailbox) {
    const mailboxQueueName = getWorkerMailboxQueueName(config.workerId);
    try {
      const activeSessionCount = await loadWorkerActiveSessionCount(config);
      logger.info(
        {
          workerId: config.workerId,
          mailboxQueueName,
          configuredWorkerEventConcurrency: config.workerEventConcurrency,
          effectiveWorkerEventConcurrency,
          activeSessionCount,
        },
        'Worker mailbox mode enabled',
      );
    } catch (err) {
      logger.warn(
        {
          err,
          workerId: config.workerId,
          mailboxQueueName,
          configuredWorkerEventConcurrency: config.workerEventConcurrency,
          effectiveWorkerEventConcurrency,
        },
        'Failed to load worker mailbox diagnostics',
      );
    }
    consumers.push(
      queueRuntime.consumeWorkerMailbox(config.workerId, {
        concurrency: 1,
        handler: async (job) => {
          logger.info(
            { workerId: config.workerId, requestId: job.data.requestId, type: job.data.type },
            'Worker mailbox event received',
          );
          await pauseSharedWorkerEvents().catch((err) => {
            logger.warn({ err, workerId: config.workerId }, 'Failed to pause shared worker events');
          });
          await workerEventMutex!.runExclusive(() =>
            handleWorkerEvent(job.data, jobRegistry, botEvents),
          );
        },
        onFailed: async (job, err) => {
          logger.error(
            {
              workerId: config.workerId,
              requestId: job?.data?.requestId,
              type: job?.data?.type,
              err,
            },
            'Worker mailbox event failed',
          );
          await resumeSharedWorkerEventsIfMailboxIdle().catch((resumeErr) => {
            logger.warn(
              { err: resumeErr, workerId: config.workerId },
              'Failed to resume shared worker events after mailbox failure',
            );
          });
        },
        onCompleted: async (job) => {
          logger.info(
            { workerId: config.workerId, requestId: job.data.requestId, type: job.data.type },
            'Worker mailbox event completed',
          );
          await resumeSharedWorkerEventsIfMailboxIdle().catch((err) => {
            logger.warn(
              { err, workerId: config.workerId },
              'Failed to resume shared worker events after mailbox completion',
            );
          });
        },
      }),
    );
  }

  const sharedWorkerEventConsumer = queueRuntime.consumeWorkerEvents({
    concurrency: effectiveWorkerEventConcurrency,
    handler: async (job) => {
      logger.info({ requestId: job.data.requestId, type: job.data.type }, 'Worker event received');
      if (workerEventMutex) {
        await workerEventMutex.runExclusive(() =>
          handleWorkerEvent(job.data, jobRegistry, botEvents),
        );
        return;
      }
      await handleWorkerEvent(job.data, jobRegistry, botEvents);
    },
    onFailed: (job, err) => {
      logger.error({ requestId: job?.data?.requestId, err }, 'Worker event failed');
    },
    onCompleted: (job) => {
      logger.info({ requestId: job.data.requestId, type: job.data.type }, 'Worker event completed');
    },
  });
  consumers.push(sharedWorkerEventConsumer);

  if (shouldConsumeAgentMailbox) {
    consumers.push(
      queueRuntime.observeWorkerMailbox(config.workerId, {
        onJobAvailable: async () => {
          await pauseSharedWorkerEvents().catch((err) => {
            logger.warn(
              { err, workerId: config.workerId },
              'Failed to pause shared worker events from mailbox observer',
            );
          });
        },
      }),
    );
    const initialMailboxCounts = await queueRuntime
      .countWorkerMailboxJobs(config.workerId)
      .catch((err) => {
        logger.warn(
          { err, workerId: config.workerId },
          'Failed to load initial worker mailbox job counts',
        );
        return undefined;
      });
    if (
      initialMailboxCounts &&
      (initialMailboxCounts.waiting > 0 || initialMailboxCounts.prioritized > 0)
    ) {
      await pauseSharedWorkerEvents().catch((err) => {
        logger.warn(
          { err, workerId: config.workerId },
          'Failed to pause shared worker events for pending mailbox jobs',
        );
      });
    }
  }

  return {
    async close() {
      const activeConsumers = consumers.splice(0, consumers.length);
      for (const consumer of activeConsumers) {
        await consumer.close();
      }
      await workerCapabilityPublisher.close();
      if (closeQueueRuntimeOnShutdown) {
        await queueRuntime.close();
      }
    },
  };
}
