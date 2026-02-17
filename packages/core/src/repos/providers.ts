import { sanitizeRepoKey } from '../git/keys.js';
import {
  bootstrapLocalRepository,
  defaultLocalBaseBranch,
  resolveLocalRepoPath,
} from '../git/bootstrap.js';
import { parseGitHubRepo } from '../git/ssh.js';
import { createPullRequest, createRepository, type GitHubConfig } from '../github/client.js';
import { createMergeRequest, createProject, type GitLabConfig } from '../gitlab/client.js';
import type { RepoConfig } from '../types/job.js';

export type RepoProviderCapabilities = {
  bootstrap?: boolean;
  reviewRequest?: boolean;
  labels?: boolean;
  reviewers?: boolean;
};

export type ProviderData = Record<string, unknown>;

type SerializeContext = {
  repo: RepoConfig;
};

type DeserializeContext = {
  providerData?: ProviderData;
  legacyProjectId?: number;
};

type ReviewRequestContext = {
  github?: GitHubConfig;
  gitlab?: GitLabConfig;
};

type CreateReviewRequestInput = {
  sshUrl: string;
  providerData?: ProviderData;
  head: string;
  base: string;
  title: string;
  description: string;
  labels?: string[];
  reviewers?: string[];
};

type CreateRepositoryInput = {
  repoName: string;
  owner?: string;
  description?: string;
  visibility?: 'private' | 'public';
  quickstart?: boolean;
  providerData?: ProviderData;
  localPath?: string;
  localRepoRoot?: string;
  env?: NodeJS.ProcessEnv;
};

type CreateRepositoryResult = {
  repoConfig: RepoConfig;
  repoUrl: string;
  repoLabel: string;
};

export type RepoProviderDefinition = {
  id: string;
  displayName: string;
  capabilities: RepoProviderCapabilities;
  serializeProviderData?: (context: SerializeContext) => ProviderData | undefined;
  deserializeProviderData?: (context: DeserializeContext) => ProviderData | undefined;
  validateRepoConfig?: (repo: RepoConfig) => void;
  createReviewRequest?: (
    context: ReviewRequestContext,
    input: CreateReviewRequestInput,
  ) => Promise<{ url: string; iid: number }>;
  createRepository?: (
    context: ReviewRequestContext,
    input: CreateRepositoryInput,
  ) => Promise<CreateRepositoryResult>;
};

function parseProviderProjectId(data?: ProviderData): number | undefined {
  const value = data?.projectId;
  if (typeof value !== 'number') return undefined;
  if (!Number.isFinite(value)) return undefined;
  return Number.isInteger(value) ? value : undefined;
}

const localProvider: RepoProviderDefinition = {
  id: 'local',
  displayName: 'Local',
  capabilities: {
    bootstrap: true,
  },
  validateRepoConfig(repo) {
    if (!repo.localPath) {
      throw new Error('Local repositories require localPath.');
    }
    if (repo.sshUrl) {
      throw new Error('Local repositories must not define sshUrl.');
    }
    if (repo.projectId !== undefined) {
      throw new Error('Local repositories must not define projectId.');
    }
  },
  createRepository: async (_context, input) => {
    const resolved = resolveLocalRepoPath(input.localPath ?? '', input.localRepoRoot);
    await bootstrapLocalRepository({
      repoPath: resolved.path,
      repoName: input.repoName,
      baseBranch: defaultLocalBaseBranch,
      quickstart: Boolean(input.quickstart),
      ...(input.env ? { env: input.env } : {}),
    });
    return {
      repoConfig: {
        provider: 'local',
        localPath: resolved.path,
        baseBranch: defaultLocalBaseBranch,
      },
      repoUrl: resolved.path,
      repoLabel: resolved.path,
    };
  },
};

const githubProvider: RepoProviderDefinition = {
  id: 'github',
  displayName: 'GitHub',
  capabilities: {
    bootstrap: true,
    reviewRequest: true,
    labels: true,
    reviewers: true,
  },
  validateRepoConfig(repo) {
    if (!repo.sshUrl) {
      throw new Error('Remote repositories require sshUrl.');
    }
    if (repo.localPath) {
      throw new Error('Remote repositories must not define localPath.');
    }
    if (repo.projectId !== undefined) {
      throw new Error('GitHub repositories must not define projectId.');
    }
  },
  createReviewRequest: async (context, input) => {
    if (!context.github) {
      throw new Error('GITHUB_API_TOKEN is required to create GitHub pull requests.');
    }
    const repoInfo = parseGitHubRepo(input.sshUrl);
    if (!repoInfo) {
      throw new Error(`Unable to parse GitHub repo from sshUrl: ${input.sshUrl}`);
    }
    const pr = await createPullRequest({
      config: context.github,
      owner: repoInfo.owner,
      repo: repoInfo.repo,
      head: input.head,
      base: input.base,
      title: input.title,
      body: input.description,
      ...(input.labels ? { labels: input.labels } : {}),
      ...(input.reviewers ? { reviewers: input.reviewers } : {}),
    });
    return {
      url: pr.url,
      iid: pr.number,
    };
  },
  createRepository: async (context, input) => {
    if (!context.github) {
      throw new Error('GitHub is not configured. Set GITHUB_API_TOKEN.');
    }
    const repo = await createRepository({
      config: context.github,
      name: input.repoName,
      ...(input.owner !== undefined ? { owner: input.owner } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.visibility !== undefined ? { private: input.visibility === 'private' } : {}),
      autoInit: Boolean(input.quickstart),
    });
    return {
      repoConfig: {
        provider: 'github',
        sshUrl: repo.sshUrl,
        ...(repo.defaultBranch ? { baseBranch: repo.defaultBranch } : {}),
      },
      repoUrl: repo.url,
      repoLabel: repo.fullName,
    };
  },
};

