import type { BotConfig } from '@sniptail/core/config/config.js';

const worktreeBranchPrefix = 'sniptail';

export type WorktreeCommandsTarget =
  | {
      mode: 'branch';
      jobId: string;
      repoKeys: string[];
      branchByRepo?: Record<string, string>;
    }
  | {
      mode: 'base';
      jobId: string;
      repoKeys: string[];
      baseRef: string;
    };

export function buildWorktreeCommandsText(config: BotConfig, target: WorktreeCommandsTarget) {
  const lines: string[] = [
    target.mode === 'branch'
      ? `*Worktree branch commands for job ${target.jobId}*`
      : `*Base branch commands for job ${target.jobId} (${target.baseRef})*`,
  ];
  for (const repoKey of target.repoKeys) {
    const ref =
      target.mode === 'branch'
        ? (target.branchByRepo?.[repoKey] ?? `${worktreeBranchPrefix}/${target.jobId}`)
        : target.baseRef;
    const repoConfig = config.repoAllowlist[repoKey];
    const cloneUrl = repoConfig?.localPath ?? repoConfig?.sshUrl ?? '<repo-url>';

    lines.push('');
    lines.push(`*${repoKey}*`);
    if (!repoConfig) {
      lines.push(`Repo config not found for ${repoKey}.`);
    }
    lines.push('Already cloned:');
    lines.push('```');
    lines.push(`git fetch origin ${ref}`);
    lines.push(`git checkout --track origin/${ref}`);
    lines.push('```');
    lines.push('Not cloned yet:');
    lines.push('```');
    lines.push(`git clone --single-branch -b ${ref} ${cloneUrl}`);
    lines.push('```');
  }
  return lines.join('\n');
}
