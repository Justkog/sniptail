import { logger } from '../logger.js';
import type { TomlTable } from './toml.js';
import { loadTomlConfig, getTomlTable, getTomlString, getTomlNumber } from './toml.js';
import type { CoreConfig, BotConfig, WorkerConfig, JobModelConfig } from './types.js';
import type { JobType } from '../types/job.js';
import {
  BOT_CONFIG_PATH_ENV,
  WORKER_CONFIG_PATH_ENV,
  DEFAULT_BOT_CONFIG_PATH,
  DEFAULT_WORKER_CONFIG_PATH,
} from './types.js';
import {
  requireEnv,
  resolveBotName,
  resolveJobRegistryDriver,
  resolveJobRegistryPgUrl,
  resolvePrimaryAgent,
  resolveCopilotExecutionMode,
  resolveCopilotIdleRetries,
  resolveCodexExecutionMode,
  resolveOptionalFlagFromSources,
  resolveStringArrayFromSources,
  resolvePathValue,
  resolveStringValue,
} from './resolve.js';
import { parseRepoAllowlist } from './repoAllowlist.js';
import { resolveGitHubConfig, resolveGitLabConfig } from './providers.js';

let coreConfigCache: CoreConfig | null = null;
let botConfigCache: BotConfig | null = null;
let workerConfigCache: WorkerConfig | null = null;

export { parseRepoAllowlist, writeRepoAllowlist } from './repoAllowlist.js';
export { resolveGitHubConfig, resolveGitLabConfig } from './providers.js';
export type { CoreConfig, BotConfig, WorkerConfig } from './types.js';
export {
  BOT_CONFIG_PATH_ENV,
  WORKER_CONFIG_PATH_ENV,
  DEFAULT_BOT_CONFIG_PATH,
  DEFAULT_WORKER_CONFIG_PATH,
} from './types.js';

export function resetConfigCaches() {
  coreConfigCache = null;
  botConfigCache = null;
  workerConfigCache = null;
}

function parseModelMap(modelsToml: TomlTable | undefined, label: string) {
  if (!modelsToml) return undefined;
  const entries = Object.entries(modelsToml);
  if (!entries.length) return undefined;
  const allowed = new Set<JobType>(['ASK', 'IMPLEMENT', 'PLAN', 'REVIEW', 'MENTION']);
  const allowedEfforts = new Set(['minimal', 'low', 'medium', 'high', 'xhigh']);
  const models: Partial<Record<JobType, JobModelConfig>> = {};

  function parseEffort(value: unknown, name: string) {
    const raw = getTomlString(value, name);
    const trimmed = raw?.trim();
    if (!trimmed) return undefined;
    if (!allowedEfforts.has(trimmed)) {
      throw new Error(
        `Invalid ${name} in TOML. Expected one of: minimal, low, medium, high, xhigh.`,
      );
    }
    return trimmed as JobModelConfig['modelReasoningEffort'];
  }

  for (const [key, value] of entries) {
    if (!allowed.has(key as JobType)) {
      throw new Error(
        `Invalid ${label} key: ${key}. Expected ASK, IMPLEMENT, PLAN, REVIEW, MENTION.`,
      );
    }

    if (typeof value === 'string') {
      const model = value.trim();
      if (!model) {
        throw new Error(`Invalid ${label}.${key} in TOML. Expected a non-empty string.`);
      }
      models[key as JobType] = { model };
      continue;
    }

    const modelToml = getTomlTable(value, `${label}.${key}`);
    if (!modelToml) {
      throw new Error(`Invalid ${label}.${key} in TOML. Expected a table.`);
    }
    const rawModel = getTomlString(modelToml.model, `${label}.${key}.model`);
    const model = rawModel?.trim();
    if (!model) {
      throw new Error(`Invalid ${label}.${key}.model in TOML. Expected a non-empty string.`);
    }
    const modelReasoningEffort = parseEffort(
      modelToml.model_reasoning_effort,
      `${label}.${key}.model_reasoning_effort`,
    );
    models[key as JobType] = {
      model,
      ...(modelReasoningEffort ? { modelReasoningEffort } : {}),
    };
  }
  return Object.keys(models).length ? models : undefined;
}

