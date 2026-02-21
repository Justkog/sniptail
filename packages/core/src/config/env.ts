import { logger } from '../logger.js';
import type { TomlTable } from './toml.js';
import {
  loadTomlConfig,
  getTomlTable,
  getTomlString,
  getTomlNumber,
  getTomlStringArray,
} from './toml.js';
import type { CoreConfig, BotConfig, WorkerConfig, JobModelConfig } from './types.js';
import type { JobType } from '../types/job.js';
import type { ChannelProvider } from '../types/channel.js';
import { isPermissionAction } from '../permissions/permissionsActionCatalog.js';
import type {
  PermissionEffect,
  PermissionRule,
  PermissionSubject,
  PermissionsConfig,
} from '../permissions/permissionsPolicyTypes.js';
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
  resolveJobRegistryRedisUrl,
  resolvePrimaryAgent,
  resolveCopilotExecutionMode,
  resolveCopilotIdleRetries,
  resolveCodexExecutionMode,
  resolveOptionalFlagFromSources,
  resolveStringArrayFromSources,
  resolvePathValue,
  resolveStringValue,
} from './resolve.js';
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

function loadCoreConfigFromToml(coreToml?: TomlTable, appRedisUrlToml?: unknown): CoreConfig {
  const repoAllowlistPath = resolvePathValue('REPO_ALLOWLIST_PATH', coreToml?.repo_allowlist_path, {
    required: false,
  });
  const jobRegistryDriver = resolveJobRegistryDriver(coreToml?.job_registry_db);
  const jobRegistryPgUrl = resolveJobRegistryPgUrl(jobRegistryDriver);
  const jobRegistryRedisUrl = resolveJobRegistryRedisUrl(
    jobRegistryDriver,
    coreToml?.job_registry_redis_url,
    appRedisUrlToml,
  );
  const jobRegistryPath = resolvePathValue('JOB_REGISTRY_PATH', coreToml?.job_registry_path, {
    required: jobRegistryDriver === 'sqlite',
  });

  return {
    ...(repoAllowlistPath ? { repoAllowlistPath } : {}),
    repoAllowlist: {},
    jobWorkRoot: resolvePathValue('JOB_WORK_ROOT', coreToml?.job_work_root, {
      required: true,
    }) as string,
    ...(jobRegistryPath ? { jobRegistryPath } : {}),
    jobRegistryDriver,
    ...(jobRegistryPgUrl ? { jobRegistryPgUrl } : {}),
    ...(jobRegistryRedisUrl ? { jobRegistryRedisUrl } : {}),
  };
}

function normalizeProviderId(value: string): ChannelProvider {
  return value.trim().toLowerCase();
}

function uniqueProviderList(values: string[]): ChannelProvider[] {
  const normalized = values.map(normalizeProviderId).filter(Boolean);
  return [...new Set(normalized)];
}

function parseTomlOptionalBoolean(value: unknown, name: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  throw new Error(`Invalid ${name} in TOML. Use true/false.`);
}

function resolvePositiveIntegerFromSources(
  envName: string,
  tomlValue: unknown,
  tomlName: string,
  defaultValue: number,
): number {
  const envRaw = process.env[envName];
  if (envRaw !== undefined && envRaw.trim() !== '') {
    const normalized = envRaw.trim();
    if (!/^\d+$/.test(normalized)) {
      throw new Error(`Invalid ${envName}. Expected a positive integer.`);
    }
    const parsed = Number.parseInt(normalized, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error(`Invalid ${envName}. Expected a positive integer.`);
    }
    return parsed;
  }

  const tomlNumber = getTomlNumber(tomlValue, tomlName);
  if (tomlNumber !== undefined) {
    if (!Number.isInteger(tomlNumber) || tomlNumber < 1) {
      throw new Error(`Invalid ${tomlName} in TOML. Expected a positive integer.`);
    }
    return tomlNumber;
  }

  return defaultValue;
}

function parsePermissionSubjectToken(raw: string, label: string): PermissionSubject {
  const token = raw.trim();
  if (!token) {
    throw new Error(`Invalid ${label} in TOML. Empty subject token.`);
  }
  if (token.startsWith('user:')) {
    const userId = token.slice('user:'.length).trim();
    if (!userId) {
      throw new Error(`Invalid ${label} in TOML. Expected user:<id> or user:*.`);
    }
    return {
      kind: 'user',
      userId: userId === '*' ? '*' : userId,
    };
  }
  if (token.startsWith('group:')) {
    const parts = token.split(':');
    if (parts.length !== 3) {
      throw new Error(`Invalid ${label} in TOML. Expected group:slack:<id> or group:discord:<id>.`);
    }
    const provider = parts[1]?.trim();
    const groupId = parts[2]?.trim();
    if ((provider !== 'slack' && provider !== 'discord') || !groupId) {
      throw new Error(`Invalid ${label} in TOML. Expected group:slack:<id> or group:discord:<id>.`);
    }
    return {
      kind: 'group',
      provider,
      groupId,
    };
  }
  throw new Error(`Invalid ${label} in TOML. Expected user:<id> or group:<provider>:<id>.`);
}

