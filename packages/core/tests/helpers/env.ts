import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function writeAllowlist(contents: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), 'sniptail-allowlist-'));
  const path = join(dir, 'allowlist.json');
  writeFileSync(path, JSON.stringify(contents), 'utf8');
  return path;
}

export function applyRequiredEnv(overrides: Record<string, string | undefined> = {}) {
  const allowlistPath = writeAllowlist({
    'repo-one': { sshUrl: 'git@example.com:org/repo.git', projectId: 123 },
  });

  const optionalKeys = [
    'OPENAI_API_KEY',
    'BOT_NAME',
    'ADMIN_USER_IDS',
    'CODEX_EXECUTION_MODE',
    'CODEX_DOCKERFILE_PATH',
    'CODEX_DOCKER_IMAGE',
    'CODEX_DOCKER_BUILD_CONTEXT',
    'JOB_ROOT_COPY_GLOB',
    'GITHUB_TOKEN',
    'GITHUB_API_BASE_URL',
    'GITLAB_BASE_URL',
    'GITLAB_TOKEN',
  ];
  for (const key of optionalKeys) {
    delete process.env[key];
  }

  process.env.SLACK_BOT_TOKEN = 'xoxb-test';
  process.env.SLACK_APP_TOKEN = 'xapp-test';
  process.env.SLACK_SIGNING_SECRET = 'secret';
  process.env.REDIS_URL = 'redis://localhost:6379/0';
  process.env.REPO_ALLOWLIST_PATH = allowlistPath;
  process.env.REPO_CACHE_ROOT = '/tmp/sniptail/repos';
  process.env.JOB_WORK_ROOT = '/tmp/sniptail/jobs';
  process.env.JOB_REGISTRY_PATH = '/tmp/sniptail/registry.json';

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
