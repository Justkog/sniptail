import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  parseGitHubRepo: vi.fn(() => ({ owner: 'org', repo: 'repo' })),
  createPullRequest: vi.fn(),
  createRepository: vi.fn(),
  findOpenPullRequests: vi.fn(),
  replacePullRequestLabels: vi.fn(),
  syncPullRequestReviewers: vi.fn(),
  updatePullRequest: vi.fn(),
  createMergeRequest: vi.fn(),
  createProject: vi.fn(),
  findOpenMergeRequests: vi.fn(),
  updateMergeRequest: vi.fn(),
}));

vi.mock('../git/ssh.js', () => ({
  parseGitHubRepo: hoisted.parseGitHubRepo,
}));

vi.mock('../github/client.js', () => ({
  createPullRequest: hoisted.createPullRequest,
  createRepository: hoisted.createRepository,
  findOpenPullRequests: hoisted.findOpenPullRequests,
  replacePullRequestLabels: hoisted.replacePullRequestLabels,
  syncPullRequestReviewers: hoisted.syncPullRequestReviewers,
  updatePullRequest: hoisted.updatePullRequest,
}));

vi.mock('../gitlab/client.js', () => ({
  createMergeRequest: hoisted.createMergeRequest,
  createProject: hoisted.createProject,
  findOpenMergeRequests: hoisted.findOpenMergeRequests,
  updateMergeRequest: hoisted.updateMergeRequest,
}));

import { createRepoReviewRequest } from './providers.js';

describe('repo review request provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reuses the most recently updated GitHub pull request and syncs metadata', async () => {
    hoisted.findOpenPullRequests.mockResolvedValue([
      {
        url: 'https://github.test/pr/1',
        number: 1,
        head: 'feature',
        base: 'main',
        updatedAt: '2026-04-15T10:00:00.000Z',
      },
      {
        url: 'https://github.test/pr/2',
        number: 2,
        head: 'feature',
        base: 'main',
        updatedAt: '2026-04-15T12:00:00.000Z',
      },
    ]);
    hoisted.updatePullRequest.mockResolvedValue({
      url: 'https://github.test/pr/2',
      number: 2,
    });
    hoisted.replacePullRequestLabels.mockResolvedValue(undefined);
    hoisted.syncPullRequestReviewers.mockResolvedValue(undefined);

    const result = await createRepoReviewRequest({
      providerId: 'github',
      repo: { sshUrl: 'git@github.com:org/repo.git' },
      context: {
        github: {
          apiBaseUrl: 'https://api.github.test',
          token: 'token',
        },
      },
      input: {
        head: 'feature',
        base: 'main',
        title: 'Updated title',
        description: 'Updated description',
        labels: ['bot'],
        reviewers: ['alice'],
      },
    });

    expect(result).toEqual({
      url: 'https://github.test/pr/2',
      iid: 2,
      reused: true,
    });
    expect(hoisted.updatePullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        number: 2,
        title: 'Updated title',
        body: 'Updated description',
      }),
    );
    expect(hoisted.replacePullRequestLabels).toHaveBeenCalledWith(
      expect.objectContaining({
        number: 2,
        labels: ['bot'],
      }),
    );
    expect(hoisted.syncPullRequestReviewers).toHaveBeenCalledWith(
      expect.objectContaining({
        number: 2,
        reviewers: ['alice'],
      }),
    );
  });

  it('creates a new GitLab merge request when no open match exists', async () => {
    hoisted.findOpenMergeRequests.mockResolvedValue([]);
    hoisted.createMergeRequest.mockResolvedValue({
      url: 'https://gitlab.test/mr/5',
      iid: 5,
    });

    const result = await createRepoReviewRequest({
      providerId: 'gitlab',
      repo: {
        sshUrl: 'git@gitlab.com:org/repo.git',
        providerData: { projectId: 42 },
      },
      context: {
        gitlab: {
          baseUrl: 'https://gitlab.test',
          token: 'token',
        },
      },
      input: {
        head: 'feature',
        base: 'main',
        title: 'MR title',
        description: 'MR description',
      },
    });

    expect(result).toEqual({
      url: 'https://gitlab.test/mr/5',
      iid: 5,
      reused: false,
    });
    expect(hoisted.createMergeRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceBranch: 'feature',
        targetBranch: 'main',
      }),
    );
  });

  it('reuses existing GitLab merge request without clearing labels/reviewers when omitted', async () => {
    hoisted.findOpenMergeRequests.mockResolvedValue([
      {
        url: 'https://gitlab.test/mr/7',
        iid: 7,
        sourceBranch: 'feature',
        targetBranch: 'main',
        updatedAt: '2026-04-15T12:00:00.000Z',
      },
    ]);
    hoisted.updateMergeRequest.mockResolvedValue({
      url: 'https://gitlab.test/mr/7',
      iid: 7,
    });

    const result = await createRepoReviewRequest({
      providerId: 'gitlab',
      repo: {
        sshUrl: 'git@gitlab.com:org/repo.git',
        providerData: { projectId: 42 },
      },
      context: {
        gitlab: {
          baseUrl: 'https://gitlab.test',
          token: 'token',
        },
      },
      input: {
        head: 'feature',
        base: 'main',
        title: 'MR title',
        description: 'MR description',
      },
    });

    expect(result).toEqual({
      url: 'https://gitlab.test/mr/7',
      iid: 7,
      reused: true,
    });
    expect(hoisted.updateMergeRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 42,
        iid: 7,
        title: 'MR title',
        description: 'MR description',
      }),
    );
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const updateInput = hoisted.updateMergeRequest.mock.calls[0]?.[0];
    expect(updateInput).not.toHaveProperty('labels');
    expect(updateInput).not.toHaveProperty('reviewerIds');
  });
});