function parsePermissionEffect(value: unknown, label: string): PermissionEffect {
  const raw = getTomlString(value, label)?.trim();
  if (!raw) {
    throw new Error(`Invalid ${label} in TOML. Expected allow, deny, or require_approval.`);
  }
  if (raw !== 'allow' && raw !== 'deny' && raw !== 'require_approval') {
    throw new Error(`Invalid ${label} in TOML. Expected allow, deny, or require_approval.`);
  }
  return raw;
}

function parsePermissionsConfig(permissionsToml: TomlTable | undefined): PermissionsConfig {
  if (!permissionsToml) {
    return {
      defaultEffect: 'allow',
      approvalTtlSeconds: 86_400,
      groupCacheTtlSeconds: 60,
      rules: [],
    };
  }

  const defaultEffectValue = permissionsToml.default_effect;
  const defaultEffect = defaultEffectValue
    ? parsePermissionEffect(defaultEffectValue, 'permissions.default_effect')
    : 'allow';
  const rawDefaultApproverSubjects = getTomlStringArray(
    permissionsToml.default_approver_subjects,
    'permissions.default_approver_subjects',
  );
  const defaultApproverSubjects = rawDefaultApproverSubjects?.map((subject) =>
    parsePermissionSubjectToken(subject, 'permissions.default_approver_subjects'),
  );
  const rawDefaultNotifySubjects = getTomlStringArray(
    permissionsToml.default_notify_subjects,
    'permissions.default_notify_subjects',
  );
  const defaultNotifySubjects = rawDefaultNotifySubjects?.map((subject) =>
    parsePermissionSubjectToken(subject, 'permissions.default_notify_subjects'),
  );
  if (defaultEffect === 'require_approval' && (!defaultApproverSubjects || defaultApproverSubjects.length === 0)) {
    throw new Error(
      'Invalid permissions.default_approver_subjects in TOML. default_effect=require_approval requires at least one default_approver_subjects entry.',
    );
  }
  const approvalTtlSeconds = resolvePositiveIntegerFromSources(
    'PERMISSIONS_APPROVAL_TTL_SECONDS',
    permissionsToml.approval_ttl_seconds,
    'permissions.approval_ttl_seconds',
    86_400,
  );
  const groupCacheTtlSeconds = resolvePositiveIntegerFromSources(
    'PERMISSIONS_GROUP_CACHE_TTL_SECONDS',
    permissionsToml.group_cache_ttl_seconds,
    'permissions.group_cache_ttl_seconds',
    60,
  );
  const rulesValue = permissionsToml.rules;
  if (rulesValue === undefined) {
    return {
      defaultEffect,
      ...(defaultApproverSubjects?.length ? { defaultApproverSubjects } : {}),
      ...(defaultNotifySubjects?.length ? { defaultNotifySubjects } : {}),
      approvalTtlSeconds,
      groupCacheTtlSeconds,
      rules: [],
    };
  }
  if (!Array.isArray(rulesValue)) {
    throw new Error('Invalid permissions.rules in TOML. Expected an array of tables.');
  }

  const rules: PermissionRule[] = rulesValue.map((ruleValue, index) => {
    const ruleLabel = `permissions.rules[${index}]`;
    const ruleToml = getTomlTable(ruleValue, ruleLabel);
    if (!ruleToml) {
      throw new Error(`Invalid ${ruleLabel} in TOML. Expected a table.`);
    }

    const id = getTomlString(ruleToml.id, `${ruleLabel}.id`)?.trim();
    if (!id) {
      throw new Error(`Invalid ${ruleLabel}.id in TOML. Expected a non-empty string.`);
    }
    const effect = parsePermissionEffect(ruleToml.effect, `${ruleLabel}.effect`);
    const rawActions = getTomlStringArray(ruleToml.actions, `${ruleLabel}.actions`) ?? [];
    if (!rawActions.length) {
      throw new Error(`Invalid ${ruleLabel}.actions in TOML. Expected at least one action.`);
    }
    const actions = rawActions.map((action) => {
      const normalized = action.trim();
      if (!isPermissionAction(normalized)) {
        throw new Error(
          `Invalid ${ruleLabel}.actions entry "${action}" in TOML. Unknown permission action.`,
        );
      }
      return normalized;
    });

    if (
      effect === 'require_approval' &&
      actions.some(
        (action) =>
          action === 'approval.grant' || action === 'approval.deny' || action === 'approval.cancel',
      )
    ) {
      throw new Error(
        `Invalid ${ruleLabel} in TOML. approval.grant/deny/cancel cannot use require_approval.`,
      );
    }

    const rawSubjects = getTomlStringArray(ruleToml.subjects, `${ruleLabel}.subjects`);
    const subjects = rawSubjects?.map((subject) =>
      parsePermissionSubjectToken(subject, `${ruleLabel}.subjects`),
    );
    const rawApproverSubjects = getTomlStringArray(
      ruleToml.approver_subjects,
      `${ruleLabel}.approver_subjects`,
    );
    const approverSubjects = rawApproverSubjects?.map((subject) =>
      parsePermissionSubjectToken(subject, `${ruleLabel}.approver_subjects`),
    );
    const rawNotifySubjects = getTomlStringArray(
      ruleToml.notify_subjects,
      `${ruleLabel}.notify_subjects`,
    );
    const notifySubjects = rawNotifySubjects?.map((subject) =>
      parsePermissionSubjectToken(subject, `${ruleLabel}.notify_subjects`),
    );
    if (effect === 'require_approval' && (!approverSubjects || approverSubjects.length === 0)) {
      throw new Error(
        `Invalid ${ruleLabel}.approver_subjects in TOML. require_approval needs approver subjects.`,
      );
    }
    const providersRaw = getTomlStringArray(ruleToml.providers, `${ruleLabel}.providers`);
    const providers = providersRaw
      ?.map((provider) => provider.trim().toLowerCase())
      .filter(Boolean);
    if (providersRaw && (!providers || providers.length !== providersRaw.length)) {
      throw new Error(`Invalid ${ruleLabel}.providers in TOML. Expected non-empty strings.`);
    }
    const channelIdsRaw = getTomlStringArray(ruleToml.channel_ids, `${ruleLabel}.channel_ids`);
    const channelIds = channelIdsRaw?.map((channelId) => channelId.trim()).filter(Boolean);

    return {
      id,
      effect,
      actions,
      ...(subjects?.length ? { subjects } : {}),
      ...(approverSubjects?.length ? { approverSubjects } : {}),
      ...(notifySubjects?.length ? { notifySubjects } : {}),
      ...(providers?.length ? { providers: providers as ChannelProvider[] } : {}),
      ...(channelIds?.length ? { channelIds } : {}),
    };
  });

  return {
    defaultEffect,
    ...(defaultApproverSubjects?.length ? { defaultApproverSubjects } : {}),
    ...(defaultNotifySubjects?.length ? { defaultNotifySubjects } : {}),
    approvalTtlSeconds,
    groupCacheTtlSeconds,
    rules,
  };
}

