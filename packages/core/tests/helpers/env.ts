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
  const configDir = mkdtempSync(join(tmpdir(), 'sniptail-config-'));
  const botConfigPath = join(configDir, 'bot.toml');
  const workerConfigPath = join(configDir, 'worker.toml');
  const jobWorkRoot = join(configDir, 'jobs');
  const jobRegistryPath = join(configDir, 'job-registry');
  const repoCacheRoot = join(configDir, 'repos');

  const optionalKeys = [
    'SNIPTAIL_BOT_CONFIG_PATH',
    'SNIPTAIL_WORKER_CONFIG_PATH',
    'OPENAI_API_KEY',
    'BOT_NAME',
    'DEBUG_JOB_SPEC_MESSAGES',
    'ADMIN_USER_IDS',
    'JOB_REGISTRY_DB',
    'JOB_REGISTRY_PG_URL',
    'PRIMARY_AGENT',
    'SLACK_ENABLED',
    'DISCORD_ENABLED',
    'DISCORD_APP_ID',
    'DISCORD_GUILD_ID',
    'DISCORD_CHANNEL_IDS',
    'REDIS_URL',
    'REPO_ALLOWLIST_PATH',
    'JOB_WORK_ROOT',
    'JOB_REGISTRY_PATH',
    'REPO_CACHE_ROOT',
    'JOB_ROOT_COPY_GLOB',
    'INCLUDE_RAW_REQUEST_IN_MR',
    'CLEANUP_MAX_AGE',
    'CLEANUP_MAX_ENTRIES',
    'GH_COPILOT_EXECUTION_MODE',
    'GH_COPILOT_DOCKERFILE_PATH',
    'GH_COPILOT_DOCKER_IMAGE',
    'GH_COPILOT_DOCKER_BUILD_CONTEXT',
    'CODEX_EXECUTION_MODE',
    'CODEX_DOCKERFILE_PATH',
    'CODEX_DOCKER_IMAGE',
    'CODEX_DOCKER_BUILD_CONTEXT',
    'JOB_ROOT_COPY_GLOB',
    'GITHUB_API_TOKEN',
    'GITHUB_API_BASE_URL',
    'GITLAB_BASE_URL',
    'GITLAB_TOKEN',
    'COPILOT_IDLE_RETRIES',
  ];
  for (const key of optionalKeys) {
    delete process.env[key];
  }

  process.env.SLACK_BOT_TOKEN = 'xoxb-test';
  process.env.SLACK_APP_TOKEN = 'xapp-test';
  process.env.SLACK_SIGNING_SECRET = 'secret';
  process.env.SNIPTAIL_BOT_CONFIG_PATH = botConfigPath;
  process.env.SNIPTAIL_WORKER_CONFIG_PATH = workerConfigPath;

  const botToml = [
    '[core]',
    `repo_allowlist_path = "${allowlistPath}"`,
    `job_work_root = "${jobWorkRoot}"`,
    `job_registry_path = "${jobRegistryPath}"`,
    'job_registry_db = "sqlite"',
    '',
    '[bot]',
    'bot_name = "Sniptail"',
    'debug_job_spec_messages = false',
    'primary_agent = "codex"',
    'bootstrap_services = ["local", "github", "gitlab"]',
    'admin_user_ids = []',
    'redis_url = "redis://localhost:6379/0"',
    '',
    '[slack]',
    'enabled = true',
    '',
    '[discord]',
    'enabled = false',
    'app_id = ""',
    'guild_id = ""',
    'channel_ids = []',
    '',
    '[github]',
    'api_base_url = "https://api.github.com"',
    '',
    '[gitlab]',
    'base_url = ""',
    '',
  ].join('\n');

  const workerToml = [
    '[core]',
    `repo_allowlist_path = "${allowlistPath}"`,
    `job_work_root = "${jobWorkRoot}"`,
    `job_registry_path = "${jobRegistryPath}"`,
    'job_registry_db = "sqlite"',
    '',
    '[worker]',
    'bot_name = "Sniptail"',
    'primary_agent = "codex"',
    'redis_url = "redis://localhost:6379/0"',
    `repo_cache_root = "${repoCacheRoot}"`,
    'job_root_copy_glob = ""',
    'include_raw_request_in_mr = false',
    '',
    '[copilot]',
    'execution_mode = "local"',
    'idle_retries = 2',
    'dockerfile_path = "./Dockerfile.copilot"',
    'docker_image = "snatch-copilot:local"',
    'docker_build_context = ""',
    '',
    '[codex]',
    'execution_mode = "local"',
    'dockerfile_path = "./Dockerfile.codex"',
    'docker_image = "snatch-codex:local"',
    'docker_build_context = ""',
    '',
    '[github]',
    'api_base_url = "https://api.github.com"',
    '',
    '[gitlab]',
    'base_url = ""',
    '',
  ].join('\n');

  writeFileSync(botConfigPath, botToml, 'utf8');
  writeFileSync(workerConfigPath, workerToml, 'utf8');

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
