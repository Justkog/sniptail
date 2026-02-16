import { resolve } from 'node:path';
import type { AgentDescriptorRegistry } from './types.js';
import type { WorkerConfig } from '../config/types.js';
import { runCodex } from '../codex/codex.js';
import { formatCodexEvent, summarizeCodexEvent } from '../codex/logging.js';
import { runCopilot } from '../copilot/copilot.js';
import { formatCopilotEvent, summarizeCopilotEvent } from '../copilot/logging.js';
import type { AgentId, JobType } from '../types/job.js';

export const AGENT_DESCRIPTORS: AgentDescriptorRegistry = {
  codex: {
    id: 'codex',
    adapter: {
      run: runCodex,
      formatEvent: formatCodexEvent as (event: unknown) => string,
      summarizeEvent: summarizeCodexEvent as (
        event: unknown,
      ) => { text: string; isError: boolean } | null,
    },
    isDockerMode: (config: WorkerConfig) => config.codex.executionMode === 'docker',
    resolveModelConfig: (config: WorkerConfig, jobType: JobType) => config.codex.models?.[jobType],
    shouldIncludeRepoCache: (_config: WorkerConfig, jobType: JobType) => jobType !== 'MENTION',
    buildRunOptions: (config: WorkerConfig) =>
      config.codex.executionMode === 'docker'
        ? {
            docker: {
              enabled: true,
              ...(config.codex.dockerfilePath && { dockerfilePath: config.codex.dockerfilePath }),
              ...(config.codex.dockerImage && { image: config.codex.dockerImage }),
              ...(config.codex.dockerBuildContext && {
                buildContext: config.codex.dockerBuildContext,
              }),
            },
          }
        : {},
  },
  copilot: {
    id: 'copilot',
    adapter: {
      run: runCopilot,
      formatEvent: formatCopilotEvent as (event: unknown) => string,
      summarizeEvent: summarizeCopilotEvent as (
        event: unknown,
      ) => { text: string; isError: boolean } | null,
    },
    isDockerMode: (config: WorkerConfig) => config.copilot.executionMode === 'docker',
    resolveModelConfig: (config: WorkerConfig, jobType: JobType) =>
      config.copilot.models?.[jobType],
    shouldIncludeRepoCache: (config: WorkerConfig, jobType: JobType) =>
      jobType !== 'MENTION' && config.copilot.executionMode === 'docker',
    buildRunOptions: (config: WorkerConfig) => ({
      copilotIdleRetries: config.copilot.idleRetries,
      ...(config.copilot.executionMode === 'docker'
        ? {
            copilot: {
              cliPath: resolve(process.cwd(), 'scripts', 'copilot-docker.sh'),
              docker: {
                enabled: true,
                ...(config.copilot.dockerfilePath && {
                  dockerfilePath: config.copilot.dockerfilePath,
                }),
                ...(config.copilot.dockerImage && { image: config.copilot.dockerImage }),
                ...(config.copilot.dockerBuildContext && {
                  buildContext: config.copilot.dockerBuildContext,
                }),
              },
            },
          }
        : {}),
    }),
  },
};

export function getDockerModeAgents(config: WorkerConfig): AgentId[] {
  const dockerAgents: AgentId[] = [];
  for (const [agentId, descriptor] of Object.entries(AGENT_DESCRIPTORS) as Array<
    [AgentId, AgentDescriptorRegistry[AgentId]]
  >) {
    if (descriptor.isDockerMode(config)) {
      dockerAgents.push(agentId);
    }
  }
  return dockerAgents;
}
