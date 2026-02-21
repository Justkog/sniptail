import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveWorkerAgentScriptPath } from './resolveWorkerAgentScriptPath.js';

const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
});

function createScript(rootDir: string, relativePath: string): string {
  const filePath = join(rootDir, relativePath);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, '#!/usr/bin/env bash\necho ok\n', 'utf8');
  return filePath;
}

describe('resolveWorkerAgentScriptPath', () => {
  it('resolves worker scripts from SNIPTAIL_ROOT when set', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'sniptail-root-'));
    const scriptPath = createScript(rootDir, 'apps/worker/scripts/codex-docker.sh');
    process.env.SNIPTAIL_ROOT = rootDir;

    const resolvedPath = resolveWorkerAgentScriptPath('codex-docker.sh');

    expect(resolvedPath).toBe(scriptPath);
  });

  it('resolves worker scripts from apps/local cwd without SNIPTAIL_ROOT', () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'sniptail-local-'));
    const localDir = join(workspaceDir, 'apps', 'local');
    mkdirSync(localDir, { recursive: true });
    const scriptPath = createScript(workspaceDir, 'apps/worker/scripts/codex-docker.sh');
    process.chdir(localDir);

    const resolvedPath = resolveWorkerAgentScriptPath('codex-docker.sh');

    expect(resolvedPath).toBe(scriptPath);
  });

  it('throws with attempted paths when script cannot be resolved', () => {
    const workspaceDir = mkdtempSync(join(tmpdir(), 'sniptail-missing-'));
    process.chdir(workspaceDir);

    expect(() => resolveWorkerAgentScriptPath('missing.sh')).toThrow(
      /Could not resolve worker runtime script "missing\.sh"\./,
    );
    expect(() => resolveWorkerAgentScriptPath('missing.sh')).toThrow(/Tried:/);
  });
});
