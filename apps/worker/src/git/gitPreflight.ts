import { execFileAsync, stringifyError, type ExecFileLike } from '../preflight/common.js';

export async function assertGitCommitIdentityPreflight(
  runExec: ExecFileLike = execFileAsync,
): Promise<void> {
  try {
    await runExec('git', ['var', 'GIT_AUTHOR_IDENT']);
    await runExec('git', ['var', 'GIT_COMMITTER_IDENT']);
  } catch (err) {
    const guidance = [
      'Git preflight failed: this worker cannot resolve a commit author/committer identity.',
      'Implement jobs require `git commit`, which will fail until identity is configured.',
      'Fix options:',
      '1. Configure identity for the worker user:',
      '   git config --global user.name "Your Name"',
      '   git config --global user.email "you@example.com"',
      '2. Or set commit identity via environment variables for the worker process (for example GIT_AUTHOR_NAME/GIT_AUTHOR_EMAIL and GIT_COMMITTER_NAME/GIT_COMMITTER_EMAIL).',
      '3. Verify with: git var GIT_AUTHOR_IDENT',
      `Git error: ${stringifyError(err)}`,
    ].join('\n');
    throw new Error(guidance);
  }
}
