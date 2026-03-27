import type { RepoConfig } from '@sniptail/core/types/job.js';

export function resolveDefaultBaseBranch(
  repoAllowlist: Record<string, RepoConfig>,
  repoKey?: string,
): string {
  if (repoKey) {
    const branch = repoAllowlist[repoKey]?.baseBranch?.trim();
    if (branch) {
      return branch;
    }
  }
  const branches = new Set<string>();
  for (const repo of Object.values(repoAllowlist)) {
    const branch = repo.baseBranch?.trim();
    if (branch) {
      branches.add(branch);
    }
  }
  if (branches.size === 1) {
    return Array.from(branches)[0]!;
  }
  return 'staging';
}
