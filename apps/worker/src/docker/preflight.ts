import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { WorkerConfig } from '@sniptail/core/config/types.js';

type ExecFileLike = (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>;

const execFileAsync = promisify(execFile);

function dockerModeAgents(config: WorkerConfig): string[] {
  const agents: string[] = [];
  if (config.codex.executionMode === 'docker') agents.push('codex');
  if (config.copilot.executionMode === 'docker') agents.push('copilot');
  return agents;
}

function stringifyError(err: unknown): string {
  if (err && typeof err === 'object') {
    const withStderr = err as { stderr?: unknown; message?: unknown };
    if (typeof withStderr.stderr === 'string' && withStderr.stderr.trim()) {
      return withStderr.stderr.trim();
    }
    if (typeof withStderr.message === 'string' && withStderr.message.trim()) {
      return withStderr.message.trim();
    }
  }
  return String(err);
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