function loadCoreConfigFromToml(coreToml?: TomlTable): CoreConfig {
  const repoAllowlistPath = resolvePathValue(
    'REPO_ALLOWLIST_PATH',
    coreToml?.repo_allowlist_path,
    {
      required: true,
    },
  );
  const repoAllowlist = parseRepoAllowlist(repoAllowlistPath as string);
  const jobRegistryDriver = resolveJobRegistryDriver(coreToml?.job_registry_db);
  const jobRegistryPgUrl = resolveJobRegistryPgUrl(jobRegistryDriver);

  return {
    repoAllowlistPath: repoAllowlistPath as string,
    repoAllowlist,
    jobWorkRoot: resolvePathValue('JOB_WORK_ROOT', coreToml?.job_work_root, {
      required: true,
    }) as string,
    jobRegistryPath: resolvePathValue('JOB_REGISTRY_PATH', coreToml?.job_registry_path, {
      required: true,
    }) as string,
    jobRegistryDriver,
    ...(jobRegistryPgUrl ? { jobRegistryPgUrl } : {}),
  };
}

export function loadCoreConfig(): CoreConfig {
  if (coreConfigCache) return coreConfigCache;
  const toml = loadTomlConfig(WORKER_CONFIG_PATH_ENV, DEFAULT_WORKER_CONFIG_PATH, 'worker');
  const coreToml = getTomlTable(toml.core, 'core');
  coreConfigCache = loadCoreConfigFromToml(coreToml);
  return coreConfigCache;
}

export function loadBotConfig(): BotConfig {
  if (botConfigCache) return botConfigCache;
  const toml = loadTomlConfig(BOT_CONFIG_PATH_ENV, DEFAULT_BOT_CONFIG_PATH, 'bot');
  const coreToml = getTomlTable(toml.core, 'core');
  const botToml = getTomlTable(toml.bot, 'bot');
  const slackToml = getTomlTable(toml.slack, 'slack');
  const discordToml = getTomlTable(toml.discord, 'discord');

  const core = loadCoreConfigFromToml(coreToml);
  if (!coreConfigCache) coreConfigCache = core;

  const botName = resolveBotName(botToml?.bot_name);
  const primaryAgent = resolvePrimaryAgent(botToml?.primary_agent);
  const debugJobSpecMessages = resolveOptionalFlagFromSources(
    'DEBUG_JOB_SPEC_MESSAGES',
    botToml?.debug_job_spec_messages,
    false,
  );
  const bootstrapServices = resolveStringArrayFromSources(
    'BOOTSTRAP_SERVICES',
    botToml?.bootstrap_services,
  ) as Array<'local' | 'github' | 'gitlab'>;
  const slackEnabled = resolveOptionalFlagFromSources('SLACK_ENABLED', slackToml?.enabled, false);
  const discordEnabled = resolveOptionalFlagFromSources(
    'DISCORD_ENABLED',
    discordToml?.enabled,
    false,
  );
  const discordGuildId = resolveStringValue('DISCORD_GUILD_ID', discordToml?.guild_id);
  const discordChannelIds = resolveStringArrayFromSources(
    'DISCORD_CHANNEL_IDS',
    discordToml?.channel_ids,
  );
  const discordBotToken = process.env.DISCORD_BOT_TOKEN?.trim();
  const discordAppId = resolveStringValue('DISCORD_APP_ID', discordToml?.app_id, {
    required: false,
  });
  const adminUserIds = resolveStringArrayFromSources('ADMIN_USER_IDS', botToml?.admin_user_ids);
  const redisUrl = resolveStringValue('REDIS_URL', botToml?.redis_url, {
    required: true,
  }) as string;

  botConfigCache = {
    ...core,
    botName,
    primaryAgent,
    bootstrapServices,
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
        appId: resolveStringValue('DISCORD_APP_ID', discordAppId, { required: true }) as string,
        ...(discordGuildId ? { guildId: discordGuildId } : {}),
        ...(discordChannelIds.length ? { channelIds: discordChannelIds } : {}),
      },
    }),
    adminUserIds,
    redisUrl,
  };
  return botConfigCache;
}

