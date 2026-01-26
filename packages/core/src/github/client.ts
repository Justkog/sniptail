export type GitHubConfig = {
  apiBaseUrl: string;
  token: string;
};

export type PullRequestResponse = {
  url: string;
  number: number;
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
): Promise<Response> {
  const response = await fetch(`${config.apiBaseUrl.replace(/\/$/, '')}${path}`, {
    method: 'POST',
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
    await requestGitHub(config, `/repos/${owner}/${repo}/issues/${prData.number}/labels`, {
      labels,
    });
  }

  if (reviewers && reviewers.length) {
    await requestGitHub(
      config,
      `/repos/${owner}/${repo}/pulls/${prData.number}/requested_reviewers`,
      {
        reviewers,
      },
    );
  }

  return {
    url: prData.html_url,
    number: prData.number,
  };
}
