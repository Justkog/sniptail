import type { WorkerConfig } from '@sniptail/core/config/types.js';
import { getDockerModeAgents } from '@sniptail/core/agents/agentRegistry.js';
import { execFileAsync, stringifyError, type ExecFileLike } from '../preflight/common.js';

export async function assertDockerPreflight(
  config: WorkerConfig,
  runExec: ExecFileLike = execFileAsync,
): Promise<void> {
  const agents = getDockerModeAgents(config);
  if (!agents.length) return;

  try {
    await runExec('docker', ['ps']);
  } catch (err) {
    const modeHints = agents.map((agent) => `[${agent}].execution_mode="docker"`).join(', ');
    const guidance = [
      `Docker preflight failed: ${modeHints} requires Docker daemon access, but \`docker ps\` failed for this worker user.`,
      'Fix options:',
      '1. Ensure Docker daemon is running and this user can access it (usually by adding the user to the docker group and restarting the session/service).',
      '2. Verify with: docker ps',
      '3. If Docker is not intended, switch the configured agent execution_mode to "local".',
      `Docker error: ${stringifyError(err)}`,
    ].join('\n');
    throw new Error(guidance);
  }
}
