import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveAgentWorkspace } from './workspaceResolver.js';

describe('resolveAgentWorkspace', () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(
      cleanupPaths
        .splice(0, cleanupPaths.length)
        .map((pathValue) => rm(pathValue, { recursive: true, force: true })),
    );
  });

  async function createWorkspaceRoot(prefix: string): Promise<string> {
    const root = await mkdtemp(join(os.tmpdir(), prefix));
    cleanupPaths.push(root);
    return root;
  }

  it('resolves workspace root when cwd is omitted', async () => {
    const workspaceRoot = await createWorkspaceRoot('sniptail-agent-workspace-root-');
    const result = await resolveAgentWorkspace(
      {
        snatch: {
          path: workspaceRoot,
          label: 'Snatch',
        },
      },
      { workspaceKey: 'snatch' },
    );

    expect(result.workspaceKey).toBe('snatch');
    expect(result.workspaceRoot).toBe(resolve(workspaceRoot));
    expect(result.resolvedCwd).toBe(resolve(workspaceRoot));
    expect(result.relativeCwd).toBeUndefined();
    expect(result.display).toEqual({
      workspaceKey: 'snatch',
      label: 'Snatch',
      name: 'Snatch',
    });
  });

  it('resolves and normalizes nested relative cwd', async () => {
    const workspaceRoot = await createWorkspaceRoot('sniptail-agent-workspace-nested-');
    const result = await resolveAgentWorkspace(
      {
        snatch: {
          path: workspaceRoot,
        },
      },
      { workspaceKey: 'snatch', cwd: './apps//worker/.' },
    );

    expect(isAbsolute(result.resolvedCwd)).toBe(true);
    expect(result.relativeCwd).toBe(join('apps', 'worker'));
    expect(result.display.cwd).toBe('apps/worker');
    expect(result.display.name).toBe('snatch / apps/worker');
  });

  it('rejects unknown workspace key', async () => {
    const workspaceRoot = await createWorkspaceRoot('sniptail-agent-workspace-unknown-');

    await expect(
      resolveAgentWorkspace(
        {
          snatch: { path: workspaceRoot },
        },
        { workspaceKey: 'missing' },
      ),
    ).rejects.toThrow('Unknown workspace key: missing');
  });

  it('rejects absolute cwd values', async () => {
    const workspaceRoot = await createWorkspaceRoot('sniptail-agent-workspace-abs-');

    await expect(
      resolveAgentWorkspace(
        {
          snatch: { path: workspaceRoot },
        },
        { workspaceKey: 'snatch', cwd: '/tmp' },
      ),
    ).rejects.toThrow('Expected a relative path');
  });

  it('rejects lexical cwd escapes', async () => {
    const workspaceRoot = await createWorkspaceRoot('sniptail-agent-workspace-escape-');

    await expect(
      resolveAgentWorkspace(
        {
          snatch: { path: workspaceRoot },
        },
        { workspaceKey: 'snatch', cwd: '../outside' },
      ),
    ).rejects.toThrow('Resolved cwd escapes workspace "snatch".');
  });

  it('allows missing cwd path when requireExists is false', async () => {
    const workspaceRoot = await createWorkspaceRoot('sniptail-agent-workspace-missing-ok-');
    const result = await resolveAgentWorkspace(
      {
        snatch: { path: workspaceRoot },
      },
      { workspaceKey: 'snatch', cwd: 'future/path' },
      { requireExists: false },
    );

    expect(result.relativeCwd).toBe(join('future', 'path'));
    expect(result.display.cwd).toBe('future/path');
  });

  it('rejects missing cwd path when requireExists is true', async () => {
    const workspaceRoot = await createWorkspaceRoot('sniptail-agent-workspace-missing-fail-');

    await expect(
      resolveAgentWorkspace(
        {
          snatch: { path: workspaceRoot },
        },
        { workspaceKey: 'snatch', cwd: 'missing/path' },
        { requireExists: true },
      ),
    ).rejects.toThrow('Resolved cwd for "snatch" does not exist');
  });

  it('rejects cwd path that is not a directory when requireExists is true', async () => {
    const workspaceRoot = await createWorkspaceRoot('sniptail-agent-workspace-file-');
    await writeFile(join(workspaceRoot, 'README.md'), '# hi\n', 'utf8');

    await expect(
      resolveAgentWorkspace(
        {
          snatch: { path: workspaceRoot },
        },
        { workspaceKey: 'snatch', cwd: 'README.md' },
        { requireExists: true },
      ),
    ).rejects.toThrow('is not a directory');
  });

  it('rejects symlink escapes when requireExists is true', async () => {
    const workspaceRoot = await createWorkspaceRoot('sniptail-agent-workspace-symlink-');
    const outsideDir = await createWorkspaceRoot('sniptail-agent-workspace-outside-');
    await mkdir(join(outsideDir, 'repo'), { recursive: true });
    await symlink(join(outsideDir, 'repo'), join(workspaceRoot, 'linked-repo'), 'dir');

    await expect(
      resolveAgentWorkspace(
        {
          snatch: { path: workspaceRoot },
        },
        { workspaceKey: 'snatch', cwd: 'linked-repo' },
        { requireExists: true },
      ),
    ).rejects.toThrow('Resolved cwd escapes workspace "snatch".');
  });

  it('returns display-safe metadata without absolute paths', async () => {
    const workspaceRoot = await createWorkspaceRoot('sniptail-agent-workspace-display-');
    const result = await resolveAgentWorkspace(
      {
        snatch: {
          path: workspaceRoot,
          label: 'Snatch',
          description: 'Main repository',
        },
      },
      { workspaceKey: 'snatch', cwd: 'apps/worker' },
    );

    expect(result.display).toEqual({
      workspaceKey: 'snatch',
      label: 'Snatch',
      description: 'Main repository',
      name: 'Snatch / apps/worker',
      cwd: 'apps/worker',
    });
    expect(JSON.stringify(result.display)).not.toContain(workspaceRoot);
  });
});
