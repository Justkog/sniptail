import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveRuntime } from './runtime.js';

const originalMode = process.env.SNIPTAIL_RUNTIME_ENTRYPOINT_MODE;
const originalRoot = process.env.SNIPTAIL_ROOT;

function makeRoot(files: string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'sniptail-runtime-'));
  const rootFiles = ['scripts/register-loaders.mjs', 'sniptail.worker.toml', ...files];
  for (const file of rootFiles) {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '', 'utf8');
  }
  return root;
}

function runtimeOptions(root: string, launcherModuleUrl: string) {
  return {
    app: 'worker' as const,
    root,
    launcherModuleUrl,
    entrypoint: {
      source: join('src', 'cli', 'repos.ts'),
      dist: join('dist', 'cli', 'repos.js'),
    },
    configEnvVar: 'SNIPTAIL_WORKER_CONFIG_PATH' as const,
  };
}

describe('resolveRuntime entrypoint mode', () => {
  beforeEach(() => {
    delete process.env.SNIPTAIL_RUNTIME_ENTRYPOINT_MODE;
    delete process.env.SNIPTAIL_ROOT;
  });

  afterEach(() => {
    if (originalMode === undefined) {
      delete process.env.SNIPTAIL_RUNTIME_ENTRYPOINT_MODE;
    } else {
      process.env.SNIPTAIL_RUNTIME_ENTRYPOINT_MODE = originalMode;
    }
    if (originalRoot === undefined) {
      delete process.env.SNIPTAIL_ROOT;
    } else {
      process.env.SNIPTAIL_ROOT = originalRoot;
    }
  });

  it('infers source mode from a CLI source module path', () => {
    const root = makeRoot(['apps/worker/src/cli/repos.ts']);

    const runtime = resolveRuntime(
      runtimeOptions(root, `file://${root}/packages/cli/src/lib/runtime.ts`),
    );

    expect(runtime.entrypointMode).toBe('source');
    expect(runtime.entryPath).toBe(join(root, 'apps', 'worker', 'src', 'cli', 'repos.ts'));
  });

  it('infers dist mode from a CLI dist module path', () => {
    const root = makeRoot(['apps/worker/dist/cli/repos.js']);

    const runtime = resolveRuntime(
      runtimeOptions(root, `file://${root}/packages/cli/dist/lib/runtime.js`),
    );

    expect(runtime.entrypointMode).toBe('dist');
    expect(runtime.entryPath).toBe(join(root, 'apps', 'worker', 'dist', 'cli', 'repos.js'));
  });

  it('lets source mode override module path inference', () => {
    process.env.SNIPTAIL_RUNTIME_ENTRYPOINT_MODE = 'source';
    const root = makeRoot(['apps/worker/src/cli/repos.ts']);

    const runtime = resolveRuntime(
      runtimeOptions(root, `file://${root}/packages/cli/dist/lib/runtime.js`),
    );

    expect(runtime.entrypointMode).toBe('source');
    expect(runtime.entryPath).toBe(join(root, 'apps', 'worker', 'src', 'cli', 'repos.ts'));
  });

  it('lets dist mode override module path inference', () => {
    process.env.SNIPTAIL_RUNTIME_ENTRYPOINT_MODE = 'dist';
    const root = makeRoot(['apps/worker/dist/cli/repos.js']);

    const runtime = resolveRuntime(
      runtimeOptions(root, `file://${root}/packages/cli/src/lib/runtime.ts`),
    );

    expect(runtime.entrypointMode).toBe('dist');
    expect(runtime.entryPath).toBe(join(root, 'apps', 'worker', 'dist', 'cli', 'repos.js'));
  });

  it('rejects invalid entrypoint mode overrides', () => {
    process.env.SNIPTAIL_RUNTIME_ENTRYPOINT_MODE = 'built';
    const root = makeRoot(['apps/worker/dist/cli/repos.js']);

    expect(() =>
      resolveRuntime(runtimeOptions(root, `file://${root}/packages/cli/dist/lib/runtime.js`)),
    ).toThrow('Invalid SNIPTAIL_RUNTIME_ENTRYPOINT_MODE');
  });

  it('does not require dist files in source mode', () => {
    process.env.SNIPTAIL_RUNTIME_ENTRYPOINT_MODE = 'source';
    const root = makeRoot(['apps/worker/src/cli/repos.ts']);

    expect(() =>
      resolveRuntime(runtimeOptions(root, `file://${root}/packages/cli/dist/lib/runtime.js`)),
    ).not.toThrow();
  });

  it('keeps the build hint when dist mode is missing its entrypoint', () => {
    process.env.SNIPTAIL_RUNTIME_ENTRYPOINT_MODE = 'dist';
    const root = makeRoot(['apps/worker/src/cli/repos.ts']);

    expect(() =>
      resolveRuntime(runtimeOptions(root, `file://${root}/packages/cli/src/lib/runtime.ts`)),
    ).toThrow('Run "pnpm run build" first.');
  });

  it('uses a source-specific error when source mode is missing its entrypoint', () => {
    process.env.SNIPTAIL_RUNTIME_ENTRYPOINT_MODE = 'source';
    const root = makeRoot(['apps/worker/dist/cli/repos.js']);

    expect(() =>
      resolveRuntime(runtimeOptions(root, `file://${root}/packages/cli/dist/lib/runtime.js`)),
    ).toThrow('worker source entrypoint not found');
  });
});
