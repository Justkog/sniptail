export type GitLabConfig = {
  baseUrl: string;
  token: string;
};

export type MergeRequestResponse = {
  url: string;
  iid: number;
};

export async function createMergeRequest(options: {
  config: GitLabConfig;
  projectId: number;
  sourceBranch: string;
  targetBranch: string;
  title: string;
  description: string;
  labels?: string[];
  reviewerIds?: number[];
}): Promise<MergeRequestResponse> {
  const { config, projectId, sourceBranch, targetBranch, title, description, labels, reviewerIds } =
    options;

  const body = {
    source_branch: sourceBranch,
    target_branch: targetBranch,
    title,
    description,
    remove_source_branch: true,
    labels: labels?.join(',') || undefined,
    reviewer_ids: reviewerIds && reviewerIds.length ? reviewerIds : undefined,
  };

  const response = await fetch(
    `${config.baseUrl.replace(/\/$/, '')}/api/v4/projects/${projectId}/merge_requests`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'PRIVATE-TOKEN': config.token,
      },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitLab MR create failed: ${response.status} ${text}`);
  }

  const data = (await response.json()) as { web_url: string; iid: number };
  return {
    url: data.web_url,
    iid: data.iid,
  };
}
