import { createPullRequest, type GitHubConfig } from '@sniptail/core/github/client.js';
import { isGitHubSshUrl, parseGitHubRepo } from '@sniptail/core/git/ssh.js';

export async function createGitHubPullRequest(options: {
  config: GitHubConfig;
  sshUrl: string;
  head: string;
  base: string;
  title: string;
  body: string;
  labels?: string[];
  reviewers?: string[];
}): Promise<{ url: string; iid: number }> {
  const { config, sshUrl, head, base, title, body, labels, reviewers } = options;

  if (!isGitHubSshUrl(sshUrl)) {
    throw new Error(`Not a GitHub repo: ${sshUrl}`);
  }

  const repoInfo = parseGitHubRepo(sshUrl);
  if (!repoInfo) {
    throw new Error(`Unable to parse GitHub repo from sshUrl: ${sshUrl}`);
  }

  const pr = await createPullRequest({
    config,
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    head,
    base,
    title,
    body,
    ...(labels ? { labels } : {}),
    ...(reviewers ? { reviewers } : {}),
  });

  return {
    url: pr.url,
    iid: pr.number,
  };
}
