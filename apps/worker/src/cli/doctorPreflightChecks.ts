import { getDockerModeAgents } from '@sniptail/core/agents/agentRegistry.js';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import { assertDockerPreflight } from '../docker/dockerPreflight.js';
import { assertGitCommitIdentityPreflight } from '../git/gitPreflight.js';
import { assertLocalAgentPreflight } from '../preflight/agentPreflight.js';
import { stringifyError } from '../preflight/common.js';

export type WorkerDoctorPreflightStatus = 'ok' | 'fail';

export type WorkerDoctorPreflightCheck = {
  status: WorkerDoctorPreflightStatus;
  area: string;
  message: string;
  fix?: string;
};

export type WorkerDoctorPreflightReport = {
  checks: WorkerDoctorPreflightCheck[];
};

type WorkerDoctorPreflightDeps = {
  getDockerModeAgents: typeof getDockerModeAgents;
  assertDockerPreflight: typeof assertDockerPreflight;
  assertLocalAgentPreflight: typeof assertLocalAgentPreflight;
  assertGitCommitIdentityPreflight: typeof assertGitCommitIdentityPreflight;
};

const defaultDeps: WorkerDoctorPreflightDeps = {
  getDockerModeAgents,
  assertDockerPreflight,
  assertLocalAgentPreflight,
  assertGitCommitIdentityPreflight,
};

function getAgentArea(config: WorkerConfig): string {
  return config.primaryAgent === 'opencode' && config.opencode.executionMode === 'server'
    ? 'opencode server'
    : 'agent';
}

function getErrorMessage(error: unknown): string {
  return stringifyError(error);
}

async function collectCheck(
  area: string,
  okMessage: string,
  run: () => Promise<void>,
): Promise<WorkerDoctorPreflightCheck> {
  try {
    await run();
    return {
      status: 'ok',
      area,
      message: okMessage,
    };
  } catch (error) {
    return {
      status: 'fail',
      area,
      message: getErrorMessage(error),
    };
  }
}

export async function runWorkerDoctorPreflightChecks(
  config: WorkerConfig,
  deps: WorkerDoctorPreflightDeps = defaultDeps,
): Promise<WorkerDoctorPreflightReport> {
  const checks: WorkerDoctorPreflightCheck[] = [];
  const dockerAgents = deps.getDockerModeAgents(config);
  checks.push(
    await collectCheck(
      'docker',
      dockerAgents.length
        ? 'Docker daemon is accessible for configured Docker execution modes.'
        : 'Docker is not required by configured agent execution modes.',
      () => deps.assertDockerPreflight(config),
    ),
  );

  checks.push(
    await collectCheck(
      getAgentArea(config),
      `Primary agent preflight passed for ${config.primaryAgent}.`,
      () => deps.assertLocalAgentPreflight(config, config.primaryAgent),
    ),
  );

  checks.push(
    await collectCheck('git identity', 'Git commit identity is configured.', () =>
      deps.assertGitCommitIdentityPreflight(),
    ),
  );

  return { checks };
}
