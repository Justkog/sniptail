import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Command } from 'commander';
import dotenv from 'dotenv';
import {
  loadBotConfig,
  loadWorkerConfig,
  resetConfigCaches,
  type BotConfig,
  type CoreConfig,
  type WorkerConfig,
} from '@sniptail/core/config/config.js';
import { getDbMigrationStatus as getCoreDbMigrationStatus } from '@sniptail/core/db/migrations.js';
import {
  formatDoctorReport,
  getDoctorExitCode,
  runDoctorChecks,
  type DoctorCheck,
  type DoctorCheckRunner,
} from '../lib/doctorReport.js';
import { resolveSniptailRoot } from '../lib/paths.js';
import { runRuntimeCapture } from '../lib/runtime.js';

type DoctorScope = 'bot' | 'worker' | 'local';

type DoctorOptions = {
  scope?: string;
  env?: string;
  botConfig?: string;
  workerConfig?: string;
  root?: string;
  cwd?: string;
};

type ResolvedDoctorPaths = {
  scope: DoctorScope;
  cwd: string;
  envPath: string;
  envExplicit: boolean;
  botConfigPath?: string;
  botConfigExplicit: boolean;
  workerConfigPath?: string;
  workerConfigExplicit: boolean;
};

type UnresolvedDoctorPaths = {
  envPath: string;
  botConfigPath: string;
  workerConfigPath: string;
};

type WorkerPreflightPayload = {
  checks: DoctorCheck[];
};

function parseScope(raw: string): DoctorScope {
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'bot' || normalized === 'worker' || normalized === 'local') {
    return normalized;
  }
  throw new Error(`Invalid --scope value: ${raw}. Expected "bot", "worker", or "local".`);
}

function pathIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function pathIsFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function ensureRootIsExclusive(options: DoctorOptions): void {
  if (!options.root) return;
  if (options.env || options.botConfig || options.workerConfig) {
    throw new Error('--root cannot be combined with --env, --bot-config, or --worker-config.');
  }
}

function resolveDoctorFilePaths(options: DoctorOptions): {
  envPath: string;
  botConfigPath: string;
  workerConfigPath: string;
} {
  const baseCwd = resolve(options.cwd ?? process.cwd());

  if (options.root) {
    const configRoot = resolve(baseCwd, options.root);
    if (!pathIsDirectory(configRoot)) {
      throw new Error(`--root must point to an existing directory: ${configRoot}`);
    }
    return {
      envPath: resolve(configRoot, '.env'),
      botConfigPath: resolve(configRoot, 'sniptail.bot.toml'),
      workerConfigPath: resolve(configRoot, 'sniptail.worker.toml'),
    };
  }

  return {
    envPath: resolve(baseCwd, options.env ?? '.env'),
    botConfigPath: resolve(baseCwd, options.botConfig ?? 'sniptail.bot.toml'),
    workerConfigPath: resolve(baseCwd, options.workerConfig ?? 'sniptail.worker.toml'),
  };
}

function inferScope(options: DoctorOptions, paths: UnresolvedDoctorPaths): DoctorScope | undefined {
  if (options.botConfig && options.workerConfig) return 'local';
  if (options.botConfig) return 'bot';
  if (options.workerConfig) return 'worker';

  const hasBotConfig = existsSync(paths.botConfigPath);
  const hasWorkerConfig = existsSync(paths.workerConfigPath);
  if (hasBotConfig && hasWorkerConfig) return 'local';
  if (hasBotConfig) return 'bot';
  if (hasWorkerConfig) return 'worker';
  return undefined;
}

function validateScopeOptions(scope: DoctorScope, options: DoctorOptions): void {
  if (scope === 'bot' && options.workerConfig) {
    throw new Error('--scope bot cannot be combined with --worker-config.');
  }
  if (scope === 'worker' && options.botConfig) {
    throw new Error('--scope worker cannot be combined with --bot-config.');
  }
}

