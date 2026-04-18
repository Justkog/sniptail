const LEGACY_BRANCH_PREFIX = 'sniptail';

export function toGitBranchPrefix(botName: string, fallback = LEGACY_BRANCH_PREFIX): string {
  const normalized = botName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallback;
}

export function buildLegacyJobBranch(jobId: string): string {
  return `${LEGACY_BRANCH_PREFIX}/${jobId}`;
}