export function loadCoreConfig(): CoreConfig {
  if (coreConfigCache) return coreConfigCache;
  const toml = loadTomlConfig(WORKER_CONFIG_PATH_ENV, DEFAULT_WORKER_CONFIG_PATH, 'worker');
  const coreToml = getTomlTable(toml.core, 'core');
  const workerToml = getTomlTable(toml.worker, 'worker');
  coreConfigCache = loadCoreConfigFromToml(coreToml, workerToml?.redis_url);
  return coreConfigCache;
}

export function loadBotConfig(): BotConfig {
  if (botConfigCache) return botConfigCache;
  const toml = loadTomlConfig(BOT_CONFIG_PATH_ENV, DEFAULT_BOT_CONFIG_PATH, 'bot');
  const coreToml = getTomlTable(toml.core, 'core');
  const botToml = getTomlTable(toml.bot, 'bot');
  const channelsToml = getTomlTable(toml.channels, 'channels');
  const permissionsToml = getTomlTable(toml.permissions, 'permissions');
  const channelsSlackToml = getTomlTable(channelsToml?.slack, 'channels.slack');
  const channelsDiscordToml = getTomlTable(channelsToml?.discord, 'channels.discord');

  const core = loadCoreConfigFromToml(coreToml, botToml?.redis_url);
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
  );
  const hasRuntimeChannelOverride = process.env.SNIPTAIL_CHANNELS !== undefined;
  const runtimeEnabledChannels = uniqueProviderList(
    resolveStringArrayFromSources('SNIPTAIL_CHANNELS', undefined),
  );
  const slackEnabledByTable = parseTomlOptionalBoolean(
    channelsSlackToml?.enabled,
    'channels.slack.enabled',
  );
  const discordEnabledByTable = parseTomlOptionalBoolean(
    channelsDiscordToml?.enabled,
    'channels.discord.enabled',
  );
  const enabledChannels = hasRuntimeChannelOverride
    ? runtimeEnabledChannels
    : uniqueProviderList([
        ...(slackEnabledByTable ? ['slack'] : []),
        ...(discordEnabledByTable ? ['discord'] : []),
      ]);

  const slackEnabled = enabledChannels.includes('slack');
  const discordEnabled = enabledChannels.includes('discord');

  const discordGuildId = resolveStringValue('DISCORD_GUILD_ID', channelsDiscordToml?.guild_id);
  const discordChannelIds = resolveStringArrayFromSources(
    'DISCORD_CHANNEL_IDS',
    channelsDiscordToml?.channel_ids,
  );
  const discordBotToken = process.env.DISCORD_BOT_TOKEN?.trim();
  const discordAppId = resolveStringValue('DISCORD_APP_ID', channelsDiscordToml?.app_id, {
    required: false,
  });
  const permissions = parsePermissionsConfig(permissionsToml);
  const redisUrl = resolveStringValue('REDIS_URL', botToml?.redis_url, {
    required: true,
  }) as string;
  const channels = enabledChannels.reduce<Record<ChannelProvider, { enabled: boolean }>>(
    (acc, provider) => ({
      ...acc,
      [provider]: { enabled: true },
    }),
    {
      slack: { enabled: slackEnabled },
      discord: { enabled: discordEnabled },
    },
  );

  botConfigCache = {
    ...core,
    botName,
    primaryAgent,
    bootstrapServices,
    debugJobSpecMessages,
    enabledChannels,
    channels,
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
    permissions,
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

  const core = loadCoreConfigFromToml(coreToml, workerToml?.redis_url);
  if (!coreConfigCache) coreConfigCache = core;

  const botName = resolveBotName(workerToml?.bot_name);
  const primaryAgent = resolvePrimaryAgent(workerToml?.primary_agent);
  const copilotExecutionMode = resolveCopilotExecutionMode(copilotToml?.execution_mode);
  const copilotIdleRetries = resolveCopilotIdleRetries(copilotToml?.idle_retries);
  const copilotDockerfilePath = resolveStringValue(
    'GH_COPILOT_DOCKERFILE_PATH',
    copilotToml?.dockerfile_path,
    { defaultValue: '../../Dockerfile.copilot' },
  );
  const copilotDockerImage = resolveStringValue(
    'GH_COPILOT_DOCKER_IMAGE',
    copilotToml?.docker_image,
    { defaultValue: 'snatch-copilot:local' },
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
  const dockerfilePath = resolveStringValue('CODEX_DOCKERFILE_PATH', codexToml?.dockerfile_path, {
    defaultValue: '../../Dockerfile.codex',
  });
  const dockerImage = resolveStringValue('CODEX_DOCKER_IMAGE', codexToml?.docker_image, {
    defaultValue: 'snatch-codex:local',
  });
  const dockerBuildContext = resolveStringValue(
    'CODEX_DOCKER_BUILD_CONTEXT',
    codexToml?.docker_build_context,
  );
  const codexModels = parseModelMap(
    getTomlTable(codexToml?.models, 'codex.models'),
    'codex.models',
  );

  const jobRootCopyGlob = resolvePathValue('JOB_ROOT_COPY_GLOB', workerToml?.job_root_copy_glob);
  const worktreeSetupCommand = resolveStringValue(
    'WORKTREE_SETUP_COMMAND',
    workerToml?.worktree_setup_command,
  );
  const worktreeSetupAllowFailure = resolveOptionalFlagFromSources(
    'WORKTREE_SETUP_ALLOW_FAILURE',
    workerToml?.worktree_setup_allow_failure,
    false,
  );
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
  const jobConcurrency = resolvePositiveIntegerFromSources(
    'JOB_CONCURRENCY',
    workerToml?.job_concurrency,
    'worker.job_concurrency',
    2,
  );
  const bootstrapConcurrency = resolvePositiveIntegerFromSources(
    'BOOTSTRAP_CONCURRENCY',
    workerToml?.bootstrap_concurrency,
    'worker.bootstrap_concurrency',
    2,
  );
  const workerEventConcurrency = resolvePositiveIntegerFromSources(
    'WORKER_EVENT_CONCURRENCY',
    workerToml?.worker_event_concurrency,
    'worker.worker_event_concurrency',
    2,
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
    jobConcurrency,
    bootstrapConcurrency,
    workerEventConcurrency,
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
    ...(worktreeSetupCommand ? { worktreeSetupCommand } : {}),
    ...(worktreeSetupAllowFailure ? { worktreeSetupAllowFailure } : {}),
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
