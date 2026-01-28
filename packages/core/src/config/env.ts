import { readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { logger } from '../logger.js';
import type { RepoConfig } from '../types/job.js';
import type { AgentId } from '../types/job.js';
import type { GitHubConfig } from '../github/client.js';
import type { GitLabConfig } from '../gitlab/client.js';

export type CoreConfig = {
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
  copilot: {
    executionMode: 'local' | 'docker';
  };
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
  gitlab?: GitLabConfig;
  github?: GitHubConfig;
};

export type WorkerConfig = CoreConfig & {
  botName: string;
  redisUrl: string;
  openAiKey?: string;
  primaryAgent: AgentId;
  copilot: {
    executionMode: 'local' | 'docker';
    idleRetries: number;
    dockerfilePath?: string;
    dockerImage?: string;
    dockerBuildContext?: string;
  };
  gitlab?: GitLabConfig;
  github?: GitHubConfig;
  repoCacheRoot: string;
  jobRootCopyGlob?: string;
  includeRawRequestInMr: boolean;
  codex: {
    executionMode: 'local' | 'docker';
    dockerfilePath?: string;
    dockerImage?: string;
    dockerBuildContext?: string;
  };
};

let coreConfigCache: CoreConfig | null = null;
let botConfigCache: BotConfig | null = null;
let workerConfigCache: WorkerConfig | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function parseCommaList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveOptionalFlag(name: string, defaultValue = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) return defaultValue;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  throw new Error(`Invalid ${name} value: ${raw}. Use true/false.`);
}

function resolveBotName(): string {
  const rawBotName = process.env.BOT_NAME?.trim();
  return rawBotName ? rawBotName : 'Sniptail';
}

function resolveJobRegistryDriver(): 'sqlite' | 'pg' {
  const raw = (process.env.JOB_REGISTRY_DB || 'sqlite').trim().toLowerCase();
  if (raw !== 'sqlite' && raw !== 'pg') {
    throw new Error(`Invalid JOB_REGISTRY_DB: ${process.env.JOB_REGISTRY_DB}`);
  }
  return raw;
}

function resolveJobRegistryPgUrl(driver: 'sqlite' | 'pg'): string | undefined {
  if (driver !== 'pg') return undefined;
  return requireEnv('JOB_REGISTRY_PG_URL');
}

function resolvePrimaryAgent(): AgentId {
  const raw = (process.env.PRIMARY_AGENT || 'codex').trim().toLowerCase();
  if (raw !== 'codex' && raw !== 'copilot') {
    throw new Error(`Invalid PRIMARY_AGENT: ${process.env.PRIMARY_AGENT}`);
  }
  return raw;
}

function resolveCopilotExecutionMode(): 'local' | 'docker' {
  const raw = (process.env.GH_COPILOT_EXECUTION_MODE || 'local').trim().toLowerCase();
  if (raw !== 'local' && raw !== 'docker') {
    throw new Error(`Invalid GH_COPILOT_EXECUTION_MODE: ${process.env.GH_COPILOT_EXECUTION_MODE}`);
  }
  return raw;
}

function resolveCopilotIdleRetries(): number {
  const raw = process.env.COPILOT_IDLE_RETRIES;
  if (raw === undefined || raw.trim() === '') return 2;
  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`Invalid COPILOT_IDLE_RETRIES: ${raw}`);
  }
  const value = Number.parseInt(normalized, 10);
  if (Number.isNaN(value)) {
    throw new Error(`Invalid COPILOT_IDLE_RETRIES: ${raw}`);
  }
  return value;
}

