import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';

const hoisted = vi.hoisted(() => ({
  getDbMigrationStatus: vi.fn(),
  runRuntimeCapture: vi.fn(),
}));

vi.mock('@sniptail/core/db/migrations.js', () => ({
  getDbMigrationStatus: hoisted.getDbMigrationStatus,
}));

vi.mock('../lib/runtime.js', () => ({
  runRuntimeCapture: hoisted.runRuntimeCapture,
}));

import { registerDoctorCommand, runDoctor } from './doctor.js';
import { resetConfigCaches } from '@sniptail/core/config/config.js';

const originalExitCode = process.exitCode;
const originalEnv = { ...process.env };

let tempDirs: string[] = [];
let stdout = '';

type MigrationStatus = {
  driver: 'sqlite' | 'pg' | 'redis';
  expectedMigrations: number;
  appliedMigrations: number;
  pendingMigrations: number;
  isUpToDate: boolean;
  isAhead: boolean;
};

const DOCTOR_TEST_ENV_PREFIXES = [
  'SNIPTAIL_',
  'SLACK_',
  'DISCORD_',
  'TELEGRAM_',
  'GITLAB_',
  'GITHUB_',
  'CODEX_',
  'GH_COPILOT_',
  'OPENCODE_',
  'ACP_',
] as const;

const DOCTOR_TEST_ENV_KEYS = [
  'DOTENV_CONFIG_PATH',
  'PRIMARY_AGENT',
  'QUEUE_DRIVER',
  'REDIS_URL',
  'REPO_ALLOWLIST_PATH',
  'REPO_CACHE_ROOT',
  'JOB_WORK_ROOT',
  'LOCAL_REPO_ROOT',
  'OPENAI_API_KEY',
] as const;

function createTestEnv(): NodeJS.ProcessEnv {
  const env = { ...originalEnv };
  for (const key of Object.keys(env)) {
    if (DOCTOR_TEST_ENV_KEYS.includes(key)) {
      delete env[key];
      continue;
    }
    if (DOCTOR_TEST_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      delete env[key];
    }
  }
  return env;
}

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sniptail-doctor-'));
  tempDirs.push(dir);
  return dir;
}

function writeTempFile(dir: string, name: string, content = ''): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

function migrationStatus(overrides: Partial<MigrationStatus> = {}): MigrationStatus {
  return {
    driver: 'sqlite',
    expectedMigrations: 3,
    appliedMigrations: 3,
    pendingMigrations: 0,
    isUpToDate: true,
    isAhead: false,
    ...overrides,
  };
}

function workerPreflightOutput(
  checks = [
    {
      status: 'ok',
      area: 'docker',
      message: 'Docker is not required by configured agent execution modes.',
    },
    {
      status: 'ok',
      area: 'agent',
      message: 'Primary agent preflight passed for codex.',
    },
    {
      status: 'ok',
      area: 'git identity',
      message: 'Git commit identity is configured.',
    },
  ],
): string {
  return JSON.stringify({ checks });
}

function validBotToml(dir: string, extraLines: string[] = []): string {
  return [
    '[core]',
    'queue_driver = "inproc"',
    '',
    '[registry]',
    'db = "sqlite"',
    `path = "${join(dir, 'registry.sqlite')}"`,
    '',
    '[bot]',
    'bot_name = "Sniptail"',
    'primary_agent = "codex"',
    '',
    ...extraLines,
    '',
  ].join('\n');
}

function validWorkerToml(dir: string, extraLines: string[] = []): string {
  return [
    '[core]',
    'queue_driver = "inproc"',
    `job_work_root = "${join(dir, 'jobs')}"`,
    '',
    '[registry]',
    'db = "sqlite"',
    `path = "${join(dir, 'registry.sqlite')}"`,
    '',
    '[worker]',
    'bot_name = "Sniptail"',
    'primary_agent = "codex"',
    `repo_cache_root = "${join(dir, 'repos')}"`,
    '',
    ...extraLines,
    '',
  ].join('\n');
}

function createProgram(): Command {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: (value) => {
      stdout += value;
    },
    writeErr: (value) => {
      stdout += value;
    },
  });
  registerDoctorCommand(program);
  return program;
}

async function runDoctorCommand(args: string[]): Promise<void> {
  if (args.includes('--help')) {
    await createProgram().parseAsync(['doctor', ...args], { from: 'user' });
    return;
  }

  const options: Parameters<typeof runDoctor>[0] = {};
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!option || !value) {
      throw new Error(`Invalid doctor test args: ${args.join(' ')}`);
    }

    if (option === '--scope') options.scope = value;
    else if (option === '--env') options.env = value;
    else if (option === '--bot-config') options.botConfig = value;
    else if (option === '--worker-config') options.workerConfig = value;
    else if (option === '--root') options.root = value;
    else if (option === '--cwd') options.cwd = value;
    else throw new Error(`Unsupported doctor test option: ${option}`);
  }

  await runDoctor(options);
}

