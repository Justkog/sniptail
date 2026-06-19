import 'dotenv/config';
import { logger } from '@sniptail/core/logger.js';
import { startWorkerRuntime } from './workerRuntimeLauncher.js';

const SHUTDOWN_TIMEOUT_MS = 5_000;

try {
  const runtime = await startWorkerRuntime();
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = () => {
    shutdownPromise ??= runtime.close();
    return shutdownPromise;
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      const forceExitTimer = setTimeout(() => {
        logger.warn({ signal }, 'Forcing worker runtime exit after shutdown timeout');
        process.exit(1);
      }, SHUTDOWN_TIMEOUT_MS);
      forceExitTimer.unref?.();
      void shutdown()
        .then(() => {
          clearTimeout(forceExitTimer);
          process.exit(0);
        })
        .catch((err) => {
          clearTimeout(forceExitTimer);
          logger.error({ err, signal }, 'Worker runtime shutdown failed');
          process.exit(1);
        });
    });
  }
} catch (err) {
  logger.error({ err }, 'Failed to start worker runtime');
  process.exitCode = 1;
}