function resolveDoctorPaths(options: DoctorOptions): ResolvedDoctorPaths | undefined {
  ensureRootIsExclusive(options);
  const paths = resolveDoctorFilePaths(options);
  const scope = options.scope ? parseScope(options.scope) : inferScope(options, paths);
  if (!scope) return undefined;

  validateScopeOptions(scope, options);

  return {
    scope,
    cwd: resolve(options.cwd ?? process.cwd()),
    envPath: paths.envPath,
    envExplicit: Boolean(options.env),
    ...(scope === 'bot' || scope === 'local'
      ? { botConfigPath: paths.botConfigPath, botConfigExplicit: Boolean(options.botConfig) }
      : { botConfigExplicit: false }),
    ...(scope === 'worker' || scope === 'local'
      ? {
          workerConfigPath: paths.workerConfigPath,
          workerConfigExplicit: Boolean(options.workerConfig),
        }
      : { workerConfigExplicit: false }),
  };
}

function checkEnvFile(paths: ResolvedDoctorPaths): DoctorCheck {
  if (!existsSync(paths.envPath)) {
    if (paths.envExplicit) {
      return {
        status: 'fail',
        area: 'env file',
        message: `Explicit env file does not exist: ${paths.envPath}`,
        fix: 'Create the env file or remove --env to use process environment and defaults.',
      };
    }
    return {
      status: 'ok',
      area: 'env file',
      message: `No env file found at ${paths.envPath}; using process environment and defaults.`,
    };
  }

  if (!pathIsFile(paths.envPath)) {
    return {
      status: 'fail',
      area: 'env file',
      message: `Env path is not a file: ${paths.envPath}`,
    };
  }

  try {
    dotenv.parse(readFileSync(paths.envPath, 'utf8'));
  } catch (error) {
    return {
      status: 'fail',
      area: 'env file',
      message: `Env file failed to parse: ${getErrorMessage(error)}`,
    };
  }

  return {
    status: 'ok',
    area: 'env file',
    message: `Env file exists and parses: ${paths.envPath}`,
  };
}