describe('doctor command', () => {
  beforeEach(() => {
    hoisted.getDbMigrationStatus.mockReset();
    hoisted.getDbMigrationStatus.mockResolvedValue(migrationStatus());
    hoisted.runRuntimeCapture.mockReset();
    hoisted.runRuntimeCapture.mockResolvedValue({
      exitCode: 0,
      stdout: workerPreflightOutput(),
      stderr: '',
    });
    process.env = createTestEnv();
    stdout = '';
    process.exitCode = originalExitCode;
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      stdout += String(chunk);
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetConfigCaches();
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs = [];
    process.env = { ...originalEnv };
    process.exitCode = originalExitCode;
  });

  it('runs in explicit bot scope', async () => {
    const cwd = createTempDir();
    writeTempFile(cwd, '.env.local', 'SLACK_BOT_TOKEN=x\n');
    writeTempFile(cwd, 'bot.toml', validBotToml(cwd));

    await runDoctorCommand([
      '--scope',
      'bot',
      '--bot-config',
      'bot.toml',
      '--env',
      '.env.local',
      '--cwd',
      cwd,
    ]);

    expect(stdout).toContain('Sniptail Doctor');
    expect(stdout).toContain('Scope: bot');
    expect(stdout).toContain(`Env: ${join(cwd, '.env.local')}`);
    expect(stdout).toContain(`Bot config: ${join(cwd, 'bot.toml')}`);
    expect(stdout).not.toContain('Worker config:');
    expect(stdout).toContain('ok      path resolution  Resolved doctor scope');
    expect(stdout).toContain('ok      env file         Env file exists and parses');
    expect(stdout).toContain('ok      bot config       Config file exists');
    expect(stdout).toContain('ok      bot config       Bot config loaded.');
    expect(stdout).toContain('ok      db/bot           Database migrations are up to date');
    expect(stdout).not.toContain('db/worker');
    expect(hoisted.getDbMigrationStatus).toHaveBeenCalledTimes(1);
    expect(hoisted.runRuntimeCapture).not.toHaveBeenCalled();
    const migrationCalls = hoisted.getDbMigrationStatus.mock.calls as Array<
      [{ registryDriver?: string }, { rootDir?: string }]
    >;
    expect(migrationCalls[0]?.[0].registryDriver).toBe('sqlite');
    // expect(migrationCalls[0]?.[1].rootDir).toBe(resolve(process.cwd(), '../..'));
    expect(process.exitCode).toBe(0);
  });

  it('runs in explicit worker scope', async () => {
    const cwd = createTempDir();
    writeTempFile(cwd, '.env.local', 'REDIS_URL=redis://localhost:6379\n');
    writeTempFile(cwd, 'worker.toml', validWorkerToml(cwd));

    await runDoctorCommand([
      '--scope',
      'worker',
      '--worker-config',
      'worker.toml',
      '--env',
      '.env.local',
      '--cwd',
      cwd,
    ]);

    expect(stdout).toContain('Scope: worker');
    expect(stdout).toContain(`Env: ${join(cwd, '.env.local')}`);
    expect(stdout).toContain(`Worker config: ${join(cwd, 'worker.toml')}`);
    expect(stdout).not.toContain('Bot config:');
    expect(stdout).toContain('ok      worker config    Worker config loaded.');
    expect(stdout).toContain('ok      db/worker        Database migrations are up to date');
    expect(stdout).not.toContain('db/bot');
    expect(hoisted.getDbMigrationStatus).toHaveBeenCalledTimes(1);
    expect(hoisted.runRuntimeCapture).toHaveBeenCalledTimes(1);
    const preflightCalls = hoisted.runRuntimeCapture.mock.calls as Array<
      [
        {
          app?: string;
          entrypoint?: { source?: string; dist?: string };
          configEnvVar?: string;
          configPath?: string;
          envPath?: string;
          cwd?: string;
        },
      ]
    >;
    expect(preflightCalls[0]?.[0].app).toBe('worker');
    expect(preflightCalls[0]?.[0].entrypoint?.source).toBe('src/cli/doctor-preflight.ts');
    expect(preflightCalls[0]?.[0].configEnvVar).toBe('SNIPTAIL_WORKER_CONFIG_PATH');
    expect(preflightCalls[0]?.[0].configPath).toBe(join(cwd, 'worker.toml'));
    expect(process.exitCode).toBe(0);
  });

  it('runs in explicit local scope', async () => {
    const cwd = createTempDir();
    writeTempFile(cwd, '.env.local', 'REDIS_URL=redis://localhost:6379\n');
    writeTempFile(cwd, 'bot.toml', validBotToml(cwd));
    writeTempFile(cwd, 'worker.toml', validWorkerToml(cwd));

    await runDoctorCommand([
      '--scope',
      'local',
      '--bot-config',
      'bot.toml',
      '--worker-config',
      'worker.toml',
      '--env',
      '.env.local',
      '--cwd',
      cwd,
    ]);

    expect(stdout).toContain('Scope: local');
    expect(stdout).toContain(`Bot config: ${join(cwd, 'bot.toml')}`);
    expect(stdout).toContain(`Worker config: ${join(cwd, 'worker.toml')}`);
    expect(stdout).toContain('ok      bot config       Bot config loaded.');
    expect(stdout).toContain('ok      worker config    Worker config loaded.');
    expect(stdout).toContain(
      'ok      db/config        Local scope bot and worker registry targets match.',
    );
    expect(stdout).toContain('ok      db/bot           Database migrations are up to date');
    expect(stdout).toContain('ok      db/worker        Database migrations are up to date');
    expect(hoisted.getDbMigrationStatus).toHaveBeenCalledTimes(2);
    expect(hoisted.runRuntimeCapture).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(0);
  });

  it('infers scopes from explicit config path combinations', async () => {
    const cwd = createTempDir();
    writeTempFile(cwd, 'bot.toml', validBotToml(cwd));
    writeTempFile(cwd, 'worker.toml', validWorkerToml(cwd));

    await runDoctorCommand(['--bot-config', 'bot.toml', '--cwd', cwd]);
    expect(stdout).toContain('Scope: bot');

    stdout = '';
    await runDoctorCommand(['--worker-config', 'worker.toml', '--cwd', cwd]);
    expect(stdout).toContain('Scope: worker');

    stdout = '';
    await runDoctorCommand([
      '--bot-config',
      'bot.toml',
      '--worker-config',
      'worker.toml',
      '--cwd',
      cwd,
    ]);
    expect(stdout).toContain('Scope: local');
  });

  it('infers bot scope from the default bot config file', async () => {
    const cwd = createTempDir();
    writeTempFile(cwd, 'sniptail.bot.toml', validBotToml(cwd));

    await runDoctorCommand(['--cwd', cwd]);

    expect(stdout).toContain('Scope: bot');
    expect(stdout).toContain(`Env: ${join(cwd, '.env')}`);
    expect(stdout).toContain(`Bot config: ${join(cwd, 'sniptail.bot.toml')}`);
    expect(stdout).not.toContain('Worker config:');
    expect(stdout).toContain('ok      env file         No env file found');
    expect(stdout).toContain('ok      bot config       Bot config loaded.');
    expect(process.exitCode).toBe(0);
  });

  it('infers worker scope from the default worker config file', async () => {
    const cwd = createTempDir();
    writeTempFile(cwd, 'sniptail.worker.toml', validWorkerToml(cwd));

    await runDoctorCommand(['--cwd', cwd]);

    expect(stdout).toContain('Scope: worker');
    expect(stdout).toContain(`Worker config: ${join(cwd, 'sniptail.worker.toml')}`);
    expect(stdout).not.toContain('Bot config:');
    expect(stdout).toContain('ok      env file         No env file found');
    expect(stdout).toContain('ok      worker config    Worker config loaded.');
    expect(process.exitCode).toBe(0);
  });

  it('infers local scope from both default config files', async () => {
    const cwd = createTempDir();
    writeTempFile(cwd, 'sniptail.bot.toml', validBotToml(cwd));
    writeTempFile(cwd, 'sniptail.worker.toml', validWorkerToml(cwd));

    await runDoctorCommand(['--cwd', cwd]);

    expect(stdout).toContain('Scope: local');
    expect(stdout).toContain(`Bot config: ${join(cwd, 'sniptail.bot.toml')}`);
    expect(stdout).toContain(`Worker config: ${join(cwd, 'sniptail.worker.toml')}`);
    expect(stdout).toContain('ok      env file         No env file found');
    expect(stdout).toContain(
      'ok      db/config        Local scope bot and worker registry targets match.',
    );
    expect(process.exitCode).toBe(0);
  });

  it('expands root as a config directory shorthand', async () => {
    const cwd = createTempDir();
    const configRoot = join(cwd, 'configs');
    mkdirSync(configRoot);
    writeTempFile(configRoot, 'sniptail.bot.toml', validBotToml(configRoot));
    writeTempFile(configRoot, 'sniptail.worker.toml', validWorkerToml(configRoot));

    await runDoctorCommand(['--root', 'configs', '--cwd', cwd]);

    expect(stdout).toContain('Scope: local');
    expect(stdout).toContain(`Env: ${join(configRoot, '.env')}`);
    expect(stdout).toContain(`Bot config: ${join(configRoot, 'sniptail.bot.toml')}`);
    expect(stdout).toContain(`Worker config: ${join(configRoot, 'sniptail.worker.toml')}`);
    expect(stdout).toContain('ok      env file         No env file found');
    expect(stdout).toContain(
      'ok      db/config        Local scope bot and worker registry targets match.',
    );
    expect(process.exitCode).toBe(0);
  });

  it('fails when an explicit env file is missing', async () => {
    const cwd = createTempDir();
    writeTempFile(cwd, 'sniptail.bot.toml', validBotToml(cwd));

    await runDoctorCommand(['--scope', 'bot', '--env', '.env.missing', '--cwd', cwd]);

    expect(process.exitCode).toBe(1);
    expect(stdout).toContain('fail    env file         Explicit env file does not exist');
  });

  it('uses dotenv parsing semantics for env files', async () => {
    const cwd = createTempDir();
    writeTempFile(
      cwd,
      'sniptail.bot.toml',
      validBotToml(cwd, ['[channels.slack]', 'enabled = true']),
    );
    writeTempFile(
      cwd,
      '.env',
      [
        'SLACK_BOT_TOKEN=xoxb-test',
        'SLACK_APP_TOKEN=xapp-test',
        'SLACK_SIGNING_SECRET=secret-test',
        'IGNORED LINE',
        '',
      ].join('\n'),
    );

    await runDoctorCommand(['--scope', 'bot', '--cwd', cwd]);

    expect(process.exitCode).toBe(0);
    expect(stdout).toContain('ok      env file         Env file exists and parses');
    expect(stdout).toContain('ok      bot config       Bot config loaded.');
  });

  it('checks only bot config in bot scope', async () => {
    const cwd = createTempDir();

    await runDoctorCommand(['--scope', 'bot', '--cwd', cwd]);

    expect(process.exitCode).toBe(1);
    expect(stdout).toContain('fail    bot config       Config file does not exist');
    expect(stdout).not.toContain('worker config');
  });

  it('checks only worker config in worker scope', async () => {
    const cwd = createTempDir();

    await runDoctorCommand(['--scope', 'worker', '--cwd', cwd]);

    expect(process.exitCode).toBe(1);
    expect(stdout).toContain('fail    worker config    Config file does not exist');
    expect(stdout).not.toContain('bot config');
  });

  it('checks both config files in local scope', async () => {
    const cwd = createTempDir();
    writeTempFile(cwd, 'sniptail.bot.toml', validBotToml(cwd));

    await runDoctorCommand(['--scope', 'local', '--cwd', cwd]);

    expect(process.exitCode).toBe(1);
    expect(stdout).toContain('ok      bot config       Config file exists');
    expect(stdout).toContain('fail    worker config    Config file does not exist');
  });

  it('reports invalid TOML as a config load failure', async () => {
    const cwd = createTempDir();
    writeTempFile(cwd, 'sniptail.bot.toml', '[bot\n');

    await runDoctorCommand(['--scope', 'bot', '--cwd', cwd]);

    expect(process.exitCode).toBe(1);
    expect(stdout).toContain('ok      bot config       Config file exists');
    expect(stdout).toContain('fail    bot config       Bot config failed to load:');
    expect(stdout).not.toContain('Error:');
  });

  it.each([
    ['Slack', ['[channels.slack]', 'enabled = true'], 'SLACK_BOT_TOKEN'],
    ['Discord', ['[channels.discord]', 'enabled = true'], 'DISCORD_BOT_TOKEN'],
    ['Telegram', ['[channels.telegram]', 'enabled = true'], 'TELEGRAM_BOT_TOKEN'],
  ])('reports missing %s env required by enabled bot channels', async (_label, lines, envKey) => {
    const cwd = createTempDir();
    writeTempFile(cwd, 'sniptail.bot.toml', validBotToml(cwd, lines));

    await runDoctorCommand(['--scope', 'bot', '--cwd', cwd]);

    expect(process.exitCode).toBe(1);
    expect(stdout).toContain('fail    bot config       Bot config failed to load:');
    expect(stdout).toContain(`Missing required env var: ${envKey}`);
  });

  it.each([
    [
      'invalid primary agent',
      [
        '[core]',
        'queue_driver = "inproc"',
        `job_work_root = "${join(tmpdir(), 'sniptail-jobs')}"`,
        '',
        '[registry]',
        'db = "sqlite"',
        `path = "${join(tmpdir(), 'sniptail-registry.sqlite')}"`,
        '',
        '[worker]',
        'primary_agent = "unknown"',
        `repo_cache_root = "${join(tmpdir(), 'sniptail-repos')}"`,
      ],
      'Invalid PRIMARY_AGENT',
    ],
    [
      'invalid registry driver',
      [
        '[core]',
        'queue_driver = "inproc"',
        `job_work_root = "${join(tmpdir(), 'sniptail-jobs')}"`,
        '',
        '[registry]',
        'db = "invalid"',
        '',
        '[worker]',
        'primary_agent = "codex"',
        `repo_cache_root = "${join(tmpdir(), 'sniptail-repos')}"`,
      ],
      'Invalid SNIPTAIL_REGISTRY_DB',
    ],
    [
      'invalid queue driver',
      [
        '[core]',
        'queue_driver = "invalid"',
        `job_work_root = "${join(tmpdir(), 'sniptail-jobs')}"`,
        '',
        '[registry]',
        'db = "sqlite"',
        `path = "${join(tmpdir(), 'sniptail-registry.sqlite')}"`,
        '',
        '[worker]',
        'primary_agent = "codex"',
        `repo_cache_root = "${join(tmpdir(), 'sniptail-repos')}"`,
      ],
      'Invalid QUEUE_DRIVER',
    ],
    [
      'missing repo cache root',
      [
        '[core]',
        'queue_driver = "inproc"',
        `job_work_root = "${join(tmpdir(), 'sniptail-jobs')}"`,
        '',
        '[registry]',
        'db = "sqlite"',
        `path = "${join(tmpdir(), 'sniptail-registry.sqlite')}"`,
        '',
        '[worker]',
        'primary_agent = "codex"',
      ],
      'Missing required config: REPO_CACHE_ROOT',
    ],
    [
      'missing job work root',
      [
        '[core]',
        'queue_driver = "inproc"',
        '',
        '[registry]',
        'db = "sqlite"',
        `path = "${join(tmpdir(), 'sniptail-registry.sqlite')}"`,
        '',
        '[worker]',
        'primary_agent = "codex"',
        `repo_cache_root = "${join(tmpdir(), 'sniptail-repos')}"`,
      ],
      'Missing required config: JOB_WORK_ROOT',
    ],
  ])('reports %s as a worker config load failure', async (_label, lines, expected) => {
    const cwd = createTempDir();
    writeTempFile(cwd, 'sniptail.worker.toml', lines.join('\n'));

    await runDoctorCommand(['--scope', 'worker', '--cwd', cwd]);

    expect(process.exitCode).toBe(1);
    expect(stdout).toContain('fail    worker config    Worker config failed to load:');
    expect(stdout).toContain(expected);
  });

  it('uses parsed env file values when loading config', async () => {
    const cwd = createTempDir();
    writeTempFile(
      cwd,
      '.env',
      [
        'SLACK_BOT_TOKEN=xoxb-test',
        'SLACK_APP_TOKEN=xapp-test',
        'SLACK_SIGNING_SECRET=secret-test',
        '',
      ].join('\n'),
    );
    writeTempFile(
      cwd,
      'sniptail.bot.toml',
      validBotToml(cwd, ['[channels.slack]', 'enabled = true']),
    );

    await runDoctorCommand(['--scope', 'bot', '--cwd', cwd]);

    expect(process.exitCode).toBe(0);
    expect(stdout).toContain('ok      bot config       Bot config loaded.');
  });

  it('uses config paths from the env file when CLI config paths are omitted', async () => {
    const cwd = createTempDir();
    const configDir = join(cwd, 'configs');
    mkdirSync(configDir);
    const botConfigPath = writeTempFile(configDir, 'bot-from-env.toml', validBotToml(configDir));
    const workerConfigPath = writeTempFile(
      configDir,
      'worker-from-env.toml',
      validWorkerToml(configDir),
    );
    writeTempFile(
      cwd,
      '.env',
      [
        `SNIPTAIL_BOT_CONFIG_PATH=${botConfigPath}`,
        `SNIPTAIL_WORKER_CONFIG_PATH=${workerConfigPath}`,
        '',
      ].join('\n'),
    );

    await runDoctorCommand(['--scope', 'local', '--cwd', cwd]);

    expect(process.exitCode).toBe(0);
    expect(stdout).toContain(`Bot config: ${botConfigPath}`);
    expect(stdout).toContain(`Worker config: ${workerConfigPath}`);
    expect(stdout).toContain('ok      bot config       Bot config loaded.');
    expect(stdout).toContain('ok      worker config    Worker config loaded.');
  });

  it('lets explicit CLI config paths override config paths from the env file', async () => {
    const cwd = createTempDir();
    const envConfigPath = writeTempFile(
      cwd,
      'bot-from-env.toml',
      validBotToml(cwd, ['[channels.slack]', 'enabled = true']),
    );
    const explicitConfigPath = writeTempFile(cwd, 'bot-explicit.toml', validBotToml(cwd));
    writeTempFile(cwd, '.env', `SNIPTAIL_BOT_CONFIG_PATH=${envConfigPath}\n`);

    await runDoctorCommand(['--scope', 'bot', '--bot-config', explicitConfigPath, '--cwd', cwd]);

    expect(process.exitCode).toBe(0);
    expect(stdout).toContain(`Bot config: ${explicitConfigPath}`);
    expect(stdout).toContain('ok      bot config       Bot config loaded.');
    expect(stdout).not.toContain('Missing required env var: SLACK_BOT_TOKEN');
  });

  it('loads provider config from the env-selected worker config path', async () => {
    const cwd = createTempDir();
    const configDir = join(cwd, 'configs');
    mkdirSync(configDir);
    const workerConfigPath = writeTempFile(
      configDir,
      'worker-with-gitlab.toml',
      validWorkerToml(configDir, ['[gitlab]', 'base_url = "https://gitlab.example.com/"']),
    );
    writeTempFile(cwd, '.env', `SNIPTAIL_WORKER_CONFIG_PATH=${workerConfigPath}\n`);
    process.env.GITLAB_TOKEN = 'token-from-shell';

    await runDoctorCommand(['--scope', 'worker', '--cwd', cwd]);

    expect(process.exitCode).toBe(0);
    expect(stdout).toContain(`Worker config: ${workerConfigPath}`);
    expect(stdout).toContain('ok      worker config    Worker config loaded.');
    expect(stdout).not.toContain('GITLAB_BASE_URL is required');
  });

  it('restores doctor env vars after a successful run', async () => {
    const cwd = createTempDir();
    writeTempFile(cwd, '.env', 'GOOD=value\n');
    writeTempFile(cwd, 'sniptail.bot.toml', validBotToml(cwd));

    process.env.DOTENV_CONFIG_PATH = 'original-env';
    process.env.SNIPTAIL_BOT_CONFIG_PATH = 'original-bot';
    delete process.env.SNIPTAIL_WORKER_CONFIG_PATH;
    process.env.GOOD = 'original-good';

    await runDoctorCommand(['--scope', 'bot', '--cwd', cwd]);

    expect(process.exitCode).toBe(0);
    expect(process.env.DOTENV_CONFIG_PATH).toBe('original-env');
    expect(process.env.SNIPTAIL_BOT_CONFIG_PATH).toBe('original-bot');
    expect(process.env.SNIPTAIL_WORKER_CONFIG_PATH).toBeUndefined();
    expect(process.env.GOOD).toBe('original-good');
  });

  it('restores doctor env vars after a failed check run', async () => {
    const cwd = createTempDir();
    writeTempFile(cwd, '.env', 'GOOD=value\n');
    writeTempFile(cwd, 'sniptail.worker.toml', '[worker\n');

    delete process.env.DOTENV_CONFIG_PATH;
    delete process.env.SNIPTAIL_BOT_CONFIG_PATH;
    process.env.SNIPTAIL_WORKER_CONFIG_PATH = 'original-worker';

    await runDoctorCommand(['--scope', 'worker', '--cwd', cwd]);

    expect(process.exitCode).toBe(1);
    expect(process.env.DOTENV_CONFIG_PATH).toBeUndefined();
    expect(process.env.SNIPTAIL_BOT_CONFIG_PATH).toBeUndefined();
    expect(process.env.SNIPTAIL_WORKER_CONFIG_PATH).toBe('original-worker');
  });

  it('isolates config caches across sequential runs', async () => {
    const cwd = createTempDir();
    writeTempFile(cwd, 'first.toml', validBotToml(cwd));
    writeTempFile(cwd, 'second.toml', validBotToml(cwd, ['[channels.slack]', 'enabled = true']));

    await runDoctorCommand(['--scope', 'bot', '--bot-config', 'first.toml', '--cwd', cwd]);
    expect(process.exitCode).toBe(0);

    stdout = '';
    process.exitCode = originalExitCode;
    await runDoctorCommand(['--scope', 'bot', '--bot-config', 'second.toml', '--cwd', cwd]);

    expect(process.exitCode).toBe(1);
    expect(stdout).toContain('Missing required env var: SLACK_BOT_TOKEN');
  });

  it('fails local scope when registry drivers differ', async () => {
    const cwd = createTempDir();
    writeTempFile(cwd, 'sniptail.bot.toml', validBotToml(cwd));
    writeTempFile(
      cwd,
      'sniptail.worker.toml',
      [
        '[core]',
        'queue_driver = "inproc"',
        `job_work_root = "${join(cwd, 'jobs')}"`,
        '',
        '[registry]',
        'db = "redis"',
        'redis_url = "redis://localhost:6379/2"',
        '',
        '[worker]',
        'primary_agent = "codex"',
        `repo_cache_root = "${join(cwd, 'repos')}"`,
        '',
      ].join('\n'),
    );

    await runDoctorCommand(['--scope', 'local', '--cwd', cwd]);

    expect(process.exitCode).toBe(1);
    expect(stdout).toContain(
      'fail    db/config        Local scope bot and worker registry targets differ:',
    );
    expect(stdout).toContain('registry.db');
    expect(stdout).not.toContain('db/bot');
    expect(stdout).not.toContain('db/worker');
    expect(hoisted.getDbMigrationStatus).not.toHaveBeenCalled();
    expect(hoisted.runRuntimeCapture).not.toHaveBeenCalled();
  });

  it('fails local scope when registry URL targets differ without printing secrets', async () => {
    const cwd = createTempDir();
    writeTempFile(
      cwd,
      'sniptail.bot.toml',
      [
        '[core]',
        'queue_driver = "inproc"',
        '',
        '[registry]',
        'db = "pg"',
        'pg_url = "postgres://bot-secret@example.invalid/sniptail"',
        '',
        '[bot]',
        'primary_agent = "codex"',
        '',
      ].join('\n'),
    );
    writeTempFile(
      cwd,
      'sniptail.worker.toml',
      [
        '[core]',
        'queue_driver = "inproc"',
        `job_work_root = "${join(cwd, 'jobs')}"`,
        '',
        '[registry]',
        'db = "pg"',
        'pg_url = "postgres://worker-secret@example.invalid/sniptail"',
        '',
        '[worker]',
        'primary_agent = "codex"',
        `repo_cache_root = "${join(cwd, 'repos')}"`,
        '',
      ].join('\n'),
    );

    await runDoctorCommand(['--scope', 'local', '--cwd', cwd]);

    expect(process.exitCode).toBe(1);
    expect(stdout).toContain('registry.pg_url');
    expect(stdout).not.toContain('bot-secret');
    expect(stdout).not.toContain('worker-secret');
  });

  it('fails local scope when registry namespaces differ', async () => {
    const cwd = createTempDir();
    writeTempFile(
      cwd,
      'sniptail.bot.toml',
      [
        '[core]',
        'queue_driver = "inproc"',
        '',
        '[registry]',
        'db = "sqlite"',
        `path = "${join(cwd, 'registry.sqlite')}"`,
        'namespace = "bot"',
        '',
        '[bot]',
        'primary_agent = "codex"',
        '',
      ].join('\n'),
    );
    writeTempFile(
      cwd,
      'sniptail.worker.toml',
      [
        '[core]',
        'queue_driver = "inproc"',
        `job_work_root = "${join(cwd, 'jobs')}"`,
        '',
        '[registry]',
        'db = "sqlite"',
        `path = "${join(cwd, 'registry.sqlite')}"`,
        'namespace = "worker"',
        '',
        '[worker]',
        'primary_agent = "codex"',
        `repo_cache_root = "${join(cwd, 'repos')}"`,
        '',
      ].join('\n'),
    );

    await runDoctorCommand(['--scope', 'local', '--cwd', cwd]);

    expect(process.exitCode).toBe(1);
    expect(stdout).toContain('registry.namespace');
  });

  it('fails bot scope when bot migrations are pending', async () => {
    const cwd = createTempDir();
    writeTempFile(cwd, 'sniptail.bot.toml', validBotToml(cwd));
    hoisted.getDbMigrationStatus.mockResolvedValueOnce(
      migrationStatus({
        appliedMigrations: 1,
        pendingMigrations: 2,
        isUpToDate: false,
      }),
    );

    await runDoctorCommand(['--scope', 'bot', '--cwd', cwd]);

    expect(process.exitCode).toBe(1);
    expect(stdout).toContain('fail    db/bot           2 pending migration(s) found');
    expect(stdout).toContain('        fix              Run "sniptail db migrate --scope bot".');
  });

  it('fails worker scope when worker migrations are pending', async () => {
    const cwd = createTempDir();
    writeTempFile(cwd, 'sniptail.worker.toml', validWorkerToml(cwd));
    hoisted.getDbMigrationStatus.mockResolvedValueOnce(
      migrationStatus({
        appliedMigrations: 0,
        pendingMigrations: 3,
        isUpToDate: false,
      }),
    );

    await runDoctorCommand(['--scope', 'worker', '--cwd', cwd]);

    expect(process.exitCode).toBe(1);
    expect(stdout).toContain('fail    db/worker        3 pending migration(s) found');
    expect(stdout).toContain('        fix              Run "sniptail db migrate --scope worker".');
  });

  it('reports migration status errors without leaking secret URLs', async () => {
    const cwd = createTempDir();
    writeTempFile(
      cwd,
      'sniptail.bot.toml',
      [
        '[core]',
        'queue_driver = "inproc"',
        '',
        '[registry]',
        'db = "pg"',
        'pg_url = "postgres://bot-secret@example.invalid/sniptail"',
        '',
        '[bot]',
        'primary_agent = "codex"',
        '',
      ].join('\n'),
    );
    hoisted.getDbMigrationStatus.mockRejectedValueOnce(
      new Error('could not connect to postgres://bot-secret@example.invalid/sniptail'),
    );

    await runDoctorCommand(['--scope', 'bot', '--cwd', cwd]);

    expect(process.exitCode).toBe(1);
    expect(stdout).toContain(
      'fail    db/bot           Failed to check migration status for registry.db=pg, target=registry.pg_url:',
    );
    expect(stdout).toContain('[redacted]');
    expect(stdout).not.toContain('bot-secret');
  });

  it('reports redis registry as having no SQL migrations', async () => {
    const cwd = createTempDir();
    writeTempFile(
      cwd,
      'sniptail.worker.toml',
      [
        '[core]',
        'queue_driver = "inproc"',
        `job_work_root = "${join(cwd, 'jobs')}"`,
        '',
        '[registry]',
        'db = "redis"',
        'redis_url = "redis://localhost:6379/2"',
        '',
        '[worker]',
        'primary_agent = "codex"',
        `repo_cache_root = "${join(cwd, 'repos')}"`,
        '',
      ].join('\n'),
    );
    hoisted.getDbMigrationStatus.mockResolvedValueOnce(
      migrationStatus({
        driver: 'redis',
        expectedMigrations: 0,
        appliedMigrations: 0,
        pendingMigrations: 0,
      }),
    );

    await runDoctorCommand(['--scope', 'worker', '--cwd', cwd]);

    expect(process.exitCode).toBe(0);
    expect(stdout).toContain(
      'ok      db/worker        No SQL migrations required for redis registry.',
    );
    expect(stdout).not.toContain('sniptail db migrate');
  });

  it('reports malformed worker preflight JSON as a worker preflight failure', async () => {
    const cwd = createTempDir();
    writeTempFile(cwd, 'sniptail.worker.toml', validWorkerToml(cwd));
    hoisted.runRuntimeCapture.mockResolvedValueOnce({
      exitCode: 0,
      stdout: 'not json',
      stderr: '',
    });

    await runDoctorCommand(['--scope', 'worker', '--cwd', cwd]);

    expect(process.exitCode).toBe(1);
    expect(stdout).toContain(
      'fail    worker preflight  Worker preflight command returned invalid JSON output.',
    );
  });

  it('reports non-zero worker preflight command output as a worker preflight failure', async () => {
    const cwd = createTempDir();
    writeTempFile(cwd, 'sniptail.worker.toml', validWorkerToml(cwd));
    hoisted.runRuntimeCapture.mockResolvedValueOnce({
      exitCode: 1,
      stdout: '',
      stderr: 'worker probe failed',
    });

    await runDoctorCommand(['--scope', 'worker', '--cwd', cwd]);

    expect(process.exitCode).toBe(1);
    expect(stdout).toContain('fail    worker preflight  worker probe failed');
  });

  it('rejects root mixed with explicit file paths', async () => {
    const cwd = createTempDir();
    const configRoot = join(cwd, 'configs');
    mkdirSync(configRoot);

    await expect(
      runDoctorCommand(['--root', 'configs', '--env', '.env.local', '--cwd', cwd]),
    ).rejects.toThrow('--root cannot be combined');
    await expect(
      runDoctorCommand(['--root', 'configs', '--bot-config', 'bot.toml', '--cwd', cwd]),
    ).rejects.toThrow('--root cannot be combined');
    await expect(
      runDoctorCommand(['--root', 'configs', '--worker-config', 'worker.toml', '--cwd', cwd]),
    ).rejects.toThrow('--root cannot be combined');
  });

  it('rejects a missing root directory', async () => {
    const cwd = createTempDir();

    await expect(runDoctorCommand(['--root', 'missing', '--cwd', cwd])).rejects.toThrow(
      '--root must point to an existing directory',
    );
  });

  it('rejects invalid scope values', async () => {
    const cwd = createTempDir();

    await expect(runDoctorCommand(['--scope', 'all', '--cwd', cwd])).rejects.toThrow(
      'Invalid --scope value',
    );
  });

  it('rejects bot scope with a worker config', async () => {
    const cwd = createTempDir();

    await expect(
      runDoctorCommand(['--scope', 'bot', '--worker-config', 'worker.toml', '--cwd', cwd]),
    ).rejects.toThrow('--scope bot cannot be combined with --worker-config');
  });

  it('rejects worker scope with a bot config', async () => {
    const cwd = createTempDir();

    await expect(
      runDoctorCommand(['--scope', 'worker', '--bot-config', 'bot.toml', '--cwd', cwd]),
    ).rejects.toThrow('--scope worker cannot be combined with --bot-config');
  });

  it('prints a fail report when scope cannot be inferred', async () => {
    const cwd = createTempDir();

    await runDoctorCommand(['--cwd', cwd]);

    expect(process.exitCode).toBe(1);
    expect(stdout).toContain('Scope: unknown');
    expect(stdout).toContain('fail    scope    Could not infer doctor scope.');
    expect(stdout).toContain(resolve(cwd, 'sniptail.bot.toml'));
    expect(stdout).toContain(resolve(cwd, 'sniptail.worker.toml'));
  });

  it('shows doctor help with supported options', async () => {
    await expect(runDoctorCommand(['--help'])).rejects.toMatchObject({
      code: 'commander.helpDisplayed',
    });

    expect(stdout).toContain('Usage: program doctor');
    expect(stdout).toContain('--scope <scope>');
    expect(stdout).toContain('--env <path>');
    expect(stdout).toContain('--bot-config <path>');
    expect(stdout).toContain('--worker-config <path>');
    expect(stdout).toContain('--root <path>');
    expect(stdout).not.toContain('--cwd');
  });
});
