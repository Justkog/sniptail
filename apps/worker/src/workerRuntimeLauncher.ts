import { mkdir } from 'node:fs/promises';
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
import { runJob } from './pipeline.js';
import { handleWorkerEvent } from './workerEvents.js';
import { BullMqBotEventSink } from './channels/botEventSink.js';
import { startWorkerCapabilityPublisher } from './agent-command/workerCapabilityPublisher.js';
import { createJobRegistry } from './job/createJobRegistry.js';
import { assertDockerPreflight } from './docker/dockerPreflight.js';
import { assertGitCommitIdentityPreflight } from './git/gitPreflight.js';
import { assertLocalAgentPreflight } from './preflight/agentPreflight.js';
import { createWorkerMailboxPriorityLane } from './queue/workerMailboxPriorityLane.js';
import { syncRunActionMetadata } from './repos/syncRunActionMetadata.js';
import {
  createSniptailTelemetry,
  NOOP_TELEMETRY,
  type SniptailTelemetry,
} from '@sniptail/core/telemetry/sniptailTelemetry.js';

export type WorkerRuntimeHandle = {
  close(): Promise<void>;
};

export type StartWorkerRuntimeOptions = {
  queueRuntime?: QueueTransportRuntime;
  telemetry?: SniptailTelemetry | false;
  captureRuntimeStarted?: boolean;
};

function getWorkerMailboxQueueName(workerId: string): string {
  return `sniptail-worker-mailbox:${workerId}`;
}

