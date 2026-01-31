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

  const source = repo.localPath ?? repo.sshUrl;
  if (!source) {
    throw new Error(`Repo ${repoKey} missing sshUrl or localPath.`);
  }

  if (!existsSync(clonePath)) {
    await runCommand('git', ['clone', '--single-branch', '-b', gitRef, source, clonePath], common);
  } else {
    const fetchRefspec = `${gitRef}:refs/remotes/origin/${gitRef}`;
    const fetchResult = await runCommand('git', ['fetch', '--prune', 'origin', fetchRefspec], {
      ...common,
      cwd: clonePath,
      allowFailure: true,
    });
    if ((fetchResult.exitCode ?? 1) !== 0) {
      const stderr = fetchResult.stderr ?? '';
      const missingRemoteRef = stderr.includes("couldn't find remote ref");
      const cannotLockRef =
        stderr.includes('cannot lock ref') && stderr.includes(`refs/remotes/origin/${gitRef}`);
      if (cannotLockRef) {
        await runCommand('git', ['update-ref', '-d', `refs/remotes/origin/${gitRef}`], {
          ...common,
          cwd: clonePath,
          allowFailure: true,
        });
        const retryResult = await runCommand('git', ['fetch', '--prune', 'origin', fetchRefspec], {
          ...common,
          cwd: clonePath,
          allowFailure: true,
        });
        if ((retryResult.exitCode ?? 1) === 0) {
          return;
        }
      }
      if (!missingRemoteRef) {
        throw new Error(
          `git fetch failed (${fetchResult.exitCode ?? 'unknown'}): ${stderr.trim()}`,
        );
      }
    }
  }

  const remoteRef = `refs/remotes/origin/${gitRef}`;
  const remoteRefCheck = await runCommand('git', ['show-ref', '--verify', remoteRef], {
    ...common,
    cwd: clonePath,
    allowFailure: true,
  });

  if ((remoteRefCheck.exitCode ?? 1) === 0) {
    const headRef = await runCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      ...common,
      cwd: clonePath,
      allowFailure: true,
    });
    const currentBranch = headRef.stdout.trim();
    if (currentBranch === gitRef) {
      await runCommand('git', ['reset', '--hard', remoteRef], {
        ...common,
        cwd: clonePath,
      });
    } else {
      await runCommand('git', ['branch', '--force', gitRef, remoteRef], {
        ...common,
        cwd: clonePath,
      });
    }
    return;
  }

  const localRef = `refs/heads/${gitRef}`;
  const localRefCheck = await runCommand('git', ['show-ref', '--verify', localRef], {
    ...common,
    cwd: clonePath,
    allowFailure: true,
  });

  if ((localRefCheck.exitCode ?? 1) !== 0) {
    throw new Error(`Branch not found in clone: ${gitRef}`);
  }
}
