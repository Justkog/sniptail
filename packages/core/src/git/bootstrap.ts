import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, join } from 'node:path';
import { runCommand } from '../runner/commandRunner.js';

export const defaultLocalBaseBranch = 'main';

export type LocalRepoPathResolution = {
  path: string;
};

export function resolveLocalRepoPath(inputPath: string, repoRoot?: string): LocalRepoPathResolution {
  const trimmed = inputPath.trim();
  if (!trimmed) {
    throw new Error('Local directory path is required.');
  }

  if (repoRoot) {
    if (isAbsolute(trimmed)) {
      throw new Error('Local path must be relative to the configured root.');
    }
    const rootResolved = resolve(repoRoot);
    const fullPath = resolve(rootResolved, trimmed);
    const relativePath = relative(rootResolved, fullPath);
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      throw new Error('Local path must stay within the configured root.');
    }
    return { path: fullPath };
  }

  return { path: isAbsolute(trimmed) ? trimmed : resolve(trimmed) };
}

async function ensureEmptyRepoPath(repoPath: string): Promise<void> {
  try {
    const stats = await stat(repoPath);
    if (!stats.isDirectory()) {
      throw new Error(`Local repo path is not a directory: ${repoPath}`);
    }
    const entries = await readdir(repoPath);
    if (entries.length) {
      throw new Error(`Local repo path already exists and is not empty: ${repoPath}`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
  await mkdir(repoPath, { recursive: true });
}

export async function bootstrapLocalRepository(options: {
  repoPath: string;
  repoName: string;
  baseBranch?: string;
  quickstart?: boolean;
  env?: NodeJS.ProcessEnv;
  logFilePath?: string;
  redact?: Array<string | RegExp>;
}): Promise<void> {
  const {
    repoPath,
    repoName,
    baseBranch = defaultLocalBaseBranch,
    quickstart = false,
    env,
    logFilePath,
    redact,
  } = options;

  await ensureEmptyRepoPath(repoPath);

  try {
    await runCommand('git', ['init', '-b', baseBranch], {
      cwd: repoPath,
      env,
      logFilePath,
      redact,
    });
  } catch {
    await runCommand('git', ['init'], { cwd: repoPath, env, logFilePath, redact });
    await runCommand('git', ['checkout', '-b', baseBranch], {
      cwd: repoPath,
      env,
      logFilePath,
      redact,
    });
  }

  if (quickstart) {
    await writeFile(join(repoPath, 'README.md'), `# ${repoName}\n`, 'utf8');
  }

  await runCommand('git', ['add', '-A'], { cwd: repoPath, env, logFilePath, redact });
  await runCommand(
    'git',
    [
      '-c',
      'user.name=Sniptail',
      '-c',
      'user.email=sniptail@local',
      'commit',
      '--allow-empty',
      '-m',
      'Initial commit',
    ],
    { cwd: repoPath, env, logFilePath, redact },
  );
}