function checkConfigFile(area: 'bot config' | 'worker config', path: string): DoctorCheck {
  if (!existsSync(path)) {
    return {
      status: 'fail',
      area,
      message: `Config file does not exist: ${path}`,
    };
  }
  if (!pathIsFile(path)) {
    return {
      status: 'fail',
      area,
      message: `Config path is not a file: ${path}`,
    };
  }
  return {
    status: 'ok',
    area,
    message: `Config file exists: ${path}`,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function loadParsedEnvForDoctor(paths: ResolvedDoctorPaths): Record<string, string> {
  if (!existsSync(paths.envPath) || !pathIsFile(paths.envPath)) return {};

  try {
    return dotenv.parse(readFileSync(paths.envPath, 'utf8'));
  } catch {
    return {};
  }
}

function resolveConfigEnvPath(value: string | undefined, baseCwd: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return resolve(baseCwd, trimmed);
}

function applyParsedEnvConfigPaths(
  paths: ResolvedDoctorPaths,
  parsedEnv: Record<string, string>,
): ResolvedDoctorPaths {
  const botConfigPath =
    paths.botConfigPath && !paths.botConfigExplicit
      ? (resolveConfigEnvPath(parsedEnv.SNIPTAIL_BOT_CONFIG_PATH, paths.cwd) ?? paths.botConfigPath)
      : paths.botConfigPath;
  const workerConfigPath =
    paths.workerConfigPath && !paths.workerConfigExplicit
      ? (resolveConfigEnvPath(parsedEnv.SNIPTAIL_WORKER_CONFIG_PATH, paths.cwd) ??
        paths.workerConfigPath)
      : paths.workerConfigPath;

  return {
    ...paths,
    ...(botConfigPath ? { botConfigPath } : {}),
    ...(workerConfigPath ? { workerConfigPath } : {}),
  };
}

function snapshotEnv(keys: string[]): Record<string, string | undefined> {
  const snapshot: Record<string, string | undefined> = {};
  for (const key of keys) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function applyDoctorEnv(paths: ResolvedDoctorPaths, parsedEnv: Record<string, string>): void {
  for (const [key, value] of Object.entries(parsedEnv)) {
    process.env[key] = value;
  }
  if (existsSync(paths.envPath) && pathIsFile(paths.envPath)) {
    process.env.DOTENV_CONFIG_PATH = paths.envPath;
  }
  if (paths.botConfigPath) {
    process.env.SNIPTAIL_BOT_CONFIG_PATH = paths.botConfigPath;
  }
  if (paths.workerConfigPath) {
    process.env.SNIPTAIL_WORKER_CONFIG_PATH = paths.workerConfigPath;
  }
}

function loadBotConfigCheck(path: string, onLoaded: (config: BotConfig) => void): DoctorCheck[] {
  const fileCheck = checkConfigFile('bot config', path);
  if (fileCheck.status === 'fail') return [fileCheck];

  try {
    const config = loadBotConfig();
    onLoaded(config);
    return [
      fileCheck,
      {
        status: 'ok',
        area: 'bot config',
        message: 'Bot config loaded.',
      },
    ];
  } catch (error) {
    return [
      fileCheck,
      {
        status: 'fail',
        area: 'bot config',
        message: `Bot config failed to load: ${getErrorMessage(error)}`,
      },
    ];
  }
}

function loadWorkerConfigCheck(
  path: string,
  onLoaded: (config: WorkerConfig) => void,
): DoctorCheck[] {
  const fileCheck = checkConfigFile('worker config', path);
  if (fileCheck.status === 'fail') return [fileCheck];

  try {
    const config = loadWorkerConfig();
    onLoaded(config);
    return [
      fileCheck,
      {
        status: 'ok',
        area: 'worker config',
        message: 'Worker config loaded.',
      },
    ];
  } catch (error) {
    return [
      fileCheck,
      {
        status: 'fail',
        area: 'worker config',
        message: `Worker config failed to load: ${getErrorMessage(error)}`,
      },
    ];
  }
}

function getRegistryTargetKeys(config: CoreConfig): string[] {
  if (config.registryDriver === 'sqlite') return ['registry.db', 'registry.path'];
  if (config.registryDriver === 'pg') return ['registry.db', 'registry.pg_url'];
  return ['registry.db', 'registry.redis_url'];
}

function getRegistryTargetValue(config: CoreConfig): string | undefined {
  if (config.registryDriver === 'sqlite') return config.registryPath;
  if (config.registryDriver === 'pg') return config.registryPgUrl;
  return config.registryRedisUrl;
}

type LocalDbConfigComparison = {
  checks: DoctorCheck[];
  matches: boolean;
};

function compareLocalDbConfig(
  botConfig: BotConfig | undefined,
  workerConfig: WorkerConfig | undefined,
): LocalDbConfigComparison {
  if (!botConfig || !workerConfig) {
    return { checks: [], matches: false };
  }

  const differingKeys = new Set<string>();
  if (botConfig.registryDriver !== workerConfig.registryDriver) {
    differingKeys.add('registry.db');
  }
  if (getRegistryTargetValue(botConfig) !== getRegistryTargetValue(workerConfig)) {
    for (const key of getRegistryTargetKeys(botConfig)) differingKeys.add(key);
    for (const key of getRegistryTargetKeys(workerConfig)) differingKeys.add(key);
  }
  if (botConfig.registryNamespace !== workerConfig.registryNamespace) {
    differingKeys.add('registry.namespace');
  }

  if (differingKeys.size > 0) {
    return {
      matches: false,
      checks: [
        {
          status: 'fail',
          area: 'db/config',
          message: `Local scope bot and worker registry targets differ: ${[...differingKeys].sort().join(', ')}.`,
          fix: 'Use one shared registry database for combined local mode, or run separate --scope bot and --scope worker checks for split-host configs.',
        },
      ],
    };
  }

  return {
    matches: true,
    checks: [
      {
        status: 'ok',
        area: 'db/config',
        message: 'Local scope bot and worker registry targets match.',
      },
    ],
  };
}

function getRegistryTargetKey(config: CoreConfig): string {
  if (config.registryDriver === 'sqlite') return 'registry.path';
  if (config.registryDriver === 'pg') return 'registry.pg_url';
  return 'registry.redis_url';
}

function sanitizeMigrationErrorMessage(error: unknown, config: CoreConfig): string {
  let message = getErrorMessage(error);
  const secretValues = [config.registryPgUrl].filter((value): value is string =>
    Boolean(value && value.length),
  );
  for (const secret of secretValues) {
    message = message.split(secret).join('[redacted]');
  }
  return message;
}

function sanitizePreflightMessage(message: string): string {
  return message
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*:[^\s/@]+@/giu, '$1[redacted]@')
    .replace(
      /([?&](?:token|access_token|api_key|apikey|password|secret)=)[^&\s]+/giu,
      '$1[redacted]',
    );
}

function isWorkerPreflightPayload(value: unknown): value is WorkerPreflightPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const checks = (value as { checks?: unknown }).checks;
  if (!Array.isArray(checks)) return false;
  return checks.every((check) => {
    if (!check || typeof check !== 'object' || Array.isArray(check)) return false;
    const payload = check as Record<string, unknown>;
    return (
      (payload.status === 'ok' || payload.status === 'fail') &&
      typeof payload.area === 'string' &&
      typeof payload.message === 'string' &&
      (payload.fix === undefined || typeof payload.fix === 'string')
    );
  });
}

function parseWorkerPreflightPayload(rawOutput: string): DoctorCheck[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    throw new Error('Worker preflight command returned invalid JSON output.');
  }

  if (!isWorkerPreflightPayload(parsed)) {
    throw new Error('Worker preflight command returned an unexpected payload.');
  }

  return parsed.checks.map((check) => ({
    status: check.status,
    area: check.area,
    message: sanitizePreflightMessage(check.message),
    ...(check.fix ? { fix: sanitizePreflightMessage(check.fix) } : {}),
  }));
}

