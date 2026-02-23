import type { WorkerConfig } from '@sniptail/core/config/types.js';
import { execFileAsync, stringifyError, type ExecFileLike } from '../preflight/common.js';

export async function assertLocalCodexPreflight(
  config: WorkerConfig,
  runExec: ExecFileLike = execFileAsync,
): Promise<void> {
  if (config.codex.executionMode !== 'local') return;

  try {
    await runExec('codex', ['--version']);
  } catch (err) {
    const guidance = [
      'Codex preflight failed: [codex].execution_mode="local" requires the `codex` CLI in PATH, but `codex --version` failed for this worker user.',
      'Fix options:',
      '1. Install Codex CLI for this machine/user (for example: npm install -g @openai/codex).',
      '2. Ensure the `codex` executable is on PATH for the worker process (service managers may use a reduced PATH).',
      '3. Verify with: codex --version',
      `Codex error: ${stringifyError(err)}`,
    ].join('\n');
    throw new Error(guidance);
  }
}
