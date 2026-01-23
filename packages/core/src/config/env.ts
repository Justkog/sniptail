import { readFileSync } from 'node:fs';
import { logger } from '../logger.js';
import type { RepoConfig } from '../types/job.js';
import type { GitHubConfig } from '../github/client.js';
import type { GitLabConfig } from '../gitlab/client.js';

export type CoreConfig = {
  repoAllowlist: Record<string, RepoConfig>;
  jobWorkRoot: string;
  jobRegistryPath: string;
};

export type BotConfig = CoreConfig & {
  botName: string;
  slack: {
    botToken: string;
    appToken: string;
    signingSecret: string;
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
  gitlab?: GitLabConfig;
  github?: GitHubConfig;
  repoCacheRoot: string;
  jobRootCopyGlob?: string;
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

function resolveBotName(): string {
  const rawBotName = process.env.BOT_NAME?.trim();
  return rawBotName ? rawBotName : 'Sniptail';
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

export function resolveGitHubConfig(): GitHubConfig | undefined {
  const token = process.env.GITHUB_TOKEN?.trim();
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

  coreConfigCache = {
    repoAllowlist,
    jobWorkRoot: requireEnv('JOB_WORK_ROOT'),
    jobRegistryPath: requireEnv('JOB_REGISTRY_PATH'),
  };
  return coreConfigCache;
}

export function loadBotConfig(): BotConfig {
  if (botConfigCache) return botConfigCache;
  const core = loadCoreConfig();
  const botName = resolveBotName();
  const gitlab = resolveGitLabConfig();
  const github = resolveGitHubConfig();

  botConfigCache = {
    ...core,
    botName,
    slack: {
      botToken: requireEnv('SLACK_BOT_TOKEN'),
      appToken: requireEnv('SLACK_APP_TOKEN'),
      signingSecret: requireEnv('SLACK_SIGNING_SECRET'),
    },
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

  const executionMode = (process.env.CODEX_EXECUTION_MODE || 'local').toLowerCase();
  if (executionMode !== 'local' && executionMode !== 'docker') {
    throw new Error(`Invalid CODEX_EXECUTION_MODE: ${process.env.CODEX_EXECUTION_MODE}`);
  }
  const dockerfilePath = process.env.CODEX_DOCKERFILE_PATH?.trim();
  const dockerImage = process.env.CODEX_DOCKER_IMAGE?.trim();
  const dockerBuildContext = process.env.CODEX_DOCKER_BUILD_CONTEXT?.trim();

  const jobRootCopyGlob = process.env.JOB_ROOT_COPY_GLOB?.trim();
  const openAiKey = process.env.OPENAI_API_KEY;
  if (!openAiKey) {
    logger.warn('OPENAI_API_KEY is not set. Codex jobs will likely fail.');
  }
  const gitlab = resolveGitLabConfig();
  const github = resolveGitHubConfig();

  workerConfigCache = {
    ...core,
    botName,
    redisUrl: requireEnv('REDIS_URL'),
    ...(openAiKey && { openAiKey }),
    ...(gitlab && { gitlab }),
    ...(github && { github }),
    repoCacheRoot: requireEnv('REPO_CACHE_ROOT'),
    ...(jobRootCopyGlob && { jobRootCopyGlob }),
    codex: {
      executionMode: executionMode,
      ...(dockerfilePath && { dockerfilePath }),
      ...(dockerImage && { dockerImage }),
      ...(dockerBuildContext && { dockerBuildContext }),
    },
  };
  return workerConfigCache;
}
