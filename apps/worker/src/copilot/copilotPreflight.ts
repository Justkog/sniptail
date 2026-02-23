import type { WorkerConfig } from '@sniptail/core/config/types.js';
import { execFileAsync, stringifyError, type ExecFileLike } from '../preflight/common.js';

export async function assertLocalCopilotPreflight(
  config: WorkerConfig,
  runExec: ExecFileLike = execFileAsync,
): Promise<void> {
  if (config.copilot.executionMode !== 'local') return;

  try {
    await runExec('copilot', ['--version']);
  } catch (err) {
    const guidance = [
      'Copilot preflight failed: [copilot].execution_mode="local" requires the `copilot` CLI in PATH, but `copilot --version` failed for this worker user.',
      'Fix options:',
      '1. Install Copilot CLI for this machine/user (for example: npm install -g @github/copilot).',
      '2. Ensure the `copilot` executable is on PATH for the worker process (service managers may use a reduced PATH).',
      '3. Verify with: copilot --version',
      `Copilot error: ${stringifyError(err)}`,
    ].join('\n');
    throw new Error(guidance);
  }
}