export function parseRepoAllowlist(filePath: string): Record<string, RepoConfig> {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, RepoConfig>;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Repo allowlist must be a JSON object.');
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') {
        throw new Error(`Repo allowlist entry invalid for ${key}.`);
      }
      if (value.sshUrl !== undefined && typeof value.sshUrl !== 'string') {
        throw new Error(`Repo allowlist entry sshUrl invalid for ${key}.`);
      }
      if (value.localPath !== undefined && typeof value.localPath !== 'string') {
        throw new Error(`Repo allowlist entry localPath invalid for ${key}.`);
      }
      if (!value.sshUrl && !value.localPath) {
        throw new Error(`Repo allowlist entry missing sshUrl or localPath for ${key}.`);
      }
      if (value.baseBranch !== undefined && typeof value.baseBranch !== 'string') {
        throw new Error(`Repo allowlist entry baseBranch invalid for ${key}.`);
      }
    }
    return parsed;
  } catch (err) {
    logger.error({ err, filePath }, 'Failed to parse REPO_ALLOWLIST_PATH');
    throw err;
  }
}

export async function writeRepoAllowlist(
  filePath: string,
  allowlist: Record<string, RepoConfig>,
): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(allowlist, null, 2)}\n`, 'utf8');
}

export function resolveGitHubConfig(): GitHubConfig | undefined {
  const token = process.env.GITHUB_API_TOKEN?.trim();
  if (!token) return undefined;
  return {
    apiBaseUrl: process.env.GITHUB_API_BASE_URL?.trim() || 'https://api.github.com',
    token,
  };
}

export function resolveGitLabConfig(): GitLabConfig | undefined {
  const gitlabBaseUrl = process.env.GITLAB_BASE_URL?.trim();
  const gitlabToken = process.env.GITLAB_TOKEN?.trim();
  if (gitlabBaseUrl || gitlabToken) {
    if (!gitlabBaseUrl) {
      throw new Error('GITLAB_BASE_URL is required when GITLAB_TOKEN is set.');
    }
    if (!gitlabToken) {
      throw new Error('GITLAB_TOKEN is required when GITLAB_BASE_URL is set.');
    }
    return {
      baseUrl: gitlabBaseUrl,
      token: gitlabToken,
    };
  }
  return undefined;
}

export function resetConfigCaches() {
  coreConfigCache = null;
  botConfigCache = null;
  workerConfigCache = null;
}

export function loadCoreConfig(): CoreConfig {
  if (coreConfigCache) return coreConfigCache;
  const repoAllowlist = parseRepoAllowlist(requireEnv('REPO_ALLOWLIST_PATH'));
  const jobRegistryDriver = resolveJobRegistryDriver();
  const jobRegistryPgUrl = resolveJobRegistryPgUrl(jobRegistryDriver);

  coreConfigCache = {
    repoAllowlist,
    jobWorkRoot: requireEnv('JOB_WORK_ROOT'),
    jobRegistryPath: requireEnv('JOB_REGISTRY_PATH'),
    jobRegistryDriver,
    ...(jobRegistryPgUrl ? { jobRegistryPgUrl } : {}),
  };
  return coreConfigCache;
}

export function loadBotConfig(): BotConfig {
  if (botConfigCache) return botConfigCache;
  const core = loadCoreConfig();
  const botName = resolveBotName();
  const primaryAgent = resolvePrimaryAgent();
  const copilotExecutionMode = resolveCopilotExecutionMode();
  const debugJobSpecMessages = resolveOptionalFlag('DEBUG_JOB_SPEC_MESSAGES', false);
  const gitlab = resolveGitLabConfig();
  const github = resolveGitHubConfig();
  const slackEnabled = resolveOptionalFlag('SLACK_ENABLED', false);
  const discordEnabled = resolveOptionalFlag('DISCORD_ENABLED', false);
  const discordGuildId = process.env.DISCORD_GUILD_ID?.trim();
  const discordChannelIds = parseCommaList(process.env.DISCORD_CHANNEL_IDS);
  const discordBotToken = process.env.DISCORD_BOT_TOKEN?.trim();
  const discordAppId = process.env.DISCORD_APP_ID?.trim();

  botConfigCache = {
    ...core,
    botName,
    primaryAgent,
    copilot: {
      executionMode: copilotExecutionMode,
    },
    debugJobSpecMessages,
    slackEnabled,
    discordEnabled,
    ...(slackEnabled && {
      slack: {
        botToken: requireEnv('SLACK_BOT_TOKEN'),
        appToken: requireEnv('SLACK_APP_TOKEN'),
        signingSecret: requireEnv('SLACK_SIGNING_SECRET'),
      },
    }),
    ...(discordEnabled && {
      discord: {
        botToken: discordBotToken || requireEnv('DISCORD_BOT_TOKEN'),
        appId: discordAppId || requireEnv('DISCORD_APP_ID'),
        ...(discordGuildId ? { guildId: discordGuildId } : {}),
        ...(discordChannelIds.length ? { channelIds: discordChannelIds } : {}),
      },
    }),
    adminUserIds: parseCommaList(process.env.ADMIN_USER_IDS),
    redisUrl: requireEnv('REDIS_URL'),
    ...(gitlab && { gitlab }),
    ...(github && { github }),
  };
  return botConfigCache;
}

export function loadWorkerConfig(): WorkerConfig {
  if (workerConfigCache) return workerConfigCache;
  const core = loadCoreConfig();
  const botName = resolveBotName();
  const primaryAgent = resolvePrimaryAgent();
  const copilotExecutionMode = resolveCopilotExecutionMode();
  const copilotIdleRetries = resolveCopilotIdleRetries();
  const copilotDockerfilePath = process.env.GH_COPILOT_DOCKERFILE_PATH?.trim();
  const copilotDockerImage = process.env.GH_COPILOT_DOCKER_IMAGE?.trim();
  const copilotDockerBuildContext = process.env.GH_COPILOT_DOCKER_BUILD_CONTEXT?.trim();

  const executionMode = (process.env.CODEX_EXECUTION_MODE || 'local').toLowerCase();
  if (executionMode !== 'local' && executionMode !== 'docker') {
    throw new Error(`Invalid CODEX_EXECUTION_MODE: ${process.env.CODEX_EXECUTION_MODE}`);
  }
  const dockerfilePath = process.env.CODEX_DOCKERFILE_PATH?.trim();
  const dockerImage = process.env.CODEX_DOCKER_IMAGE?.trim();
  const dockerBuildContext = process.env.CODEX_DOCKER_BUILD_CONTEXT?.trim();

  const jobRootCopyGlob = process.env.JOB_ROOT_COPY_GLOB?.trim();
  const includeRawRequestInMr = resolveOptionalFlag('INCLUDE_RAW_REQUEST_IN_MR', false);
  const openAiKey = process.env.OPENAI_API_KEY;
  if (!openAiKey && primaryAgent === 'codex') {
    logger.warn('OPENAI_API_KEY is not set. Codex jobs will likely fail.');
  }
  const gitlab = resolveGitLabConfig();
  const github = resolveGitHubConfig();

  workerConfigCache = {
    ...core,
    botName,
    redisUrl: requireEnv('REDIS_URL'),
    primaryAgent,
    copilot: {
      executionMode: copilotExecutionMode,
      idleRetries: copilotIdleRetries,
      ...(copilotDockerfilePath && { dockerfilePath: copilotDockerfilePath }),
      ...(copilotDockerImage && { dockerImage: copilotDockerImage }),
      ...(copilotDockerBuildContext && { dockerBuildContext: copilotDockerBuildContext }),
    },
    ...(openAiKey && { openAiKey }),
    ...(gitlab && { gitlab }),
    ...(github && { github }),
    repoCacheRoot: requireEnv('REPO_CACHE_ROOT'),
    ...(jobRootCopyGlob && { jobRootCopyGlob }),
    includeRawRequestInMr,
    codex: {
      executionMode: executionMode,
      ...(dockerfilePath && { dockerfilePath }),
      ...(dockerImage && { dockerImage }),
      ...(dockerBuildContext && { dockerBuildContext }),
    },
  };
  return workerConfigCache;
}