export function loadWorkerConfig(): WorkerConfig {
  if (workerConfigCache) return workerConfigCache;
  const toml = loadTomlConfig(WORKER_CONFIG_PATH_ENV, DEFAULT_WORKER_CONFIG_PATH, 'worker');
  const coreToml = getTomlTable(toml.core, 'core');
  const workerToml = getTomlTable(toml.worker, 'worker');
  const copilotToml = getTomlTable(toml.copilot, 'copilot');
  const codexToml = getTomlTable(toml.codex, 'codex');
  const githubToml = getTomlTable(toml.github, 'github');
  const gitlabToml = getTomlTable(toml.gitlab, 'gitlab');

  const core = loadCoreConfigFromToml(coreToml);
  if (!coreConfigCache) coreConfigCache = core;

  const botName = resolveBotName(workerToml?.bot_name);
  const primaryAgent = resolvePrimaryAgent(workerToml?.primary_agent);
  const copilotExecutionMode = resolveCopilotExecutionMode(copilotToml?.execution_mode);
  const copilotIdleRetries = resolveCopilotIdleRetries(copilotToml?.idle_retries);
  const copilotDockerfilePath = resolveStringValue(
    'GH_COPILOT_DOCKERFILE_PATH',
    copilotToml?.dockerfile_path,
  );
  const copilotDockerImage = resolveStringValue(
    'GH_COPILOT_DOCKER_IMAGE',
    copilotToml?.docker_image,
  );
  const copilotDockerBuildContext = resolveStringValue(
    'GH_COPILOT_DOCKER_BUILD_CONTEXT',
    copilotToml?.docker_build_context,
  );
  const copilotModels = parseModelMap(
    getTomlTable(copilotToml?.models, 'copilot.models'),
    'copilot.models',
  );

  const executionMode = resolveCodexExecutionMode(codexToml?.execution_mode);
  const dockerfilePath = resolveStringValue('CODEX_DOCKERFILE_PATH', codexToml?.dockerfile_path);
  const dockerImage = resolveStringValue('CODEX_DOCKER_IMAGE', codexToml?.docker_image);
  const dockerBuildContext = resolveStringValue(
    'CODEX_DOCKER_BUILD_CONTEXT',
    codexToml?.docker_build_context,
  );
  const codexModels = parseModelMap(
    getTomlTable(codexToml?.models, 'codex.models'),
    'codex.models',
  );

  const jobRootCopyGlob = resolvePathValue('JOB_ROOT_COPY_GLOB', workerToml?.job_root_copy_glob);
  const cleanupMaxAge = resolveStringValue('CLEANUP_MAX_AGE', workerToml?.cleanup_max_age);
  const cleanupMaxEntriesEnv = process.env.CLEANUP_MAX_ENTRIES?.trim();
  let cleanupMaxEntries = getTomlNumber(
    workerToml?.cleanup_max_entries,
    'worker.cleanup_max_entries',
  );
  if (cleanupMaxEntriesEnv) {
    const parsed = Number.parseInt(cleanupMaxEntriesEnv, 10);
    if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
      throw new Error('Invalid CLEANUP_MAX_ENTRIES. Expected a non-negative integer.');
    }
    cleanupMaxEntries = parsed;
  }
  const includeRawRequestInMr = resolveOptionalFlagFromSources(
    'INCLUDE_RAW_REQUEST_IN_MR',
    workerToml?.include_raw_request_in_mr,
    false,
  );
  const openAiKey = process.env.OPENAI_API_KEY;
  if (!openAiKey && primaryAgent === 'codex') {
    logger.warn('OPENAI_API_KEY is not set.');
  }
  const gitlab = resolveGitLabConfig(gitlabToml);
  const github = resolveGitHubConfig(githubToml);
  const redisUrl = resolveStringValue('REDIS_URL', workerToml?.redis_url, {
    required: true,
  }) as string;
  const localRepoRoot = resolvePathValue('LOCAL_REPO_ROOT', workerToml?.local_repo_root);

  workerConfigCache = {
    ...core,
    botName,
    redisUrl,
    primaryAgent,
    ...(localRepoRoot ? { localRepoRoot } : {}),
    copilot: {
      executionMode: copilotExecutionMode,
      idleRetries: copilotIdleRetries,
      ...(copilotDockerfilePath && { dockerfilePath: copilotDockerfilePath }),
      ...(copilotDockerImage && { dockerImage: copilotDockerImage }),
      ...(copilotDockerBuildContext && { dockerBuildContext: copilotDockerBuildContext }),
      ...(copilotModels && { models: copilotModels }),
    },
    ...(openAiKey && { openAiKey }),
    ...(gitlab && { gitlab }),
    ...(github && { github }),
    repoCacheRoot: resolvePathValue('REPO_CACHE_ROOT', workerToml?.repo_cache_root, {
      required: true,
    }) as string,
    ...(jobRootCopyGlob && { jobRootCopyGlob }),
    ...(cleanupMaxAge && { cleanupMaxAge }),
    ...(cleanupMaxEntries !== undefined && { cleanupMaxEntries }),
    includeRawRequestInMr,
    codex: {
      executionMode: executionMode,
      ...(dockerfilePath && { dockerfilePath }),
      ...(dockerImage && { dockerImage }),
      ...(dockerBuildContext && { dockerBuildContext }),
      ...(codexModels && { models: codexModels }),
    },
  };
  return workerConfigCache;
}
