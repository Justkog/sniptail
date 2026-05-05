import type { JobSpec, AgentId } from '../types/job.js';
import type { ModelReasoningEffort } from '@openai/codex-sdk';
import type { WorkerConfig, JobModelConfig } from '../config/types.js';
import type { JobType } from '../types/job.js';
import type { PermissionHandler, SessionConfig } from '@github/copilot-sdk';

export type AgentRunResult = {
  finalResponse: string;
  threadId?: string;
};

export type AgentAttachment = {
  path: string;
  displayName: string;
  mediaType: string;
};

export type CopilotPermissionHandler = PermissionHandler;
export type CopilotPermissionRequest = Parameters<CopilotPermissionHandler>[0];
export type CopilotPermissionDecision = Awaited<ReturnType<CopilotPermissionHandler>>;
export type CopilotUserInputHandler = NonNullable<SessionConfig['onUserInputRequest']>;
export type CopilotUserInputRequest = Parameters<CopilotUserInputHandler>[0];
export type CopilotUserInputResponse = Awaited<ReturnType<CopilotUserInputHandler>>;

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
  promptOverride?: string;
  currentTurnAttachments?: AgentAttachment[];
  model?: string;
  modelProvider?: string;
  modelReasoningEffort?: ModelReasoningEffort;
  copilotIdleRetries?: number;
  copilotIdleTimeoutMs?: number;
  copilot?: {
    cliPath?: string;
    agent?: string;
    streaming?: boolean;
    onPermissionRequest?: CopilotPermissionHandler;
    onUserInputRequest?: CopilotUserInputHandler;
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
  opencode?: {
    executionMode?: 'local' | 'server' | 'docker';
    serverUrl?: string;
    serverAuthHeaderEnv?: string;
    agent?: string;
    variant?: string;
    startupTimeoutMs?: number;
    dockerStreamLogs?: boolean;
    docker?: {
      enabled?: boolean;
      dockerfilePath?: string;
      image?: string;
      buildContext?: string;
    };
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
