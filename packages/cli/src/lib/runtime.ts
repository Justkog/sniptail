import { join, resolve } from 'node:path';
import { runNode, runNodeCapture, type RunNodeCaptureResult } from './exec.js';
import { pathExists, pathIsDirectory, resolveOptionalPath, resolveSniptailRoot } from './paths.js';

type RuntimeOptions = {
  app: 'bot' | 'worker' | 'local';
  entry: string;
  configEnvVar: 'SNIPTAIL_BOT_CONFIG_PATH' | 'SNIPTAIL_WORKER_CONFIG_PATH';
  configPath?: string;
  envPath?: string;
  cwd?: string;
  root?: string;
  dryRun?: boolean;
  args?: string[];
  envOverrides?: NodeJS.ProcessEnv;
};

type ResolvedRuntime = {
  root: string;
  appDir: string;
  entryPath: string;
  envPath?: string;
};

export function resolveRuntime(options: RuntimeOptions): ResolvedRuntime {
  const baseCwd = resolve(options.cwd ?? process.cwd());
  const root = resolveSniptailRoot({
    cwd: baseCwd,
    ...(options.root ? { root: options.root } : {}),
  });
  const appDir = join(root, 'apps', options.app);
  const entryPath = join(appDir, options.entry);

  if (!pathExists(entryPath)) {
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
    ...(envPath ? { envPath } : {}),
  };
}

export async function runRuntime(options: RuntimeOptions): Promise<void> {
  const { root, appDir, entryPath, envPath } = resolveRuntime(options);
  const baseCwd = resolve(options.cwd ?? process.cwd());

  const childEnv: NodeJS.ProcessEnv = {
    SNIPTAIL_ROOT: root,
    ...(options.dryRun ? { SNIPTAIL_DRY_RUN: '1' } : {}),
    ...(options.configPath ? { [options.configEnvVar]: resolve(baseCwd, options.configPath) } : {}),
    ...(options.envOverrides ? options.envOverrides : {}),
  };

  if (envPath && pathExists(envPath)) {
    childEnv.DOTENV_CONFIG_PATH = envPath;
  }

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

  const childEnv: NodeJS.ProcessEnv = {
    SNIPTAIL_ROOT: root,
    ...(options.dryRun ? { SNIPTAIL_DRY_RUN: '1' } : {}),
    ...(options.configPath ? { [options.configEnvVar]: resolve(baseCwd, options.configPath) } : {}),
    ...(options.envOverrides ? options.envOverrides : {}),
  };

  if (envPath && pathExists(envPath)) {
    childEnv.DOTENV_CONFIG_PATH = envPath;
  }

  return runNodeCapture(entryPath, {
    cwd: appDir,
    env: childEnv,
    nodeArgs: ['--import', join(root, 'scripts', 'register-loaders.mjs')],
    ...(options.args ? { args: options.args } : {}),
  });
}
