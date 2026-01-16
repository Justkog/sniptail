import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from './env.js';
import { logger } from '../logger.js';
import { applyRequiredEnv, writeAllowlist } from '../../tests/helpers/env.js';

describe('loadConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when required env vars are missing', () => {
    applyRequiredEnv({ SLACK_BOT_TOKEN: undefined });

    expect(() => loadConfig()).toThrow('Missing required env var: SLACK_BOT_TOKEN');
  });

  it('warns when OPENAI_API_KEY is not set', () => {
    applyRequiredEnv();
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);

    loadConfig();

    expect(warnSpy).toHaveBeenCalledWith('OPENAI_API_KEY is not set. Codex jobs will likely fail.');
  });

  it('requires both GitLab base URL and token when either is provided', () => {
    applyRequiredEnv({ GITLAB_BASE_URL: 'https://gitlab.example.com' });

    expect(() => loadConfig()).toThrow('GITLAB_TOKEN is required when GITLAB_BASE_URL is set.');
  });

  it('throws when repo allowlist entries are missing sshUrl or localPath', () => {
    const allowlistPath = writeAllowlist({
      'repo-one': { projectId: 123 },
    });
    applyRequiredEnv({ REPO_ALLOWLIST_PATH: allowlistPath });

    expect(() => loadConfig()).toThrow('Repo allowlist entry missing sshUrl or localPath for repo-one.');
  });

  it('loads config with defaults and parsed allowlist', () => {
    applyRequiredEnv({ BOT_NAME: '  ' });
    const config = loadConfig();

    expect(config.botName).toBe('Sniptail');
    expect(config.repoAllowlist['repo-one']).toEqual({
      sshUrl: 'git@example.com:org/repo.git',
      projectId: 123,
    });
  });
});
