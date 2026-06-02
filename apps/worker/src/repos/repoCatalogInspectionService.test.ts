import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sniptail/core/repos/catalog.js', () => ({
  findRepoCatalogEntry: vi.fn(),
}));

import { findRepoCatalogEntry } from '@sniptail/core/repos/catalog.js';
import type { RepoRow } from '@sniptail/core/repos/catalogTypes.js';
import { inspectRepoCatalogEntryFromInput } from './repoCatalogInspectionService.js';

function makeRemoteRow(overrides: Partial<RepoRow> = {}): RepoRow {
  return {
    repoKey: 'my-api',
    provider: 'gitlab',
    sshUrl: 'git@gitlab.com:org/my-api.git',
    projectId: 12345,
    providerData: {
      projectId: 12345,
      sniptail: {
        run: {
          actions: {
            deploy: {
              parameters: [],
              steps: [],
            },
            'fix-ci': {
              parameters: [],
              steps: [],
            },
          },
          syncedAt: '2026-06-01T10:00:00.000Z',
          sourceRef: 'main',
        },
      },
    },
    baseBranch: 'main',
    isActive: true,
    ...overrides,
  };
}

function makeLocalRow(overrides: Partial<RepoRow> = {}): RepoRow {
  return {
    repoKey: 'local-tools',
    provider: 'local',
    localPath: '/srv/repos/local-tools',
    baseBranch: 'main',
    isActive: true,
    ...overrides,
  };
}

describe('inspectRepoCatalogEntryFromInput', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns raw row and summary for a remote repo with run action metadata', async () => {
    const row = makeRemoteRow();
    vi.mocked(findRepoCatalogEntry).mockResolvedValueOnce(row);

    const result = await inspectRepoCatalogEntryFromInput('my-api');

    expect(result.command).toBe('inspect');
    expect(result.repoKey).toBe('my-api');
    expect(result.entry).toBe(row);
    expect(result.normalizedFrom).toBeUndefined();
    expect(result.summary).toEqual({
      repoKey: 'my-api',
      provider: 'gitlab',
      baseBranch: 'main',
      sourceType: 'sshUrl',
      source: 'git@gitlab.com:org/my-api.git',
      projectId: 12345,
      runActionCount: 2,
      runActionIds: ['deploy', 'fix-ci'],
      runMetadataSyncedAt: '2026-06-01T10:00:00.000Z',
      runMetadataSourceRef: 'main',
    });
  });

  it('summarizes a local repo source', async () => {
    const row = makeLocalRow();
    vi.mocked(findRepoCatalogEntry).mockResolvedValueOnce(row);

    const result = await inspectRepoCatalogEntryFromInput('local-tools');

    expect(result.summary.sourceType).toBe('localPath');
    expect(result.summary.source).toBe('/srv/repos/local-tools');
    expect(result.summary.projectId).toBeUndefined();
    expect(result.summary.runActionCount).toBe(0);
    expect(result.summary.runActionIds).toEqual([]);
  });

  it('reports normalized repo key input', async () => {
    const row = makeRemoteRow({ repoKey: 'my-api' });
    vi.mocked(findRepoCatalogEntry).mockResolvedValueOnce(row);

    const result = await inspectRepoCatalogEntryFromInput('my api!');

    expect(findRepoCatalogEntry).toHaveBeenCalledWith('my-api');
    expect(result.repoKey).toBe('my-api');
    expect(result.normalizedFrom).toBe('my api!');
  });

  it('throws when the repo key is not active in the catalog', async () => {
    vi.mocked(findRepoCatalogEntry).mockResolvedValueOnce(undefined);

    await expect(inspectRepoCatalogEntryFromInput('missing-repo')).rejects.toThrow(
      'Repository key "missing-repo" was not found in the active catalog.',
    );
  });

  it('treats missing or invalid run metadata as zero run actions', async () => {
    const missing = makeRemoteRow({ providerData: undefined });
    vi.mocked(findRepoCatalogEntry).mockResolvedValueOnce(missing);

    const missingResult = await inspectRepoCatalogEntryFromInput('my-api');

    expect(missingResult.summary.runActionCount).toBe(0);
    expect(missingResult.summary.runActionIds).toEqual([]);
    expect(missingResult.summary.runMetadataSyncedAt).toBeUndefined();
    expect(missingResult.summary.runMetadataSourceRef).toBeUndefined();

    const invalid = makeRemoteRow({
      providerData: {
        sniptail: {
          run: {
            actions: {
              'invalid action': {
                parameters: [],
                steps: [],
              },
            },
            syncedAt: '2026-06-01T10:00:00.000Z',
            sourceRef: 'main',
          },
        },
      },
    });
    vi.mocked(findRepoCatalogEntry).mockResolvedValueOnce(invalid);

    const invalidResult = await inspectRepoCatalogEntryFromInput('my-api');

    expect(invalidResult.summary.runActionCount).toBe(0);
    expect(invalidResult.summary.runActionIds).toEqual([]);
    expect(invalidResult.summary.runMetadataSyncedAt).toBeUndefined();
    expect(invalidResult.summary.runMetadataSourceRef).toBeUndefined();
  });
});
