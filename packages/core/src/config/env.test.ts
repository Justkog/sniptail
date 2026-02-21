import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBotConfig, loadCoreConfig, loadWorkerConfig, resetConfigCaches } from './env.js';
import { logger } from '../logger.js';
import { applyRequiredEnv } from '../../tests/helpers/env.js';

describe('config loaders', () => {
  afterEach(() => {
    resetConfigCaches();
    vi.restoreAllMocks();
  });

  it('throws when required bot env vars are missing', () => {
    applyRequiredEnv({ SNIPTAIL_CHANNELS: 'slack', SLACK_BOT_TOKEN: undefined });

    expect(() => loadBotConfig()).toThrow('Missing required env var: SLACK_BOT_TOKEN');
  });

  it('warns when OPENAI_API_KEY is not set', () => {
    applyRequiredEnv();
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    loadWorkerConfig();

    expect(warnSpy).toHaveBeenCalledWith('OPENAI_API_KEY is not set.');
  });

  it('requires both GitLab base URL and token when either is provided', () => {
    applyRequiredEnv({ GITLAB_BASE_URL: 'https://gitlab.example.com' });

    expect(() => loadWorkerConfig()).toThrow(
      'GITLAB_TOKEN is required when GITLAB_BASE_URL is set.',
    );
  });

  it('loads bot config with defaults', () => {
    applyRequiredEnv({ BOT_NAME: '  ' });
    const config = loadBotConfig();

    expect(config.botName).toBe('Sniptail');
    expect(config.debugJobSpecMessages).toBe(false);
    expect(config.repoAllowlist).toEqual({});
    expect(config.permissions.defaultEffect).toBe('allow');
    expect(config.permissions.rules).toEqual([]);
  });

  it('parses permission rules from TOML', () => {
    applyRequiredEnv({
      SNIPTAIL_BOT_CONFIG_PATH: undefined,
    });

    const configDir = mkdtempSync(join(tmpdir(), 'sniptail-config-'));
    const botConfigPath = join(configDir, 'bot.toml');
    const allowlistPath = join(configDir, 'allowlist.json');
    writeFileSync(allowlistPath, JSON.stringify({}), 'utf8');
    const botToml = [
      '[core]',
      `repo_allowlist_path = "${allowlistPath}"`,
      'job_work_root = "/tmp/sniptail/jobs"',
      'job_registry_path = "/tmp/sniptail/registry"',
      'job_registry_db = "sqlite"',
      '',
      '[bot]',
      'bot_name = "Sniptail"',
      'primary_agent = "codex"',
      'redis_url = "redis://localhost:6379/0"',
      '',
      '[permissions]',
      'default_effect = "allow"',
      'approval_ttl_seconds = 7200',
      'group_cache_ttl_seconds = 45',
      '',
      '[[permissions.rules]]',
      'id = "clear-before-rule"',
      'effect = "require_approval"',
      'actions = ["jobs.clearBefore"]',
      'subjects = ["user:*"]',
      'approver_subjects = ["group:slack:S123"]',
      'notify_subjects = ["group:slack:S123"]',
      'providers = ["slack"]',
      'channel_ids = ["C123"]',
      '',
      '[channels.slack]',
      'enabled = true',
      '',
      '[channels.discord]',
      'enabled = false',
    ].join('\n');
    writeFileSync(botConfigPath, botToml, 'utf8');
    process.env.SNIPTAIL_BOT_CONFIG_PATH = botConfigPath;

    const config = loadBotConfig();
    expect(config.permissions.approvalTtlSeconds).toBe(7200);
    expect(config.permissions.groupCacheTtlSeconds).toBe(45);
    expect(config.permissions.rules[0]?.id).toBe('clear-before-rule');
  });

  it('fails on invalid permission subject token', () => {
    applyRequiredEnv({
      SNIPTAIL_BOT_CONFIG_PATH: undefined,
    });

    const configDir = mkdtempSync(join(tmpdir(), 'sniptail-config-'));
    const botConfigPath = join(configDir, 'bot.toml');
    const allowlistPath = join(configDir, 'allowlist.json');
    writeFileSync(allowlistPath, JSON.stringify({}), 'utf8');
    const botToml = [
      '[core]',
      `repo_allowlist_path = "${allowlistPath}"`,
      'job_work_root = "/tmp/sniptail/jobs"',
      'job_registry_path = "/tmp/sniptail/registry"',
      'job_registry_db = "sqlite"',
      '',
      '[bot]',
      'bot_name = "Sniptail"',
      'primary_agent = "codex"',
      'redis_url = "redis://localhost:6379/0"',
      '',
      '[permissions]',
      'default_effect = "allow"',
      '',
      '[[permissions.rules]]',
      'id = "bad-subject-rule"',
      'effect = "deny"',
      'actions = ["jobs.clear"]',
      'subjects = ["team:abc"]',
      '',
      '[channels.slack]',
      'enabled = true',
      '',
      '[channels.discord]',
      'enabled = false',
    ].join('\n');
    writeFileSync(botConfigPath, botToml, 'utf8');
    process.env.SNIPTAIL_BOT_CONFIG_PATH = botConfigPath;

    expect(() => loadBotConfig()).toThrow('Invalid permissions.rules[0].subjects in TOML');
  });

  it('fails when require_approval is missing approver_subjects', () => {
    applyRequiredEnv({
      SNIPTAIL_BOT_CONFIG_PATH: undefined,
    });

    const configDir = mkdtempSync(join(tmpdir(), 'sniptail-config-'));
    const botConfigPath = join(configDir, 'bot.toml');
    const allowlistPath = join(configDir, 'allowlist.json');
    writeFileSync(allowlistPath, JSON.stringify({}), 'utf8');
    const botToml = [
      '[core]',
      `repo_allowlist_path = "${allowlistPath}"`,
      'job_work_root = "/tmp/sniptail/jobs"',
      'job_registry_path = "/tmp/sniptail/registry"',
      'job_registry_db = "sqlite"',
      '',
      '[bot]',
      'bot_name = "Sniptail"',
      'primary_agent = "codex"',
      'redis_url = "redis://localhost:6379/0"',
      '',
      '[permissions]',
      'default_effect = "allow"',
      '',
      '[[permissions.rules]]',
      'id = "missing-approvers"',
      'effect = "require_approval"',
      'actions = ["jobs.clearBefore"]',
      '',
      '[channels.slack]',
      'enabled = true',
      '',
      '[channels.discord]',
      'enabled = false',
    ].join('\n');
    writeFileSync(botConfigPath, botToml, 'utf8');
    process.env.SNIPTAIL_BOT_CONFIG_PATH = botConfigPath;

    expect(() => loadBotConfig()).toThrow('require_approval needs approver subjects');
  });

  it('enables channels from SNIPTAIL_CHANNELS when provided', () => {
    applyRequiredEnv({
      SNIPTAIL_CHANNELS: 'discord',
      DISCORD_APP_ID: '123456789012345678',
      DISCORD_BOT_TOKEN: 'discord-test-token',
    });

    const config = loadBotConfig();

    expect(config.enabledChannels).toEqual(['discord']);
    expect(config.slackEnabled).toBe(false);
    expect(config.discordEnabled).toBe(true);
  });

  it('uses per-channel enabled flags when SNIPTAIL_CHANNELS is absent', () => {
    applyRequiredEnv({ SNIPTAIL_CHANNELS: undefined });
    const config = loadBotConfig();

    expect(config.enabledChannels).toEqual(['slack']);
    expect(config.slackEnabled).toBe(true);
    expect(config.discordEnabled).toBe(false);
  });

  it('enables job spec messages when debug flag is set', () => {
    applyRequiredEnv({ DEBUG_JOB_SPEC_MESSAGES: 'true' });

    const config = loadBotConfig();

    expect(config.debugJobSpecMessages).toBe(true);
  });

  it('does not require worker-only env vars for bot config', () => {
    applyRequiredEnv({ REPO_CACHE_ROOT: undefined, CODEX_EXECUTION_MODE: undefined });

    expect(() => loadBotConfig()).not.toThrow();
  });

  it('throws when COPILOT_IDLE_RETRIES is invalid', () => {
    applyRequiredEnv({ COPILOT_IDLE_RETRIES: 'nope' });

    expect(() => loadWorkerConfig()).toThrow('Invalid COPILOT_IDLE_RETRIES');
  });

  it('requires a redis registry URL when JOB_REGISTRY_DB=redis and no fallback exists', () => {
    applyRequiredEnv({
      JOB_REGISTRY_DB: 'redis',
      JOB_REGISTRY_REDIS_URL: undefined,
      REDIS_URL: undefined,
    });

    const configDir = mkdtempSync(join(tmpdir(), 'sniptail-config-'));
    const workerConfigPath = join(configDir, 'worker.toml');
    const workerToml = [
      '[core]',
      'job_work_root = "/tmp/sniptail/jobs"',
      'job_registry_path = "/tmp/sniptail/registry"',
      'job_registry_db = "redis"',
      '',
      '[worker]',
      'bot_name = "Sniptail"',
      'primary_agent = "codex"',
      'repo_cache_root = "/tmp/sniptail/repos"',
      'job_root_copy_glob = ""',
      'include_raw_request_in_mr = false',
      '',
      '[copilot]',
      'execution_mode = "local"',
      'idle_retries = 2',
      '',
      '[codex]',
      'execution_mode = "local"',
    ].join('\n');
    writeFileSync(workerConfigPath, workerToml, 'utf8');
    process.env.SNIPTAIL_WORKER_CONFIG_PATH = workerConfigPath;

    expect(() => loadCoreConfig()).toThrow(
      'JOB_REGISTRY_REDIS_URL or REDIS_URL is required when JOB_REGISTRY_DB=redis',
    );
  });

  it('falls back to worker.toml redis_url when JOB_REGISTRY_DB=redis', () => {
    applyRequiredEnv({
      JOB_REGISTRY_DB: 'redis',
      JOB_REGISTRY_REDIS_URL: undefined,
      REDIS_URL: undefined,
    });

    const config = loadWorkerConfig();
    expect(config.jobRegistryDriver).toBe('redis');
    expect(config.jobRegistryRedisUrl).toBe('redis://localhost:6379/0');
  });

  it('accepts JOB_REGISTRY_REDIS_URL when JOB_REGISTRY_DB=redis', () => {
    applyRequiredEnv({
      JOB_REGISTRY_DB: 'redis',
      JOB_REGISTRY_REDIS_URL: 'redis://localhost:6379/3',
    });

    const config = loadWorkerConfig();
    expect(config.jobRegistryDriver).toBe('redis');
    expect(config.jobRegistryRedisUrl).toBe('redis://localhost:6379/3');
  });

  it('defaults dockerfile paths when not configured', () => {
    applyRequiredEnv();

    const configDir = mkdtempSync(join(tmpdir(), 'sniptail-config-'));
    const workerConfigPath = join(configDir, 'worker.toml');
    const workerToml = [
      '[core]',
      'job_work_root = "/tmp/sniptail/jobs"',
      'job_registry_path = "/tmp/sniptail/registry"',
      'job_registry_db = "redis"',
      '',
      '[worker]',
      'bot_name = "Sniptail"',
      'primary_agent = "codex"',
      'redis_url = "redis://localhost:6379/0"',
      'repo_cache_root = "/tmp/sniptail/repos"',
      'job_root_copy_glob = ""',
      'include_raw_request_in_mr = false',
      '',
      '[copilot]',
      'execution_mode = "local"',
      'idle_retries = 2',
      '',
      '[codex]',
      'execution_mode = "local"',
    ].join('\n');
    writeFileSync(workerConfigPath, workerToml, 'utf8');
    process.env.SNIPTAIL_WORKER_CONFIG_PATH = workerConfigPath;

    const config = loadWorkerConfig();
    expect(config.copilot.dockerfilePath).toBe('../../Dockerfile.copilot');
    expect(config.copilot.dockerImage).toBe('snatch-copilot:local');
    expect(config.codex.dockerfilePath).toBe('../../Dockerfile.codex');
    expect(config.codex.dockerImage).toBe('snatch-codex:local');
  });

  it('loads optional worktree setup hook settings', () => {
    applyRequiredEnv({
      WORKTREE_SETUP_COMMAND: 'pnpm install --prefer-offline --no-lockfile',
      WORKTREE_SETUP_ALLOW_FAILURE: 'true',
    });

    const config = loadWorkerConfig();
    expect(config.worktreeSetupCommand).toBe('pnpm install --prefer-offline --no-lockfile');
    expect(config.worktreeSetupAllowFailure).toBe(true);
  });

  it('defaults worker concurrency settings to 2', () => {
    applyRequiredEnv();

    const config = loadWorkerConfig();
    expect(config.jobConcurrency).toBe(2);
    expect(config.bootstrapConcurrency).toBe(2);
    expect(config.workerEventConcurrency).toBe(2);
  });

  it('loads worker concurrency settings from TOML', () => {
    applyRequiredEnv();

    const configDir = mkdtempSync(join(tmpdir(), 'sniptail-config-'));
    const workerConfigPath = join(configDir, 'worker.toml');
    const workerToml = [
      '[core]',
      'job_work_root = "/tmp/sniptail/jobs"',
      'job_registry_path = "/tmp/sniptail/registry"',
      'job_registry_db = "redis"',
      '',
      '[worker]',
      'bot_name = "Sniptail"',
      'primary_agent = "codex"',
      'redis_url = "redis://localhost:6379/0"',
      'repo_cache_root = "/tmp/sniptail/repos"',
      'job_concurrency = 4',
      'bootstrap_concurrency = 3',
      'worker_event_concurrency = 5',
      'job_root_copy_glob = ""',
      'include_raw_request_in_mr = false',
      '',
      '[copilot]',
      'execution_mode = "local"',
      'idle_retries = 2',
      '',
      '[codex]',
      'execution_mode = "local"',
    ].join('\n');
    writeFileSync(workerConfigPath, workerToml, 'utf8');
    process.env.SNIPTAIL_WORKER_CONFIG_PATH = workerConfigPath;

    const config = loadWorkerConfig();
    expect(config.jobConcurrency).toBe(4);
    expect(config.bootstrapConcurrency).toBe(3);
    expect(config.workerEventConcurrency).toBe(5);
  });

  it('throws when worker concurrency env values are invalid', () => {
    applyRequiredEnv({
      JOB_CONCURRENCY: '0',
    });

    expect(() => loadWorkerConfig()).toThrow(
      'Invalid JOB_CONCURRENCY. Expected a positive integer.',
    );
  });
});
