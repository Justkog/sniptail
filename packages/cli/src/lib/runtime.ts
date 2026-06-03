import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, normalize, resolve, sep } from 'node:path';
import dotenv from 'dotenv';
import { runNode, runNodeCapture, type RunNodeCaptureResult } from './exec.js';
import { pathExists, pathIsDirectory, resolveOptionalPath, resolveSniptailRoot } from './paths.js';

type RuntimeEntrypoint = {
  source: string;
  dist: string;
};

type RuntimeEntrypointMode = 'source' | 'dist';

type RuntimeOptions = {
  app: 'bot' | 'worker' | 'local';
  entrypoint: RuntimeEntrypoint;
  configEnvVar: 'SNIPTAIL_BOT_CONFIG_PATH' | 'SNIPTAIL_WORKER_CONFIG_PATH';
  configPath?: string;
  envPath?: string;
  cwd?: string;
  root?: string;
  dryRun?: boolean;
  args?: string[];
  envOverrides?: NodeJS.ProcessEnv;
  launcherModuleUrl?: string;
};

type ResolvedRuntime = {
  root: string;
  appDir: string;
  entryPath: string;
  entrypointMode: RuntimeEntrypointMode;
  envPath?: string;
};

function normalizePathSegments(path: string): string {
  return normalize(path).split(sep).join('/');
}

function inferEntrypointModeFromModuleUrl(moduleUrl: string): RuntimeEntrypointMode | undefined {
  const modulePath = normalizePathSegments(fileURLToPath(moduleUrl));
  if (modulePath.includes('/packages/cli/src/')) {
    return 'source';
  }
  if (modulePath.includes('/packages/cli/dist/')) {
    return 'dist';
  }
  return undefined;
}

function resolveEntrypointMode(moduleUrl: string): RuntimeEntrypointMode {
  const override = process.env.SNIPTAIL_RUNTIME_ENTRYPOINT_MODE?.trim();
  if (override) {
    if (override === 'source' || override === 'dist') {
      return override;
    }
    throw new Error('Invalid SNIPTAIL_RUNTIME_ENTRYPOINT_MODE. Expected "source" or "dist".');
  }
  return inferEntrypointModeFromModuleUrl(moduleUrl) ?? 'dist';
}

function buildChildEnv(
  options: RuntimeOptions,
  root: string,
  envPath: string | undefined,
  baseCwd: string,
): NodeJS.ProcessEnv {
  const parsedEnv = envPath && pathExists(envPath) ? dotenv.parse(readFileSync(envPath)) : {};

  const childEnv: NodeJS.ProcessEnv = {
    SNIPTAIL_ROOT: root,
    ...(options.dryRun ? { SNIPTAIL_DRY_RUN: '1' } : {}),
    ...parsedEnv,
    ...(options.configPath ? { [options.configEnvVar]: resolve(baseCwd, options.configPath) } : {}),
    ...(options.envOverrides ? options.envOverrides : {}),
  };

  if (envPath && pathExists(envPath)) {
    childEnv.DOTENV_CONFIG_PATH = envPath;
  }

  return childEnv;
}

export function resolveRuntime(options: RuntimeOptions): ResolvedRuntime {
  const baseCwd = resolve(options.cwd ?? process.cwd());
  const root = resolveSniptailRoot({
    cwd: baseCwd,
    ...(options.root ? { root: options.root } : {}),
  });
  const appDir = join(root, 'apps', options.app);
  const entrypointMode = resolveEntrypointMode(options.launcherModuleUrl ?? import.meta.url);
  const entryPath = join(appDir, options.entrypoint[entrypointMode]);

  if (!pathExists(entryPath)) {
    if (entrypointMode === 'source') {
      throw new Error(`${options.app} source entrypoint not found at ${entryPath}.`);
    }
    throw new Error(`${options.app} build not found at ${entryPath}. Run "pnpm run build" first.`);
  }

  const resolvedEnvPath = resolveOptionalPath(
    options.envPath ? baseCwd : root,
    options.envPath ?? '.env',
  );
  const envPath =
    resolvedEnvPath && pathIsDirectory(resolvedEnvPath)
      ? resolve(resolvedEnvPath, '.env')
      : resolvedEnvPath;

  return {
    root,
    appDir,
    entryPath,
    entrypointMode,
    ...(envPath ? { envPath } : {}),
  };
}

export async function runRuntime(options: RuntimeOptions): Promise<void> {
  const { root, appDir, entryPath, envPath } = resolveRuntime(options);
  const baseCwd = resolve(options.cwd ?? process.cwd());
  const childEnv = buildChildEnv(options, root, envPath, baseCwd);

  await runNode(entryPath, {
    cwd: appDir,
    env: childEnv,
    nodeArgs: ['--import', join(root, 'scripts', 'register-loaders.mjs')],
    ...(options.args ? { args: options.args } : {}),
  });
}

export async function runRuntimeCapture(options: RuntimeOptions): Promise<RunNodeCaptureResult> {
  const { root, appDir, entryPath, envPath } = resolveRuntime(options);
  const baseCwd = resolve(options.cwd ?? process.cwd());
  const childEnv = buildChildEnv(options, root, envPath, baseCwd);

  return runNodeCapture(entryPath, {
    cwd: appDir,
    env: childEnv,
    nodeArgs: ['--import', join(root, 'scripts', 'register-loaders.mjs')],
    ...(options.args ? { args: options.args } : {}),
  });
}
