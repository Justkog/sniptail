import { afterEach, describe, expect, it, vi } from 'vitest';
import { findOpenPullRequests, syncPullRequestReviewers, updatePullRequest } from './client.js';

const config = {
  apiBaseUrl: 'https://api.github.test',
  token: 'token',
};

describe('github review request client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('finds only exact open pull request matches for branch and base', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve([
          {
            html_url: 'https://github.test/pr/1',
            number: 1,
            updated_at: '2026-04-15T10:00:00.000Z',
            head: { ref: 'feature' },
            base: { ref: 'main' },
          },
          {
            html_url: 'https://github.test/pr/2',
            number: 2,
            updated_at: '2026-04-15T11:00:00.000Z',
            head: { ref: 'feature' },
            base: { ref: 'develop' },
          },
        ]),
    });
    vi.stubGlobal('fetch', fetchMock);

    const prs = await findOpenPullRequests({
      config,
      owner: 'org',
      repo: 'repo',
      head: 'feature',
      base: 'main',
    });

    expect(prs).toEqual([
      {
        url: 'https://github.test/pr/1',
        number: 1,
        head: 'feature',
        base: 'main',
        updatedAt: '2026-04-15T10:00:00.000Z',
      },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.test/repos/org/repo/pulls?state=open&base=main&per_page=100',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('syncs requested reviewers by adding and removing differences', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            users: [{ login: 'alice' }, { login: 'bob' }],
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });
    vi.stubGlobal('fetch', fetchMock);

    await syncPullRequestReviewers({
      config,
      owner: 'org',
      repo: 'repo',
      number: 12,
      reviewers: ['alice', 'carol'],
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://api.github.test/repos/org/repo/pulls/12/requested_reviewers',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ reviewers: ['carol'] }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://api.github.test/repos/org/repo/pulls/12/requested_reviewers',
      expect.objectContaining({
        method: 'DELETE',
        body: JSON.stringify({ reviewers: ['bob'] }),
      }),
    );
  });

  it('updates pull request title and body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          html_url: 'https://github.test/pr/7',
          number: 7,
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const pr = await updatePullRequest({
      config,
      owner: 'org',
      repo: 'repo',
      number: 7,
      title: 'Updated title',
      body: 'Updated body',
    });

    expect(pr).toEqual({
      url: 'https://github.test/pr/7',
      number: 7,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.test/repos/org/repo/pulls/7',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({
          title: 'Updated title',
          body: 'Updated body',
        }),
      }),
    );
  });
});
