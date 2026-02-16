import type { JobSpec, AgentId } from '../types/job.js';
import type { ModelReasoningEffort } from '@openai/codex-sdk';
import type { WorkerConfig, JobModelConfig } from '../config/types.js';
import type { JobType } from '../types/job.js';

export type AgentRunResult = {
  finalResponse: string;
  threadId?: string;
};

export type AgentRunOptions = {
  onEvent?: (event: unknown) => void | Promise<void>;
  sandboxMode?: 'read-only' | 'workspace-write';
  approvalPolicy?: 'never' | 'on-request';
  skipGitRepoCheck?: boolean;
  additionalDirectories?: string[];
  networkAccessEnabled?: boolean;
  webSearchEnabled?: boolean;
  botName?: string;
  resumeThreadId?: string;
  model?: string;
  modelReasoningEffort?: ModelReasoningEffort;
  copilotIdleRetries?: number;
  copilot?: {
    cliPath?: string;
    docker?: {
      enabled?: boolean;
      dockerfilePath?: string;
      image?: string;
      buildContext?: string;
    };
  };
  docker?: {
    enabled?: boolean;
    dockerfilePath?: string;
    image?: string;
    buildContext?: string;
  };
};

export type AgentAdapter = {
  run: (
    job: JobSpec,
    workDir: string,
    env: NodeJS.ProcessEnv,
    options?: AgentRunOptions,
  ) => Promise<AgentRunResult>;
  formatEvent?: (event: unknown) => string;
  summarizeEvent?: (event: unknown) => { text: string; isError: boolean } | null;
};

export type AgentRegistry = Record<AgentId, AgentAdapter>;

export type AgentDescriptor = {
  id: AgentId;
  adapter: AgentAdapter;
  isDockerMode: (config: WorkerConfig) => boolean;
  resolveModelConfig: (config: WorkerConfig, jobType: JobType) => JobModelConfig | undefined;
  shouldIncludeRepoCache: (config: WorkerConfig, jobType: JobType) => boolean;
  buildRunOptions: (config: WorkerConfig) => Partial<AgentRunOptions>;
};

export type AgentDescriptorRegistry = Record<AgentId, AgentDescriptor>;
