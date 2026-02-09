import type { WorkerConfig } from '@sniptail/core/config/types.js';
import { execFileAsync, stringifyError, type ExecFileLike } from '../preflight/common.js';

function dockerModeAgents(config: WorkerConfig): string[] {
  const agents: string[] = [];
  if (config.codex.executionMode === 'docker') agents.push('codex');
  if (config.copilot.executionMode === 'docker') agents.push('copilot');
  return agents;
}

export async function assertDockerPreflight(
  config: WorkerConfig,
  runExec: ExecFileLike = execFileAsync,
): Promise<void> {
  const agents = dockerModeAgents(config);
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
