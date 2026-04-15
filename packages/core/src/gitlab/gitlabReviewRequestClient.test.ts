import { afterEach, describe, expect, it, vi } from 'vitest';
import { findOpenMergeRequests, updateMergeRequest } from './client.js';

const config = {
  baseUrl: 'https://gitlab.test',
  token: 'token',
};

describe('gitlab review request client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('finds only exact open merge request matches for branch and base', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            web_url: 'https://gitlab.test/mr/1',
            iid: 1,
            source_branch: 'feature',
            target_branch: 'main',
            updated_at: '2026-04-15T10:00:00.000Z',
          },
          {
            web_url: 'https://gitlab.test/mr/2',
            iid: 2,
            source_branch: 'feature',
            target_branch: 'develop',
            updated_at: '2026-04-15T11:00:00.000Z',
          },
        ]),
    });
    vi.stubGlobal('fetch', fetchMock);

    const mrs = await findOpenMergeRequests({
      config,
      projectId: 42,
      sourceBranch: 'feature',
      targetBranch: 'main',
    });

    expect(mrs).toEqual([
      {
        url: 'https://gitlab.test/mr/1',
        iid: 1,
        sourceBranch: 'feature',
        targetBranch: 'main',
        updatedAt: '2026-04-15T10:00:00.000Z',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://gitlab.test/api/v4/projects/42/merge_requests?state=opened&source_branch=feature&target_branch=main&per_page=100&order_by=updated_at&sort=desc',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('updates merge request title, description, labels, and reviewers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          web_url: 'https://gitlab.test/mr/9',
          iid: 9,
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const mr = await updateMergeRequest({
      config,
      projectId: 42,
      iid: 9,
      title: 'Updated title',
      description: 'Updated description',
      labels: ['bot', 'safe'],
      reviewerIds: [4, 8],
    });

    expect(mr).toEqual({
      url: 'https://gitlab.test/mr/9',
      iid: 9,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://gitlab.test/api/v4/projects/42/merge_requests/9',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          title: 'Updated title',
          description: 'Updated description',
          labels: 'bot,safe',
          reviewer_ids: [4, 8],
        }),
      }),
    );
  });

  it('updates merge request title and description without modifying labels/reviewers when omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          web_url: 'https://gitlab.test/mr/9',
          iid: 9,
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await updateMergeRequest({
      config,
      projectId: 42,
      iid: 9,
      title: 'Updated title',
      description: 'Updated description',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://gitlab.test/api/v4/projects/42/merge_requests/9',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          title: 'Updated title',
          description: 'Updated description',
        }),
      }),
    );
  });
});
