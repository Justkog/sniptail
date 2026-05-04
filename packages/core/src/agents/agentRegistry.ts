import type { AgentDescriptorRegistry } from './types.js';
import type { WorkerConfig } from '../config/types.js';
import { runCodex } from '../codex/codex.js';
import { resolveWorkerAgentScriptPath } from './resolveWorkerAgentScriptPath.js';
import { formatCodexEvent, summarizeCodexEvent } from '../codex/logging.js';
import { runCopilot } from '../copilot/copilot.js';
import { formatCopilotEvent, summarizeCopilotEvent } from '../copilot/logging.js';
import { runOpenCode } from '../opencode/prompt.js';
import { formatOpenCodeEvent, summarizeOpenCodeEvent } from '../opencode/logging.js';
import type { AgentId, JobType } from '../types/job.js';
import type { Event as OpenCodeEvent } from '@opencode-ai/sdk/v2';

function formatOpenCodeUnknownEvent(event: unknown): string {
  return formatOpenCodeEvent(event as OpenCodeEvent);
}

function summarizeOpenCodeUnknownEvent(event: unknown): { text: string; isError: boolean } | null {
  return summarizeOpenCodeEvent(event as OpenCodeEvent);
}

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
    resolveModelConfig: (config: WorkerConfig, jobType: JobType) =>
      config.codex.models?.[jobType] ?? config.codex.defaultModel,
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
      config.copilot.models?.[jobType] ?? config.copilot.defaultModel,
    shouldIncludeRepoCache: (config: WorkerConfig, jobType: JobType) =>
      jobType !== 'MENTION' && config.copilot.executionMode === 'docker',
    buildRunOptions: (config: WorkerConfig) => ({
      copilotIdleRetries: config.copilot.idleRetries,
      copilot:
        config.copilot.executionMode === 'docker'
          ? {
              cliPath: resolveWorkerAgentScriptPath('copilot-docker.sh'),
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
            }
          : {
              // cliPath: 'copilot',
            },
    }),
  },
  opencode: {
    id: 'opencode',
    adapter: {
      run: runOpenCode,
      formatEvent: formatOpenCodeUnknownEvent,
      summarizeEvent: summarizeOpenCodeUnknownEvent,
    },
    isDockerMode: (config: WorkerConfig) => config.opencode.executionMode === 'docker',
    resolveModelConfig: (config: WorkerConfig, jobType: JobType) => {
      const model = config.opencode.models?.[jobType] ?? config.opencode.defaultModel;
      return model ? { model: model.model, modelProvider: model.provider } : undefined;
    },
    shouldIncludeRepoCache: (_config: WorkerConfig, jobType: JobType) => jobType !== 'MENTION',
    buildRunOptions: (config: WorkerConfig) => ({
      opencode: {
        executionMode: config.opencode.executionMode,
        ...(config.opencode.serverUrl && { serverUrl: config.opencode.serverUrl }),
        ...(config.opencode.serverAuthHeaderEnv && {
          serverAuthHeaderEnv: config.opencode.serverAuthHeaderEnv,
        }),
        ...(config.opencode.agent && { agent: config.opencode.agent }),
        startupTimeoutMs: config.opencode.startupTimeoutMs,
        dockerStreamLogs: config.opencode.dockerStreamLogs,
        ...(config.opencode.executionMode === 'docker'
          ? {
              docker: {
                enabled: true,
                ...(config.opencode.dockerfilePath && {
                  dockerfilePath: config.opencode.dockerfilePath,
                }),
                ...(config.opencode.dockerImage && { image: config.opencode.dockerImage }),
                ...(config.opencode.dockerBuildContext && {
                  buildContext: config.opencode.dockerBuildContext,
                }),
              },
            }
          : {}),
      },
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