const gitlabProvider: RepoProviderDefinition = {
  id: 'gitlab',
  displayName: 'GitLab',
  capabilities: {
    bootstrap: true,
    reviewRequest: true,
    labels: true,
    reviewers: true,
  },
  serializeProviderData(context) {
    const projectId =
      parseProviderProjectId(context.repo.providerData) ?? context.repo.projectId ?? undefined;
    if (projectId === undefined) return context.repo.providerData;
    return {
      ...(context.repo.providerData ?? {}),
      projectId,
    };
  },
  deserializeProviderData(context) {
    const projectId = parseProviderProjectId(context.providerData) ?? context.legacyProjectId;
    if (projectId === undefined) return context.providerData;
    return {
      ...(context.providerData ?? {}),
      projectId,
    };
  },
  validateRepoConfig(repo) {
    if (!repo.sshUrl) {
      throw new Error('Remote repositories require sshUrl.');
    }
    if (repo.localPath) {
      throw new Error('Remote repositories must not define localPath.');
    }
    const projectId = parseProviderProjectId(repo.providerData) ?? repo.projectId;
    if (projectId === undefined) {
      throw new Error('GitLab repositories require providerData.projectId or projectId.');
    }
  },
  createReviewRequest: async (context, input) => {
    if (!context.gitlab) {
      throw new Error(
        'GITLAB_BASE_URL and GITLAB_TOKEN are required to create GitLab merge requests.',
      );
    }
    const reviewers = (input.reviewers ?? [])
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isFinite(value));
    const projectId = parseProviderProjectId(input.providerData) ?? undefined;
    if (projectId === undefined) {
      throw new Error('GitLab repositories require providerData.projectId.');
    }
    const mr = await createMergeRequest({
      config: context.gitlab,
      projectId,
      sourceBranch: input.head,
      targetBranch: input.base,
      title: input.title,
      description: input.description,
      ...(input.labels ? { labels: input.labels } : {}),
      ...(reviewers.length ? { reviewerIds: reviewers } : {}),
    });
    return {
      url: mr.url,
      iid: mr.iid,
    };
  },
  createRepository: async (context, input) => {
    if (!context.gitlab) {
      throw new Error('GitLab is not configured. Set GITLAB_BASE_URL and GITLAB_TOKEN.');
    }
    const namespaceIdRaw = input.providerData?.namespaceId;
    const namespaceId =
      typeof namespaceIdRaw === 'number' && Number.isFinite(namespaceIdRaw)
        ? Math.trunc(namespaceIdRaw)
        : undefined;
    const project = await createProject({
      config: context.gitlab,
      name: input.repoName,
      path: sanitizeRepoKey(input.repoName),
      ...(namespaceId !== undefined ? { namespaceId } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
      initializeWithReadme: Boolean(input.quickstart),
    });
    return {
      repoConfig: {
        provider: 'gitlab',
        sshUrl: project.sshUrl,
        projectId: project.id,
        providerData: {
          ...(input.providerData ?? {}),
          projectId: project.id,
        },
        ...(project.defaultBranch ? { baseBranch: project.defaultBranch } : {}),
      },
      repoUrl: project.webUrl,
      repoLabel: project.pathWithNamespace,
    };
  },
};

const REPO_PROVIDERS: RepoProviderDefinition[] = [localProvider, githubProvider, gitlabProvider];

const REPO_PROVIDER_BY_ID = new Map(REPO_PROVIDERS.map((provider) => [provider.id, provider]));

export function listRepoProviders(): RepoProviderDefinition[] {
  return [...REPO_PROVIDERS];
}

export function getRepoProvider(provider: string): RepoProviderDefinition | undefined {
  return REPO_PROVIDER_BY_ID.get(provider);
}

export function getRepoProviderDisplayName(provider: string): string {
  return getRepoProvider(provider)?.displayName ?? provider;
}

export function inferRepoProvider(repo: RepoConfig): string {
  if (repo.provider?.trim()) {
    return repo.provider.trim();
  }
  if (repo.localPath) return 'local';
  const projectId = parseProviderProjectId(repo.providerData) ?? repo.projectId;
  if (projectId !== undefined) return 'gitlab';
  if (repo.sshUrl?.toLowerCase().includes('gitlab')) return 'gitlab';
  return 'github';
}

export function listBootstrapProviderIds(providerIds: string[]): string[] {
  const values = new Set<string>(['local']);
  for (const providerId of providerIds) {
    const normalized = providerId.trim();
    if (!normalized) continue;
    const provider = getRepoProvider(normalized);
    if (provider?.capabilities.bootstrap) {
      values.add(normalized);
    }
  }
  return Array.from(values);
}

export async function createRepoReviewRequest(options: {
  providerId: string;
  repo: RepoConfig;
  context: ReviewRequestContext;
  input: Omit<CreateReviewRequestInput, 'sshUrl' | 'providerData'>;
}): Promise<{ url: string; iid: number }> {
  const provider = getRepoProvider(options.providerId);
  if (!provider) {
    throw new Error(`Unsupported repository provider: ${options.providerId}`);
  }
  if (!provider.createReviewRequest) {
    throw new Error(`${provider.displayName} does not support review request creation.`);
  }
  if (!options.repo.sshUrl) {
    throw new Error('Remote repositories require sshUrl.');
  }
  return provider.createReviewRequest(options.context, {
    ...options.input,
    sshUrl: options.repo.sshUrl,
    ...(options.repo.providerData ? { providerData: options.repo.providerData } : {}),
  });
}
