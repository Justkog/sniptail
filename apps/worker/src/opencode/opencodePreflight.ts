import { assertOpenCodeServerReachable } from '@sniptail/core/opencode/health.js';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import { execFileAsync, stringifyError, type ExecFileLike } from '../preflight/common.js';

export async function assertOpenCodePreflight(
  config: WorkerConfig,
  runExec: ExecFileLike = execFileAsync,
): Promise<void> {
  if (config.opencode.executionMode === 'docker') return;

  if (config.opencode.executionMode === 'server') {
    if (!config.opencode.serverUrl) {
      throw new Error('[opencode].server_url is required when [opencode].execution_mode="server".');
    }
    try {
      const authHeaderEnv = config.opencode.serverAuthHeaderEnv;
      const authHeader = authHeaderEnv ? process.env[authHeaderEnv]?.trim() : undefined;
      await assertOpenCodeServerReachable(
        config.opencode.serverUrl,
        authHeader ? { Authorization: authHeader } : {},
      );
      return;
    } catch (err) {
      throw new Error(
        [
          'OpenCode preflight failed: [opencode].execution_mode="server" requires a reachable OpenCode server.',
          `Server URL: ${config.opencode.serverUrl}`,
          `OpenCode error: ${stringifyError(err)}`,
        ].join('\n'),
      );
    }
  }

  try {
    await runExec('opencode', ['--version']);
  } catch (err) {
    throw new Error(
      [
        'OpenCode preflight failed: [opencode].execution_mode="local" requires the `opencode` CLI in PATH, but `opencode --version` failed for this worker user.',
        'Install OpenCode with `npm install -g opencode-ai` or switch [opencode].execution_mode to "server" or "docker".',
        `OpenCode error: ${stringifyError(err)}`,
      ].join('\n'),
    );
  }
}
