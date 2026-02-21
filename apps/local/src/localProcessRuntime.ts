import 'dotenv/config';
import { loadBotConfig, loadWorkerConfig } from '@sniptail/core/config/config.js';
import { logger } from '@sniptail/core/logger.js';
import { createQueueTransportRuntime } from '@sniptail/core/queue/queueTransportFactory.js';
import { startBotRuntime } from '@sniptail/bot/runtime';
import { startWorkerRuntime } from '@sniptail/worker/runtime';

function validateLocalConfig(): void {
  const botConfig = loadBotConfig();
  const workerConfig = loadWorkerConfig();

  if (botConfig.queueDriver !== 'inproc' || workerConfig.queueDriver !== 'inproc') {
    throw new Error(
      [
        'sniptail local requires queue_driver to resolve to "inproc" for both bot and worker.',
        `Resolved: bot=${botConfig.queueDriver}, worker=${workerConfig.queueDriver}`,
      ].join(' '),
    );
  }

  if (botConfig.jobRegistryDriver !== 'sqlite' || workerConfig.jobRegistryDriver !== 'sqlite') {
    throw new Error(
      [
        'sniptail local requires JOB_REGISTRY_DB=sqlite for both bot and worker.',
        `Resolved: bot=${botConfig.jobRegistryDriver}, worker=${workerConfig.jobRegistryDriver}`,
      ].join(' '),
    );
  }

  if (!botConfig.jobRegistryPath || !workerConfig.jobRegistryPath) {
    throw new Error(
      'sniptail local requires JOB_REGISTRY_PATH (or core.job_registry_path) to be set for both bot and worker.',
    );
  }

  if (botConfig.jobRegistryPath !== workerConfig.jobRegistryPath) {
    throw new Error(
      [
        'sniptail local requires bot and worker to share the same sqlite registry path.',
        `bot=${botConfig.jobRegistryPath}`,
        `worker=${workerConfig.jobRegistryPath}`,
      ].join(' '),
    );
  }
}

async function main() {
  validateLocalConfig();

  const queueRuntime = createQueueTransportRuntime({ driver: 'inproc' });
  let workerRuntime: Awaited<ReturnType<typeof startWorkerRuntime>> | undefined;
  let botRuntime: Awaited<ReturnType<typeof startBotRuntime>> | undefined;
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down local unified runtime');
    try {
      if (botRuntime) {
        await botRuntime.close();
      }
      if (workerRuntime) {
        await workerRuntime.close();
      }
      await queueRuntime.close();
    } finally {
      process.exitCode = 0;
    }
  };

  try {
    workerRuntime = await startWorkerRuntime({ queueRuntime });
    botRuntime = await startBotRuntime({ queueRuntime });
  } catch (err) {
    if (botRuntime) {
      await botRuntime.close();
    }
    if (workerRuntime) {
      await workerRuntime.close();
    }
    await queueRuntime.close();
    throw err;
  }

  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

void main().catch((err) => {
  logger.error({ err }, 'Failed to start local unified runtime');
  process.exitCode = 1;
});
