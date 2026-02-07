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
    applyRequiredEnv({ SLACK_ENABLED: 'true', SLACK_BOT_TOKEN: undefined });

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
});
