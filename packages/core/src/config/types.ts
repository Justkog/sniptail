import type { RepoConfig, AgentId, JobType } from '../types/job.js';
import type { GitHubConfig } from '../github/client.js';
import type { GitLabConfig } from '../gitlab/client.js';
import type { ChannelProvider } from '../types/channel.js';
import type { ModelReasoningEffort } from '@openai/codex-sdk';
import type { PermissionsConfig } from '../permissions/permissionsPolicyTypes.js';

export type JobModelConfig = {
  model: string;
  modelReasoningEffort?: ModelReasoningEffort;
};

export type BotRunActionReference = {
  label: string;
  description?: string;
};

export type WorkerRunActionGitMode = 'execution-only' | 'implement';

export type WorkerRunActionConfig = {
  fallbackCommand?: string[];
  timeoutMs: number;
  allowFailure: boolean;
  gitMode: WorkerRunActionGitMode;
  checks?: string[];
};

export type QueueDriver = 'redis' | 'inproc';
export type JobRegistryDriver = 'sqlite' | 'pg' | 'redis';

export type CoreConfig = {
  repoAllowlistPath?: string;
  repoAllowlist: Record<string, RepoConfig>;
  jobWorkRoot: string;
  queueDriver: QueueDriver;
  jobRegistryPath?: string;
  jobRegistryDriver: JobRegistryDriver;
  jobRegistryPgUrl?: string;
  jobRegistryRedisUrl?: string;
};

export type BotConfig = CoreConfig & {
  botName: string;
  debugJobSpecMessages: boolean;
  primaryAgent: AgentId;
  bootstrapServices: string[];
  enabledChannels: ChannelProvider[];
  channels: Record<ChannelProvider, { enabled: boolean }>;
  slackEnabled: boolean;
  discordEnabled: boolean;
  slack?: {
    botToken: string;
    appToken: string;
    signingSecret: string;
  };
  discord?: {
    botToken: string;
    appId: string;
    guildId?: string;
    channelIds?: string[];
  };
  permissions: PermissionsConfig;
  run?: {
    actions: Record<string, BotRunActionReference>;
  };
  redisUrl?: string;
};

export type WorkerConfig = CoreConfig & {
  botName: string;
  redisUrl?: string;
  openAiKey?: string;
  primaryAgent: AgentId;
  jobConcurrency: number;
  bootstrapConcurrency: number;
  workerEventConcurrency: number;
  localRepoRoot?: string;
  copilot: {
    executionMode: 'local' | 'docker';
    idleRetries: number;
    dockerfilePath?: string;
    dockerImage?: string;
    dockerBuildContext?: string;
    models?: Partial<Record<JobType, JobModelConfig>>;
  };
  gitlab?: GitLabConfig;
  github?: GitHubConfig;
  repoCacheRoot: string;
  worktreeSetupCommand?: string;
  worktreeSetupAllowFailure?: boolean;
  jobRootCopyGlob?: string;
  cleanupMaxAge?: string;
  cleanupMaxEntries?: number;
  includeRawRequestInMr: boolean;
  run?: {
    actions: Record<string, WorkerRunActionConfig>;
  };
  codex: {
    executionMode: 'local' | 'docker';
    dockerfilePath?: string;
    dockerImage?: string;
    dockerBuildContext?: string;
    models?: Partial<Record<JobType, JobModelConfig>>;
  };
};

export const BOT_CONFIG_PATH_ENV = 'SNIPTAIL_BOT_CONFIG_PATH';
export const WORKER_CONFIG_PATH_ENV = 'SNIPTAIL_WORKER_CONFIG_PATH';
export const DEFAULT_BOT_CONFIG_PATH = '../../sniptail.bot.toml';
export const DEFAULT_WORKER_CONFIG_PATH = '../../sniptail.worker.toml';
