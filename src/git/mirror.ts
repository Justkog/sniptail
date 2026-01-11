import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { runCommand } from '../runner/commandRunner.js';
import type { RepoConfig } from '../types/job.js';

export async function ensureClone(
  repoKey: string,
  repo: RepoConfig,
  clonePath: string,
  logFilePath: string,
  env: NodeJS.ProcessEnv,
  gitRef: string,
  redact: Array<string | RegExp> = [],
): Promise<void> {
  await mkdir(dirname(clonePath), { recursive: true });

  const common = {
    env,
    logFilePath,
    redact,
    timeoutMs: 60_000,
  } as const;

  if (!existsSync(clonePath)) {
    await runCommand('git', ['clone', '--single-branch', '-b', gitRef, repo.sshUrl, clonePath], common);
  } else {
    await runCommand('git', ['fetch', '--prune', 'origin', gitRef], { ...common, cwd: clonePath });
  }

  const localRef = `refs/heads/${gitRef}`;
  const remoteRef = `refs/remotes/origin/${gitRef}`;
  const localRefCheck = await runCommand(
    'git',
    ['show-ref', '--verify', localRef],
    {
      ...common,
      cwd: clonePath,
      allowFailure: true,
    },
  );

  if ((localRefCheck.exitCode ?? 1) !== 0) {
    const remoteRefCheck = await runCommand('git', ['show-ref', '--verify', remoteRef], {
      ...common,
      cwd: clonePath,
      allowFailure: true,
    });

    if ((remoteRefCheck.exitCode ?? 1) !== 0) {
      throw new Error(`Branch not found in clone: ${gitRef}`);
    }

    await runCommand('git', ['branch', '--force', gitRef, remoteRef], {
      ...common,
      cwd: clonePath,
    });
  }
}