function getWorkerJobMailboxQueueName(workerId: string): string {
  return `sniptail-worker-jobs:${workerId}`;
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
  const telemetryEnabled = config.telemetryEnabled && options.telemetry !== false;
  const ownsTelemetry = telemetryEnabled && options.telemetry === undefined;
  const telemetry = !telemetryEnabled
    ? NOOP_TELEMETRY
    : typeof options.telemetry === 'object'
      ? options.telemetry
      : ownsTelemetry
        ? await createSniptailTelemetry({ enabled: true, runtimeMode: 'worker' })
        : NOOP_TELEMETRY;
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
      consumeSharedWorkerEvents: config.consumeSharedWorkerEvents,
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
  const shouldConsumeSharedWorkerEvents = config.consumeSharedWorkerEvents;
  const effectiveWorkerEventConcurrency = !shouldConsumeSharedWorkerEvents
    ? 0
    : shouldConsumeAgentMailbox
      ? 1
      : config.workerEventConcurrency;
  let sharedWorkerEventConsumer: QueueConsumerHandle | undefined;
  const sharedJobConsumerRef: { current?: QueueConsumerHandle } = {};
  const managedJobLane = createWorkerMailboxPriorityLane({
    getSharedConsumer: () => sharedJobConsumerRef.current,
    countMailboxJobs: () => queueRuntime.countWorkerJobMailboxJobs(config.workerId),
  });
  const workerEventLane = shouldConsumeAgentMailbox
    ? createWorkerMailboxPriorityLane({
        getSharedConsumer: () => sharedWorkerEventConsumer,
        countMailboxJobs: () => queueRuntime.countWorkerMailboxJobs(config.workerId),
      })
    : undefined;

  const sharedJobConsumer = queueRuntime.consumeJobs({
    concurrency: config.jobConcurrency,
    handler: async (job) => {
      logger.info({ jobId: job.data.jobId }, 'Worker picked up job');
      await managedJobLane.runShared(() => runJob(botEvents, job.data, jobRegistry, telemetry));
    },
    onFailed: (job, err) => {
      logger.error({ jobId: job?.data?.jobId, err }, 'Job failed');
    },
    onCompleted: (job) => {
      logger.info({ jobId: job.data.jobId }, 'Job completed');
    },
  });
  sharedJobConsumerRef.current = sharedJobConsumer;
  consumers.push(sharedJobConsumer);

  const jobMailboxQueueName = getWorkerJobMailboxQueueName(config.workerId);
  consumers.push(
    queueRuntime.consumeWorkerJobMailbox(config.workerId, {
      concurrency: config.jobConcurrency,
      handler: async (job) => {
        logger.info(
          {
            workerId: config.workerId,
            jobId: job.data.jobId,
            resumeFromJobId: job.data.resumeFromJobId,
          },
          'Worker picked up targeted job',
        );
        await managedJobLane.pauseShared().catch((err) => {
          logger.warn({ err, workerId: config.workerId }, 'Failed to pause shared jobs');
        });
        await managedJobLane.runMailbox(() => runJob(botEvents, job.data, jobRegistry, telemetry));
      },
      onFailed: async (job, err) => {
        logger.error(
          {
            workerId: config.workerId,
            jobId: job?.data?.jobId,
            resumeFromJobId: job?.data?.resumeFromJobId,
            err,
          },
          'Targeted job failed',
        );
        await managedJobLane.resumeSharedIfMailboxIdle().catch((resumeErr) => {
          logger.warn(
            { err: resumeErr, workerId: config.workerId },
            'Failed to resume shared jobs after targeted job failure',
          );
        });
      },
      onCompleted: async (job) => {
        logger.info(
          {
            workerId: config.workerId,
            jobId: job.data.jobId,
            resumeFromJobId: job.data.resumeFromJobId,
          },
          'Targeted job completed',
        );
        await managedJobLane.resumeSharedIfMailboxIdle().catch((err) => {
          logger.warn(
            { err, workerId: config.workerId },
            'Failed to resume shared jobs after targeted job completion',
          );
        });
      },
    }),
  );
  consumers.push(
    queueRuntime.observeWorkerJobMailbox(config.workerId, {
      onJobAvailable: async () => {
        await managedJobLane.pauseShared().catch((err) => {
          logger.warn(
            { err, workerId: config.workerId },
            'Failed to pause shared jobs from targeted job mailbox observer',
          );
        });
      },
    }),
  );
  await managedJobLane.pauseSharedIfMailboxPendingOnStartup().catch((err) => {
    logger.warn(
      { err, workerId: config.workerId, jobMailboxQueueName },
      'Failed to load initial targeted job mailbox counts',
    );
  });

  if (shouldConsumeAgentMailbox) {
    const mailboxQueueName = getWorkerMailboxQueueName(config.workerId);
    try {
      const activeSessionCount = await loadWorkerActiveSessionCount(config);
      logger.info(
        {
          workerId: config.workerId,
          mailboxQueueName,
          consumeSharedWorkerEvents: shouldConsumeSharedWorkerEvents,
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
          consumeSharedWorkerEvents: shouldConsumeSharedWorkerEvents,
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
          await workerEventLane!.pauseShared().catch((err) => {
            logger.warn({ err, workerId: config.workerId }, 'Failed to pause shared worker events');
          });
          await workerEventLane!.runMailbox(() =>
            handleWorkerEvent(job.data, jobRegistry, botEvents, telemetry),
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
          await workerEventLane!.resumeSharedIfMailboxIdle().catch((resumeErr) => {
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
          await workerEventLane!.resumeSharedIfMailboxIdle().catch((err) => {
            logger.warn(
              { err, workerId: config.workerId },
              'Failed to resume shared worker events after mailbox completion',
            );
          });
        },
      }),
    );
  }

  if (shouldConsumeSharedWorkerEvents) {
    sharedWorkerEventConsumer = queueRuntime.consumeWorkerEvents({
      concurrency: effectiveWorkerEventConcurrency,
      handler: async (job) => {
        logger.info(
          { requestId: job.data.requestId, type: job.data.type },
          'Worker event received',
        );
        if (workerEventLane) {
          await workerEventLane.runShared(() =>
            handleWorkerEvent(job.data, jobRegistry, botEvents, telemetry),
          );
          return;
        }
        await handleWorkerEvent(job.data, jobRegistry, botEvents, telemetry);
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
    });
    consumers.push(sharedWorkerEventConsumer);
  }

  if (shouldConsumeAgentMailbox) {
    consumers.push(
      queueRuntime.observeWorkerMailbox(config.workerId, {
        onJobAvailable: async () => {
          await workerEventLane!.pauseShared().catch((err) => {
            logger.warn(
              { err, workerId: config.workerId },
              'Failed to pause shared worker events from mailbox observer',
            );
          });
        },
      }),
    );
    await workerEventLane!.pauseSharedIfMailboxPendingOnStartup().catch((err) => {
      logger.warn(
        { err, workerId: config.workerId },
        'Failed to load initial worker mailbox job counts',
      );
    });
  }

  if (options.captureRuntimeStarted !== false) {
    telemetry.capture({ name: 'sniptail_runtime_started' });
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
      if (ownsTelemetry) {
        await telemetry.shutdown();
      }
    },
  };
}
