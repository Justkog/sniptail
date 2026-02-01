import { createMergeRequest, type GitLabConfig } from '@sniptail/core/gitlab/client.js';

export async function createGitLabMergeRequest(options: {
  config: GitLabConfig;
  projectId: number;
  sourceBranch: string;
  targetBranch: string;
  title: string;
  description: string;
  labels?: string[];
  reviewerIds?: number[];
}): Promise<{ url: string; iid: number }> {
  const { config, projectId, sourceBranch, targetBranch, title, description, labels, reviewerIds } =
    options;

  const mr = await createMergeRequest({
    config,
    projectId,
    sourceBranch,
    targetBranch,
    title,
    description,
    ...(labels ? { labels } : {}),
    ...(reviewerIds ? { reviewerIds } : {}),
  });

  return {
    url: mr.url,
    iid: mr.iid,
  };
}
