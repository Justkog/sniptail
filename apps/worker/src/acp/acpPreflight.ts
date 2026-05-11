import type { WorkerConfig } from '@sniptail/core/config/types.js';
import { launchAcpRuntime } from '@sniptail/core/acp/acpRuntime.js';
import { stringifyError } from '../preflight/common.js';

export async function assertAcpPreflight(config: WorkerConfig): Promise<void> {
  if (!config.acp) {
    throw new Error(
      'ACP preflight failed: primary_agent="acp" requires an [acp] worker config with an ACP launch command or preset.',
    );
  }

  let runtime: Awaited<ReturnType<typeof launchAcpRuntime>> | undefined;

  try {
    runtime = await launchAcpRuntime({
      launch: config.acp,
      cwd: config.repoCacheRoot,
      diagnostics: {
        configSource: '[acp]',
      },
    });
  } catch (err) {
    throw new Error(
      [
        'ACP preflight failed: local stdio ACP launch did not reach initialize.',
        stringifyError(err),
      ].join('\n'),
    );
  } finally {
    await runtime?.close().catch(() => undefined);
  }
}
