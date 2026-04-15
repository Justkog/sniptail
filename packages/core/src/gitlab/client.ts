export type GitLabConfig = {
  baseUrl: string;
  token: string;
};

export type MergeRequestResponse = {
  url: string;
  iid: number;
};

export type MergeRequestSummary = {
  url: string;
  iid: number;
  sourceBranch: string;
  targetBranch: string;
  updatedAt: string;
};

export type CreateProjectResponse = {
  id: number;
  webUrl: string;
  sshUrl: string;
  pathWithNamespace: string;
  defaultBranch?: string;
  name: string;
};

async function requestGitLab(
  config: GitLabConfig,
  path: string,
  body: Record<string, unknown> | null,
  options: {
    method?: 'GET' | 'POST' | 'PUT';
  } = {},
): Promise<Response> {
  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}${path}`, {
    method: options.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      'PRIVATE-TOKEN': config.token,
    },
    body: body ? JSON.stringify(body) : null,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitLab request failed: ${response.status} ${text}`);
  }

  return response;
}

export async function findOpenMergeRequests(options: {
  config: GitLabConfig;
  projectId: number;
  sourceBranch: string;
  targetBranch: string;
}): Promise<MergeRequestSummary[]> {
  const { config, projectId, sourceBranch, targetBranch } = options;
  const search = new URLSearchParams({
    state: 'opened',
    source_branch: sourceBranch,
    target_branch: targetBranch,
    per_page: '100',
    order_by: 'updated_at',
    sort: 'desc',
  });
  const response = await requestGitLab(
    config,
    `/api/v4/projects/${projectId}/merge_requests?${search.toString()}`,
    null,
    { method: 'GET' },
  );
  const data = (await response.json()) as Array<{
    web_url: string;
    iid: number;
    source_branch: string;
    target_branch: string;
    updated_at: string;
  }>;
  return data
    .map((mr) => ({
      url: mr.web_url,
      iid: mr.iid,
      sourceBranch: mr.source_branch,
      targetBranch: mr.target_branch,
      updatedAt: mr.updated_at,
    }))
    .filter((mr) => mr.sourceBranch === sourceBranch && mr.targetBranch === targetBranch);
}

export async function updateMergeRequest(options: {
  config: GitLabConfig;
  projectId: number;
  iid: number;
  title: string;
  description: string;
  labels?: string[];
  reviewerIds?: number[];
}): Promise<MergeRequestResponse> {
  const { config, projectId, iid, title, description, labels, reviewerIds } = options;
  const body: Record<string, unknown> = {
    title,
    description,
  };
  if (labels !== undefined) {
    body.labels = labels.join(',');
  }
  if (reviewerIds !== undefined) {
    body.reviewer_ids = reviewerIds;
  }
  const response = await requestGitLab(
    config,
    `/api/v4/projects/${projectId}/merge_requests/${iid}`,
    body,
    { method: 'PUT' },
  );
  const data = (await response.json()) as { web_url: string; iid: number };
  return {
    url: data.web_url,
    iid: data.iid,
  };
}

export async function createProject(options: {
  config: GitLabConfig;
  name: string;
  path?: string;
  namespaceId?: number;
  description?: string;
  visibility?: 'private' | 'public' | 'internal';
  initializeWithReadme?: boolean;
}): Promise<CreateProjectResponse> {
  const { config, name, path, namespaceId, description, visibility, initializeWithReadme } =
    options;
  const response = await requestGitLab(config, '/api/v4/projects', {
    name,
    path,
    namespace_id: namespaceId,
    description,
    visibility,
    initialize_with_readme: initializeWithReadme,
  });
  const data = (await response.json()) as {
    id: number;
    name: string;
    web_url: string;
    ssh_url_to_repo: string;
    path_with_namespace: string;
    default_branch?: string;
  };
  return {
    id: data.id,
    name: data.name,
    webUrl: data.web_url,
    sshUrl: data.ssh_url_to_repo,
    pathWithNamespace: data.path_with_namespace,
    ...(data.default_branch && { defaultBranch: data.default_branch }),
  };
}

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
