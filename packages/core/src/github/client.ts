export type GitHubConfig = {
  apiBaseUrl: string;
  token: string;
};

export type PullRequestResponse = {
  url: string;
  number: number;
};

export type PullRequestSummary = {
  url: string;
  number: number;
  head: string;
  base: string;
  updatedAt: string;
};

export type CreateRepositoryResponse = {
  url: string;
  sshUrl: string;
  fullName: string;
  defaultBranch?: string;
  owner: string;
  name: string;
};

async function requestGitHub(
  config: GitHubConfig,
  path: string,
  body: Record<string, unknown> | null = null,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  } = {},
): Promise<Response> {
  const response = await fetch(`${config.apiBaseUrl.replace(/\/$/, '')}${path}`, {
    method: options.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      Accept: 'application/vnd.github+json',
    },
    body: body ? JSON.stringify(body) : null,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub PR create failed: ${response.status} ${text}`);
  }

  return response;
}

export async function findOpenPullRequests(options: {
  config: GitHubConfig;
  owner: string;
  repo: string;
  head: string;
  base: string;
}): Promise<PullRequestSummary[]> {
  const { config, owner, repo, head, base } = options;
  const search = new URLSearchParams({
    state: 'open',
    base,
    per_page: '100',
  });
  const response = await requestGitHub(
    config,
    `/repos/${owner}/${repo}/pulls?${search.toString()}`,
    null,
    { method: 'GET' },
  );
  const data = (await response.json()) as Array<{
    html_url: string;
    number: number;
    updated_at: string;
    head?: { ref?: string };
    base?: { ref?: string };
  }>;
  return data
    .map((pr) => ({
      url: pr.html_url,
      number: pr.number,
      head: pr.head?.ref ?? '',
      base: pr.base?.ref ?? '',
      updatedAt: pr.updated_at,
    }))
    .filter((pr) => pr.head === head && pr.base === base);
}

export async function updatePullRequest(options: {
  config: GitHubConfig;
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
}): Promise<PullRequestResponse> {
  const { config, owner, repo, number, title, body } = options;
  const response = await requestGitHub(
    config,
    `/repos/${owner}/${repo}/pulls/${number}`,
    {
      title,
      body,
    },
    { method: 'PATCH' },
  );
  const prData = (await response.json()) as { html_url: string; number: number };
  return {
    url: prData.html_url,
    number: prData.number,
  };
}

export async function replacePullRequestLabels(options: {
  config: GitHubConfig;
  owner: string;
  repo: string;
  number: number;
  labels: string[];
}): Promise<void> {
  const { config, owner, repo, number, labels } = options;
  await requestGitHub(
    config,
    `/repos/${owner}/${repo}/issues/${number}/labels`,
    {
      labels,
    },
    { method: 'PUT' },
  );
}

async function listRequestedReviewers(options: {
  config: GitHubConfig;
  owner: string;
  repo: string;
  number: number;
}): Promise<string[]> {
  const { config, owner, repo, number } = options;
  const response = await requestGitHub(
    config,
    `/repos/${owner}/${repo}/pulls/${number}/requested_reviewers`,
    null,
    { method: 'GET' },
  );
  const data = (await response.json()) as {
    users?: Array<{ login?: string }>;
  };
  return (data.users ?? []).map((user) => user.login ?? '').filter(Boolean);
}

export async function syncPullRequestReviewers(options: {
  config: GitHubConfig;
  owner: string;
  repo: string;
  number: number;
  reviewers: string[];
}): Promise<void> {
  const { config, owner, repo, number, reviewers } = options;
  const current = await listRequestedReviewers({ config, owner, repo, number });
  const desired = Array.from(new Set(reviewers.filter(Boolean)));
  const currentSet = new Set(current);
  const desiredSet = new Set(desired);
  const toAdd = desired.filter((reviewer) => !currentSet.has(reviewer));
  const toRemove = current.filter((reviewer) => !desiredSet.has(reviewer));

  if (toAdd.length > 0) {
    await requestGitHub(config, `/repos/${owner}/${repo}/pulls/${number}/requested_reviewers`, {
      reviewers: toAdd,
    });
  }

  if (toRemove.length > 0) {
    await requestGitHub(
      config,
      `/repos/${owner}/${repo}/pulls/${number}/requested_reviewers`,
      {
        reviewers: toRemove,
      },
      { method: 'DELETE' },
    );
  }
}

export async function createRepository(options: {
  config: GitHubConfig;
  name: string;
  owner?: string;
  description?: string;
  private?: boolean;
  autoInit?: boolean;
}): Promise<CreateRepositoryResponse> {
  const { config, name, owner, description, private: isPrivate, autoInit } = options;
  const path = owner ? `/orgs/${owner}/repos` : '/user/repos';
  const response = await requestGitHub(config, path, {
    name,
    description,
    private: isPrivate,
    auto_init: autoInit,
  });
  const data = (await response.json()) as {
    html_url: string;
    ssh_url: string;
    full_name: string;
    default_branch?: string;
    owner?: { login?: string };
    name?: string;
  };
  return {
    url: data.html_url,
    sshUrl: data.ssh_url,
    fullName: data.full_name,
    ...(data.default_branch && { defaultBranch: data.default_branch }),
    owner: data.owner?.login ?? owner ?? '',
    name: data.name ?? name,
  };
}

export async function createPullRequest(options: {
  config: GitHubConfig;
  owner: string;
  repo: string;
  head: string;
  base: string;
  title: string;
  body: string;
  labels?: string[];
  reviewers?: string[];
}): Promise<PullRequestResponse> {
  const { config, owner, repo, head, base, title, body, labels, reviewers } = options;

  const prResponse = await requestGitHub(config, `/repos/${owner}/${repo}/pulls`, {
    title,
    head,
    base,
    body,
  });

  const prData = (await prResponse.json()) as { html_url: string; number: number };

  if (labels && labels.length) {
    await replacePullRequestLabels({
      config,
      owner,
      repo,
      number: prData.number,
      labels,
    });
  }

  await syncPullRequestReviewers({
    config,
    owner,
    repo,
    number: prData.number,
    reviewers: reviewers ?? [],
  });

  return {
    url: prData.html_url,
    number: prData.number,
  };
}
