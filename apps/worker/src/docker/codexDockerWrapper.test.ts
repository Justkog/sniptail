import { execFile } from 'node:child_process';
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const wrapperPath = resolve(process.cwd(), 'apps/worker/scripts/codex-docker.sh');

type WrapperFixture = {
  rootDir: string;
  fakeBinDir: string;
  hostHome: string;
  workspaceDir: string;
  addDir: string;
  imagePath: string;
  schemaPath: string;
};

async function createWrapperFixture(): Promise<WrapperFixture> {
  const rootDir = await mkdtemp(join(os.tmpdir(), 'sniptail-codex-docker-wrapper-'));
  const fakeBinDir = join(rootDir, 'bin');
  const hostHome = join(rootDir, 'home');
  const workspaceDir = join(rootDir, 'workspace');
  const addDir = join(rootDir, 'add-dir');
  const imagePath = join(rootDir, 'diagram.png');
  const schemaPath = join(rootDir, 'schema.json');

  await mkdir(fakeBinDir, { recursive: true });
  await mkdir(hostHome, { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(addDir, { recursive: true });
  await writeFile(imagePath, 'image');
  await writeFile(schemaPath, '{"type":"object"}');

  const fakeDockerPath = join(fakeBinDir, 'docker');
  await writeFile(
    fakeDockerPath,
    '#!/usr/bin/env bash\nset -euo pipefail\nprintf \'%s\\n\' \"$@\"\n',
  );
  await chmod(fakeDockerPath, 0o755);

  return {
    rootDir,
    fakeBinDir,
    hostHome,
    workspaceDir,
    addDir,
    imagePath,
    schemaPath,
  };
}

async function runWrapper(
  fixture: WrapperFixture,
  filesystemMode: 'readonly' | 'writable',
): Promise<string[]> {
  const { stdout } = await execFileAsync(
    wrapperPath,
    [
      'exec',
      '--cd',
      fixture.workspaceDir,
      '--add-dir',
      fixture.addDir,
      '--image',
      fixture.imagePath,
      '--output-schema',
      fixture.schemaPath,
      'Reply with OK',
    ],
    {
      env: {
        ...process.env,
        PATH: `${fixture.fakeBinDir}:${process.env.PATH}`,
        CODEX_DOCKER_HOST_HOME: fixture.hostHome,
        CODEX_DOCKER_FILESYSTEM_MODE: filesystemMode,
      },
    },
  );

  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

describe('codex-docker wrapper', () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(
      cleanupPaths.splice(0, cleanupPaths.length).map((path) =>
        rm(path, { recursive: true, force: true }),
      ),
    );
  });

  it('uses read-only docker mounts for readonly filesystem mode', async () => {
    const fixture = await createWrapperFixture();
    cleanupPaths.push(fixture.rootDir);

    const args = await runWrapper(fixture, 'readonly');

    expect(args).toContain('run');
    expect(args).toContain('--read-only');
    expect(args.filter((arg) => arg === '--tmpfs')).toHaveLength(2);
    expect(args).toContain('/tmp');
    expect(args).toContain('/home/codex/.cache');
    expect(args).toContain(`-v`);
    expect(args).toContain(`${fixture.workspaceDir}:${fixture.workspaceDir}:ro`);
    expect(args).toContain(`${fixture.addDir}:${fixture.addDir}:ro`);
    expect(args).toContain(`${fixture.imagePath}:${fixture.imagePath}:ro`);
    expect(args).toContain(`${fixture.schemaPath}:${fixture.schemaPath}:ro`);
    expect(args).toContain(`${fixture.hostHome}/.codex:/home/codex/.codex`);
  });

  it('keeps writable workspace mounts for writable filesystem mode', async () => {
    const fixture = await createWrapperFixture();
    cleanupPaths.push(fixture.rootDir);

    const args = await runWrapper(fixture, 'writable');

    expect(args).toContain('run');
    expect(args).not.toContain('--read-only');
    expect(args.filter((arg) => arg === '--tmpfs')).toHaveLength(0);
    expect(args).toContain(`${fixture.workspaceDir}:${fixture.workspaceDir}`);
    expect(args).not.toContain(`${fixture.workspaceDir}:${fixture.workspaceDir}:ro`);
    expect(args).toContain(`${fixture.addDir}:${fixture.addDir}:ro`);
    expect(args).toContain(`${fixture.hostHome}/.codex:/home/codex/.codex`);
  });
});
