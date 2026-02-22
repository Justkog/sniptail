import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sniptail/core/config/config.js', () => ({
  loadWorkerConfig: () => ({
    jobWorkRoot: '/tmp/sniptail/job-root',
    repoCacheRoot: '/tmp/sniptail/repo-cache',
  }),
}));

vi.mock('@sniptail/core/git/mirror.js', () => ({
  ensureClone: vi.fn(),
}));

vi.mock('@sniptail/core/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@sniptail/core/repos/catalog.js', () => ({
  listRepoCatalogEntries: vi.fn(),
  upsertRepoCatalogEntry: vi.fn(),
}));

vi.mock('@sniptail/core/repos/runActions.js', () => ({
  normalizeRunActionId: vi.fn((value: string) => {
    const normalized = value.trim().toLowerCase();
    if (!normalized || !/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/.test(normalized)) {
      throw new Error(`Invalid run action id "${value}".`);
    }
    return normalized;
  }),
  withRepoRunActionsMetadata: vi.fn(
    (providerData: Record<string, unknown> | undefined, metadata: unknown) => ({
      ...(providerData ?? {}),
      sniptail: { run: metadata },
    }),
  ),
}));

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
}));

import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { ensureClone } from '@sniptail/core/git/mirror.js';
import { logger } from '@sniptail/core/logger.js';
import {
  listRepoCatalogEntries,
  upsertRepoCatalogEntry,
} from '@sniptail/core/repos/catalog.js';
import type { RepoRow } from '@sniptail/core/repos/catalogTypes.js';
import { syncRunActionMetadata } from './syncRunActionMetadata.js';

function makeLocalRow(overrides: Partial<RepoRow> = {}): RepoRow {
  return {
    repoKey: 'my-local-repo',
    provider: 'local',
    localPath: '/srv/repos/my-local-repo',
    baseBranch: 'main',
    isActive: true,
    ...overrides,
  };
}

function makeRemoteRow(overrides: Partial<RepoRow> = {}): RepoRow {
  return {
    repoKey: 'my-remote-repo',
    provider: 'gitlab',
    sshUrl: 'git@gitlab.com:org/repo.git',
    baseBranch: 'main',
    isActive: true,
    ...overrides,
  };
}