function extractWorkerPreflightError(stderr: string, stdout: string): string {
  const lines = `${stderr}\n${stdout}`
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  return sanitizePreflightMessage(lines[0] ?? 'Worker preflight command failed.');
}

async function checkWorkerPreflights(paths: ResolvedDoctorPaths): Promise<DoctorCheck[]> {
  if (!paths.workerConfigPath) return [];

  let result: Awaited<ReturnType<typeof runRuntimeCapture>>;
  try {
    result = await runRuntimeCapture({
      app: 'worker',
      entrypoint: {
        source: join('src', 'cli', 'doctor-preflight.ts'),
        dist: join('dist', 'cli', 'doctor-preflight.js'),
      },
      configEnvVar: 'SNIPTAIL_WORKER_CONFIG_PATH',
      configPath: paths.workerConfigPath,
      envPath: paths.envPath,
      cwd: paths.cwd,
    });
  } catch (error) {
    return [
      {
        status: 'fail',
        area: 'worker preflight',
        message: sanitizePreflightMessage(getErrorMessage(error)),
      },
    ];
  }

  if (result.exitCode !== 0) {
    return [
      {
        status: 'fail',
        area: 'worker preflight',
        message: extractWorkerPreflightError(result.stderr, result.stdout),
      },
    ];
  }

  try {
    return parseWorkerPreflightPayload(result.stdout.trim());
  } catch (error) {
    return [
      {
        status: 'fail',
        area: 'worker preflight',
        message: getErrorMessage(error),
      },
    ];
  }
}

async function checkDbMigrations(
  scope: 'bot' | 'worker',
  config: CoreConfig,
  cwd: string,
): Promise<DoctorCheck> {
  const area = `db/${scope}`;
  const target = getRegistryTargetKey(config);

  try {
    const rootDir = resolveSniptailRoot({ cwd });
    const status = await getCoreDbMigrationStatus(config, { rootDir });
    if (status.driver === 'redis') {
      return {
        status: 'ok',
        area,
        message: 'No SQL migrations required for redis registry.',
      };
    }

    if (status.pendingMigrations > 0) {
      return {
        status: 'fail',
        area,
        message: `${status.pendingMigrations} pending migration(s) found for ${status.driver} registry.`,
        fix: `Run "sniptail db migrate --scope ${scope}".`,
      };
    }

    return {
      status: 'ok',
      area,
      message: `Database migrations are up to date for ${status.driver} registry.`,
    };
  } catch (error) {
    return {
      status: 'fail',
      area,
      message: `Failed to check migration status for registry.db=${config.registryDriver}, target=${target}: ${sanitizeMigrationErrorMessage(error, config)}`,
    };
  }
}

