import 'dotenv/config';
import { logger } from '@sniptail/core/logger.js';
import { startBotRuntime } from './botRuntimeLauncher.js';

const isDryRun = process.env.SNIPTAIL_DRY_RUN === '1';
const SHUTDOWN_TIMEOUT_MS = 5_000;

void (async () => {
  if (isDryRun) {
    try {
      const { runSmokeTest } = await import('./smoke.js');
      await runSmokeTest();
    } catch (err) {
      logger.error({ err }, 'Smoke test failed');
      process.exitCode = 1;
    }
    return;
  }

  const { loadBotConfig } = await import('@sniptail/core/config/config.js');
  loadBotConfig();

  const runtime = await startBotRuntime();
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = () => {
    shutdownPromise ??= runtime.close();
    return shutdownPromise;
  };

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      const forceExitTimer = setTimeout(() => {
        logger.warn({ signal }, 'Forcing bot runtime exit after shutdown timeout');
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
          logger.error({ err, signal }, 'Bot runtime shutdown failed');
          process.exit(1);
        });
    });
  }
})().catch((err) => {
  logger.error({ err }, 'Failed to start bot runtime');
  process.exitCode = 1;
});
