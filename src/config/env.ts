import { readFileSync } from 'node:fs';
import { logger } from '../logger.js';
import type { RepoConfig } from '../types/job.js';

export type AppConfig = {
  botName: string;
  slack: {
    botToken: string;
    appToken: string;
    signingSecret: string;
  };
  adminUserIds: string[];
  redisUrl: string;
  openAiKey?: string;
  gitlab: {
    baseUrl: string;
    token: string;
  };
  repoCacheRoot: string;
  jobWorkRoot: string;
  jobRegistryPath: string;
  jobRootCopyGlob?: string;
  repoAllowlist: Record<string, RepoConfig>;
  codex: {
    executionMode: 'local' | 'docker';
    dockerfilePath?: string;
    dockerImage?: string;
    dockerBuildContext?: string;
  };
};

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

function parseRepoAllowlist(filePath: string): Record<string, RepoConfig> {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as Record<string, RepoConfig>;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Repo allowlist must be a JSON object.');
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (!value?.sshUrl || !value?.projectId) {
        throw new Error(`Repo allowlist entry invalid for ${key}.`);
      }
    }
    return parsed;
  } catch (err) {
    logger.error({ err, filePath }, 'Failed to parse REPO_ALLOWLIST_PATH');
    throw err;
  }
}

export function loadConfig(): AppConfig {
  const repoAllowlist = parseRepoAllowlist(requireEnv('REPO_ALLOWLIST_PATH'));
  const openAiKey = process.env.OPENAI_API_KEY;
  if (!openAiKey) {
    logger.warn('OPENAI_API_KEY is not set. Codex jobs will likely fail.');
  }

  const rawBotName = process.env.BOT_NAME?.trim();
  const botName = rawBotName ? rawBotName : 'Sniptail';

  const executionMode = (process.env.CODEX_EXECUTION_MODE || 'local').toLowerCase();
  if (executionMode !== 'local' && executionMode !== 'docker') {
    throw new Error(`Invalid CODEX_EXECUTION_MODE: ${process.env.CODEX_EXECUTION_MODE}`);
  }
  const dockerfilePath = process.env.CODEX_DOCKERFILE_PATH?.trim();
  const dockerImage = process.env.CODEX_DOCKER_IMAGE?.trim();
  const dockerBuildContext = process.env.CODEX_DOCKER_BUILD_CONTEXT?.trim();

  const jobRootCopyGlob = process.env.JOB_ROOT_COPY_GLOB?.trim();

  return {
    botName,
    slack: {
      botToken: requireEnv('SLACK_BOT_TOKEN'),
      appToken: requireEnv('SLACK_APP_TOKEN'),
      signingSecret: requireEnv('SLACK_SIGNING_SECRET'),
    },
    adminUserIds: parseCommaList(process.env.ADMIN_USER_IDS),
    redisUrl: requireEnv('REDIS_URL'),
    ...openAiKey && { openAiKey },
    gitlab: {
      baseUrl: requireEnv('GITLAB_BASE_URL'),
      token: requireEnv('GITLAB_TOKEN'),
    },
    repoCacheRoot: requireEnv('REPO_CACHE_ROOT'),
    jobWorkRoot: requireEnv('JOB_WORK_ROOT'),
    jobRegistryPath: requireEnv('JOB_REGISTRY_PATH'),
    ...jobRootCopyGlob && { jobRootCopyGlob },
    repoAllowlist,
    codex: {
      executionMode: executionMode,
      ...dockerfilePath && { dockerfilePath },
      ...dockerImage && { dockerImage },
      ...dockerBuildContext && { dockerBuildContext },
    },
  };
}