async function runResolvedDoctorChecks(
  paths: ResolvedDoctorPaths,
  parsedEnv: Record<string, string>,
) {
  const envSnapshot = snapshotEnv([
    'DOTENV_CONFIG_PATH',
    'SNIPTAIL_BOT_CONFIG_PATH',
    'SNIPTAIL_WORKER_CONFIG_PATH',
    ...Object.keys(parsedEnv),
  ]);

  let botConfig: BotConfig | undefined;
  let workerConfig: WorkerConfig | undefined;
  let localDbConfigMatches = paths.scope !== 'local';

  try {
    applyDoctorEnv(paths, parsedEnv);
    resetConfigCaches();
    const checks: DoctorCheckRunner[] = [
      () => ({
        status: 'ok',
        area: 'path resolution',
        message: 'Resolved doctor scope and in-scope env/config paths.',
      }),
      () => checkEnvFile(paths),
    ];
    if (paths.botConfigPath) {
      const botConfigPath = paths.botConfigPath;
      checks.push(() =>
        loadBotConfigCheck(botConfigPath, (config) => {
          botConfig = config;
        }),
      );
    }
    if (paths.workerConfigPath) {
      const workerConfigPath = paths.workerConfigPath;
      checks.push(() =>
        loadWorkerConfigCheck(workerConfigPath, (config) => {
          workerConfig = config;
        }),
      );
    }
    if (paths.scope === 'local') {
      checks.push(() => {
        const comparison = compareLocalDbConfig(botConfig, workerConfig);
        localDbConfigMatches = comparison.matches;
        return comparison.checks;
      });
    }
    if (paths.scope === 'bot' || paths.scope === 'local') {
      checks.push(() => {
        if (!botConfig || !localDbConfigMatches) return [];
        return checkDbMigrations('bot', botConfig, paths.cwd);
      });
    }
    if (paths.scope === 'worker' || paths.scope === 'local') {
      checks.push(() => {
        if (!workerConfig || !localDbConfigMatches) return [];
        return checkDbMigrations('worker', workerConfig, paths.cwd);
      });
      checks.push(() => {
        if (!workerConfig || !localDbConfigMatches) return [];
        return checkWorkerPreflights(paths);
      });
    }

    return await runDoctorChecks(checks);
  } finally {
    resetConfigCaches();
    restoreEnv(envSnapshot);
  }
}

function printResolvedPaths(paths: ResolvedDoctorPaths): void {
  process.stdout.write('Sniptail Doctor\n\n');
  process.stdout.write(`Scope: ${paths.scope}\n`);
  process.stdout.write(`Env: ${paths.envPath}\n`);
  if (paths.botConfigPath) {
    process.stdout.write(`Bot config: ${paths.botConfigPath}\n`);
  }
  if (paths.workerConfigPath) {
    process.stdout.write(`Worker config: ${paths.workerConfigPath}\n`);
  }
  process.stdout.write('\n');
}

function printScopeInferenceFailure(paths: UnresolvedDoctorPaths): void {
  process.stdout.write('Sniptail Doctor\n\n');
  process.stdout.write('Scope: unknown\n');
  process.stdout.write(`Env: ${paths.envPath}\n\n`);

  const checks: DoctorCheck[] = [
    {
      status: 'fail',
      area: 'scope',
      message: 'Could not infer doctor scope. No bot or worker config file found.',
      fix: `Pass --scope with --bot-config or --worker-config, or add ${paths.botConfigPath} or ${paths.workerConfigPath}.`,
    },
  ];
  process.stdout.write(formatDoctorReport(checks));
  process.exitCode = getDoctorExitCode(checks);
}

export async function runDoctor(options: DoctorOptions): Promise<void> {
  const resolved = resolveDoctorPaths(options);
  if (!resolved) {
    printScopeInferenceFailure(resolveDoctorFilePaths(options));
    return;
  }

  const parsedEnv = loadParsedEnvForDoctor(resolved);
  const envResolved = applyParsedEnvConfigPaths(resolved, parsedEnv);
  printResolvedPaths(envResolved);
  const report = await runResolvedDoctorChecks(envResolved, parsedEnv);
  process.stdout.write(formatDoctorReport(report.checks));
  process.exitCode = report.exitCode;
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Run read-only diagnostics for the resolved Sniptail configuration')
    .option('--scope <scope>', 'Diagnostics scope: bot, worker, or local')
    .option('--env <path>', 'Path to .env file')
    .option('--bot-config <path>', 'Path to sniptail.bot.toml')
    .option('--worker-config <path>', 'Path to sniptail.worker.toml')
    .option('--root <path>', 'Alternate Sniptail configuration directory')
    .action(async (options: Omit<DoctorOptions, 'cwd'>) => runDoctor(options));
}
