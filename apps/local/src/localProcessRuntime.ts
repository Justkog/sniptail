import 'dotenv/config';
import { loadBotConfig, loadWorkerConfig } from '@sniptail/core/config/config.js';
import { logger } from '@sniptail/core/logger.js';
import { createQueueTransportRuntime } from '@sniptail/core/queue/queueTransportFactory.js';
import { startBotRuntime } from '@sniptail/bot/runtime';
import { startWorkerRuntime } from '@sniptail/worker/runtime';

const SHUTDOWN_TIMEOUT_MS = 5_000;

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
  let shutdownPromise: Promise<void> | undefined;

  const shutdown = (signal: NodeJS.Signals) => {
    shutdownPromise ??= (async () => {
      logger.info({ signal }, 'Shutting down local unified runtime');
      if (botRuntime) {
        logger.info('Closing local bot runtime');
        await botRuntime.close();
      }
      if (workerRuntime) {
        logger.info('Closing local worker runtime');
        await workerRuntime.close();
      }
      logger.info('Closing local queue runtime');
      await queueRuntime.close();
      logger.info('Closed local unified runtime');
    })();
    return shutdownPromise;
  };

  const installSignalHandler = (signal: NodeJS.Signals) => {
    process.once(signal, () => {
      const forceExitTimer = setTimeout(() => {
        logger.warn(
          { signal, timeoutMs: SHUTDOWN_TIMEOUT_MS },
          'Forcing local unified runtime exit after shutdown timeout',
        );
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);
      forceExitTimer.unref?.();

      void shutdown(signal)
        .then(() => {
          clearTimeout(forceExitTimer);
          process.exit(0);
        })
        .catch((err) => {
          clearTimeout(forceExitTimer);
          logger.error({ err, signal }, 'Local unified runtime shutdown failed');
          process.exit(1);
        });
    });
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

  installSignalHandler('SIGINT');
  installSignalHandler('SIGTERM');
}

void main().catch((err) => {
  logger.error({ err }, 'Failed to start local unified runtime');
  process.exitCode = 1;
});