function makeDirent(name: string, isFile = true, isSymlink = false): Dirent {
  return {
    name,
    isFile: () => isFile,
    isSymbolicLink: () => isSymlink,
    isDirectory: () => !isFile && !isSymlink,
  } as unknown as Dirent;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('syncRunActionMetadata', () => {
  describe('contract discovery', () => {
    it('returns sorted, deduplicated action ids from valid contract files', async () => {
      const row = makeLocalRow();
      vi.mocked(listRepoCatalogEntries).mockResolvedValueOnce([row]);
      vi.mocked(upsertRepoCatalogEntry).mockResolvedValueOnce(undefined);
      vi.mocked(readdir).mockResolvedValueOnce([
        makeDirent('deploy'),
        makeDirent('refresh-docs'),
        makeDirent('build'),
      ]);

      const result = await syncRunActionMetadata();

      expect(result).toEqual({ scanned: 1, updated: 1, failures: [] });
      expect(upsertRepoCatalogEntry).toHaveBeenCalledWith(
        'my-local-repo',
        expect.objectContaining({
          localPath: '/srv/repos/my-local-repo',
          providerData: expect.objectContaining({
            sniptail: expect.objectContaining({
              run: expect.objectContaining({
                actionIds: ['build', 'deploy', 'refresh-docs'],
              }),
            }),
          }),
        }),
        expect.any(Object),
      );
    });

    it('skips directories, keeping only files and symlinks', async () => {
      const row = makeLocalRow();
      vi.mocked(listRepoCatalogEntries).mockResolvedValueOnce([row]);
      vi.mocked(upsertRepoCatalogEntry).mockResolvedValueOnce(undefined);
      vi.mocked(readdir).mockResolvedValueOnce([
        makeDirent('valid-action'),
        makeDirent('subdir', false, false),
        makeDirent('symlink-action', false, true),
      ]);

      const result = await syncRunActionMetadata();

      expect(result.updated).toBe(1);
      expect(upsertRepoCatalogEntry).toHaveBeenCalledWith(
        'my-local-repo',
        expect.objectContaining({
          providerData: expect.objectContaining({
            sniptail: expect.objectContaining({
              run: expect.objectContaining({
                actionIds: expect.arrayContaining(['valid-action', 'symlink-action']),
              }),
            }),
          }),
        }),
        expect.any(Object),
      );
      const calledActionIds =
        vi.mocked(upsertRepoCatalogEntry).mock.calls[0]?.[1]?.providerData?.sniptail?.run
          ?.actionIds;
      expect(calledActionIds).not.toContain('subdir');
    });

    it('returns empty action ids when the contracts directory does not exist', async () => {
      const row = makeLocalRow();
      vi.mocked(listRepoCatalogEntries).mockResolvedValueOnce([row]);
      vi.mocked(upsertRepoCatalogEntry).mockResolvedValueOnce(undefined);
      vi.mocked(readdir).mockRejectedValueOnce(
        Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
      );

      const result = await syncRunActionMetadata();

      expect(result).toEqual({ scanned: 1, updated: 1, failures: [] });
      expect(upsertRepoCatalogEntry).toHaveBeenCalledWith(
        'my-local-repo',
        expect.objectContaining({
          providerData: expect.objectContaining({
            sniptail: expect.objectContaining({
              run: expect.objectContaining({ actionIds: [] }),
            }),
          }),
        }),
        expect.any(Object),
      );
    });

    it('rethrows unexpected readdir errors', async () => {
      const row = makeLocalRow();
      vi.mocked(listRepoCatalogEntries).mockResolvedValueOnce([row]);
      vi.mocked(readdir).mockRejectedValueOnce(new Error('permission denied'));

      const result = await syncRunActionMetadata();

      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]).toEqual({
        repoKey: 'my-local-repo',
        message: 'permission denied',
      });
    });
  });

  describe('invalid action id handling', () => {
    it('skips files with invalid action ids and warns', async () => {
      const row = makeLocalRow();
      vi.mocked(listRepoCatalogEntries).mockResolvedValueOnce([row]);
      vi.mocked(upsertRepoCatalogEntry).mockResolvedValueOnce(undefined);
      vi.mocked(readdir).mockResolvedValueOnce([
        makeDirent('valid-action'),
        makeDirent('INVALID ACTION!'),
        makeDirent('another-valid'),
      ]);

      const result = await syncRunActionMetadata();

      expect(result).toEqual({ scanned: 1, updated: 1, failures: [] });
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        expect.objectContaining({ entryName: 'INVALID ACTION!' }),
        expect.stringContaining('Skipping invalid run action id'),
      );
      const calledActionIds =
        vi.mocked(upsertRepoCatalogEntry).mock.calls[0]?.[1]?.providerData?.sniptail?.run
          ?.actionIds;
      expect(calledActionIds).toContain('valid-action');
      expect(calledActionIds).toContain('another-valid');
      expect(calledActionIds).not.toContain('INVALID ACTION!');
    });
  });

  describe('local repository sync', () => {
    it('uses localPath directly without cloning', async () => {
      const row = makeLocalRow({ localPath: '/srv/repos/local' });
      vi.mocked(listRepoCatalogEntries).mockResolvedValueOnce([row]);
      vi.mocked(upsertRepoCatalogEntry).mockResolvedValueOnce(undefined);
      vi.mocked(readdir).mockResolvedValueOnce([makeDirent('my-action')]);

      await syncRunActionMetadata();

      expect(vi.mocked(ensureClone)).not.toHaveBeenCalled();
      expect(vi.mocked(readdir)).toHaveBeenCalledWith(
        expect.stringContaining('/srv/repos/local'),
        expect.any(Object),
      );
    });
  });

  describe('remote repository sync', () => {
    it('clones the repo before scanning when no localPath is set', async () => {
      const row = makeRemoteRow();
      vi.mocked(listRepoCatalogEntries).mockResolvedValueOnce([row]);
      vi.mocked(upsertRepoCatalogEntry).mockResolvedValueOnce(undefined);
      vi.mocked(ensureClone).mockResolvedValueOnce(undefined);
      vi.mocked(readdir).mockResolvedValueOnce([makeDirent('deploy')]);

      await syncRunActionMetadata();

      expect(vi.mocked(ensureClone)).toHaveBeenCalledWith(
        'my-remote-repo',
        expect.any(Object),
        '/tmp/sniptail/repo-cache/my-remote-repo.git',
        expect.any(String),
        process.env,
        'main',
        [],
      );
      expect(vi.mocked(readdir)).toHaveBeenCalledWith(
        expect.stringContaining('/tmp/sniptail/repo-cache/my-remote-repo.git'),
        expect.any(Object),
      );
    });
  });

  describe('repoKey filtering', () => {
    it('throws when the specified repoKey is not found in the catalog', async () => {
      vi.mocked(listRepoCatalogEntries).mockResolvedValueOnce([makeLocalRow()]);

      await expect(
        syncRunActionMetadata({ repoKey: 'nonexistent-repo' }),
      ).rejects.toThrow('Repository key "nonexistent-repo" not found in the active catalog.');
    });

    it('syncs only the specified repo when repoKey is provided', async () => {
      const rows = [makeLocalRow({ repoKey: 'repo-a' }), makeLocalRow({ repoKey: 'repo-b' })];
      vi.mocked(listRepoCatalogEntries).mockResolvedValueOnce(rows);
      vi.mocked(upsertRepoCatalogEntry).mockResolvedValueOnce(undefined);
      vi.mocked(readdir).mockResolvedValueOnce([makeDirent('action-1')]);

      const result = await syncRunActionMetadata({ repoKey: 'repo-a' });

      expect(result.scanned).toBe(1);
      expect(vi.mocked(upsertRepoCatalogEntry)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(upsertRepoCatalogEntry)).toHaveBeenCalledWith(
        'repo-a',
        expect.any(Object),
        expect.any(Object),
      );
    });
  });

  describe('failure accumulation', () => {
    it('accumulates per-repo failures without aborting the sync', async () => {
      const rows = [
        makeLocalRow({ repoKey: 'repo-ok' }),
        makeLocalRow({ repoKey: 'repo-fail' }),
      ];
      vi.mocked(listRepoCatalogEntries).mockResolvedValueOnce(rows);
      vi.mocked(upsertRepoCatalogEntry).mockResolvedValueOnce(undefined);
      vi.mocked(readdir)
        .mockResolvedValueOnce([makeDirent('action-x')])
        .mockRejectedValueOnce(new Error('disk error'));

      const result = await syncRunActionMetadata();

      expect(result.scanned).toBe(2);
      expect(result.updated).toBe(1);
      expect(result.failures).toEqual([{ repoKey: 'repo-fail', message: 'disk error' }]);
    });

    it('returns zero updated and a failure for every repo when all fail', async () => {
      const rows = [makeRemoteRow({ repoKey: 'repo-1' }), makeRemoteRow({ repoKey: 'repo-2' })];
      vi.mocked(listRepoCatalogEntries).mockResolvedValueOnce(rows);
      vi.mocked(ensureClone)
        .mockRejectedValueOnce(new Error('clone failed for repo-1'))
        .mockRejectedValueOnce(new Error('clone failed for repo-2'));

      const result = await syncRunActionMetadata();

      expect(result.scanned).toBe(2);
      expect(result.updated).toBe(0);
      expect(result.failures).toHaveLength(2);
    });
  });

  describe('result counts', () => {
    it('scans all repos in the catalog when no repoKey filter is applied', async () => {
      const rows = [
        makeLocalRow({ repoKey: 'repo-1' }),
        makeLocalRow({ repoKey: 'repo-2' }),
        makeLocalRow({ repoKey: 'repo-3' }),
      ];
      vi.mocked(listRepoCatalogEntries).mockResolvedValueOnce(rows);
      vi.mocked(upsertRepoCatalogEntry).mockResolvedValue(undefined);
      vi.mocked(readdir).mockResolvedValue([]);

      const result = await syncRunActionMetadata();

      expect(result.scanned).toBe(3);
      expect(result.updated).toBe(3);
      expect(result.failures).toEqual([]);
    });
  });
});
