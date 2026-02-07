import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadBotConfig, loadWorkerConfig, resetConfigCaches } from './env.js';
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
});
