import type { GitHubConfig } from '../github/client.js';
import type { GitLabConfig } from '../gitlab/client.js';
import type { TomlTable } from './toml.js';
import { resolveStringValue } from './resolve.js';

export function resolveGitHubConfig(githubToml?: TomlTable): GitHubConfig | undefined {
  const token = process.env.GITHUB_API_TOKEN?.trim();
  if (!token) return undefined;
  return {
    apiBaseUrl:
      resolveStringValue('GITHUB_API_BASE_URL', githubToml?.api_base_url, {
        defaultValue: 'https://api.github.com',
      }) || 'https://api.github.com',
    token,
  };
}

export function resolveGitLabConfig(gitlabToml?: TomlTable): GitLabConfig | undefined {
  const gitlabBaseUrl = resolveStringValue('GITLAB_BASE_URL', gitlabToml?.base_url);
  const gitlabToken = process.env.GITLAB_TOKEN?.trim();
  if (gitlabBaseUrl || gitlabToken) {
    if (!gitlabBaseUrl) {
      throw new Error('GITLAB_BASE_URL is required when GITLAB_TOKEN is set.');
    }
    if (!gitlabToken) {
      throw new Error('GITLAB_TOKEN is required when GITLAB_BASE_URL is set.');
    }
    return {
      baseUrl: gitlabBaseUrl,
      token: gitlabToken,
    };
  }
  return undefined;
}
