import type { AgentRunOptions } from '@sniptail/core/agents/types.js';
import type { WorkerConfig } from '@sniptail/core/config/types.js';
import {
  createDockerRuntime,
  createLocalRuntime,
  createServerRuntime,
} from '@sniptail/core/opencode/runtime.js';
import type { InteractiveAgentProfile } from '../agent-command/interactiveAgentTypes.js';

type BuildOpenCodeWorkerRunOptionsInput = {
  includePromptDefaults?: boolean;
};

export function buildOpenCodeWorkerRunOptions(
  config: WorkerConfig,
  profile: InteractiveAgentProfile,
  input: BuildOpenCodeWorkerRunOptionsInput = {},
): AgentRunOptions {
  const includePromptDefaults = input.includePromptDefaults ?? false;
  const usesNamedAgent = Boolean(profile.profile);
  const model =
    includePromptDefaults && !usesNamedAgent
      ? (profile.model ?? config.opencode.defaultModel?.model)
      : profile.model;
  const modelProvider =
    includePromptDefaults && !usesNamedAgent
      ? (profile.modelProvider ?? config.opencode.defaultModel?.provider)
      : profile.modelProvider;
  const variant = profile.reasoningEffort;

  return {
    ...(includePromptDefaults ? { botName: config.botName } : {}),
    ...(model && modelProvider ? { model, modelProvider } : {}),
    opencode: {
      executionMode: config.opencode.executionMode,
      ...(config.opencode.serverUrl ? { serverUrl: config.opencode.serverUrl } : {}),
      ...(config.opencode.serverAuthHeaderEnv
        ? { serverAuthHeaderEnv: config.opencode.serverAuthHeaderEnv }
        : {}),
      ...(profile.profile ? { agent: profile.profile } : {}),
      ...(variant ? { variant } : {}),
      startupTimeoutMs: config.opencode.startupTimeoutMs,
      dockerStreamLogs: config.opencode.dockerStreamLogs,
      ...(config.opencode.executionMode === 'docker'
        ? {
            docker: {
              enabled: true,
              ...(config.opencode.dockerfilePath
                ? { dockerfilePath: config.opencode.dockerfilePath }
                : {}),
              ...(config.opencode.dockerImage ? { image: config.opencode.dockerImage } : {}),
              ...(config.opencode.dockerBuildContext
                ? { buildContext: config.opencode.dockerBuildContext }
                : {}),
            },
          }
        : {}),
    },
  };
}

export async function createOpenCodeWorkerRuntime(
  runtimeId: string,
  workDir: string,
  config: WorkerConfig,
  profile: InteractiveAgentProfile,
) {
  const options = buildOpenCodeWorkerRunOptions(config, profile);
  switch (config.opencode.executionMode) {
    case 'server':
      return createServerRuntime(workDir, process.env, options);
    case 'docker':
      return createDockerRuntime(runtimeId, workDir, process.env, options);
    case 'local':
    default:
      return createLocalRuntime(workDir, options);
  }
}
