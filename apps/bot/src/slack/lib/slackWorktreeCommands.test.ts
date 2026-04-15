import { describe, expect, it } from 'vitest';
import { buildWorktreeCommandsText } from './worktree.js';

const config = {
  botName: 'sniptail',
  repoAllowlist: {
    'repo-1': {
      sshUrl: 'git@example.com:org/repo-1.git',
    },
  },
} as const;

describe('buildWorktreeCommandsText', () => {
  it('uses the recorded origin branch when no per-job branch exists', () => {
    const text = buildWorktreeCommandsText(config as never, {
      mode: 'branch',
      jobId: 'job-2',
      repoKeys: ['repo-1'],
      originBranchByRepo: {
        'repo-1': 'sniptail/job-root',
      },
    });

    expect(text).toContain('git fetch origin sniptail/job-root');
    expect(text).not.toContain('sniptail/job-2');
  });

  it('does not invent a branch name when no published branch is recorded', () => {
    const text = buildWorktreeCommandsText(config as never, {
      mode: 'branch',
      jobId: 'job-3',
      repoKeys: ['repo-1'],
    });

    expect(text).toContain('No published branch recorded for this repo.');
    expect(text).not.toContain('git fetch origin');
  });
});
