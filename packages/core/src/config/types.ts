import type { RepoConfig, AgentId, JobType } from '../types/job.js';
import type { GitHubConfig } from '../github/client.js';
import type { GitLabConfig } from '../gitlab/client.js';
import type { ModelReasoningEffort } from '@openai/codex-sdk';

export type JobModelConfig = {
  model: string;
  modelReasoningEffort?: ModelReasoningEffort;
};

export type CoreConfig = {
  repoAllowlistPath?: string;
  repoAllowlist: Record<string, RepoConfig>;
  jobWorkRoot: string;
  jobRegistryPath: string;
  jobRegistryDriver: 'sqlite' | 'pg';
  jobRegistryPgUrl?: string;
};

export type BotConfig = CoreConfig & {
  botName: string;
  debugJobSpecMessages: boolean;
  primaryAgent: AgentId;
  bootstrapServices: Array<'local' | 'github' | 'gitlab'>;
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
  adminUserIds: string[];
  redisUrl: string;
};

export type WorkerConfig = CoreConfig & {
  botName: string;
  redisUrl: string;
  openAiKey?: string;
  primaryAgent: AgentId;
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
  jobRootCopyGlob?: string;
  cleanupMaxAge?: string;
  cleanupMaxEntries?: number;
  includeRawRequestInMr: boolean;
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
