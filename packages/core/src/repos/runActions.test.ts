import { describe, expect, it } from 'vitest';

import {
  getRepoRunActionsMetadata,
  intersectRunActionIds,
  isValidRunActionId,
  listRunActionIds,
  normalizeRunActionId,
  tryNormalizeRunActionId,
  withRepoRunActionsMetadata,
} from './runActions.js';

describe('normalizeRunActionId', () => {
  it('accepts valid lowercase IDs', () => {
    expect(normalizeRunActionId('build')).toBe('build');
    expect(normalizeRunActionId('run-tests')).toBe('run-tests');
    expect(normalizeRunActionId('deploy.prod')).toBe('deploy.prod');
    expect(normalizeRunActionId('step_1')).toBe('step_1');
    expect(normalizeRunActionId('abc123')).toBe('abc123');
    expect(normalizeRunActionId('a')).toBe('a');
  });

  it('trims whitespace and lowercases before validating', () => {
    expect(normalizeRunActionId('  Build  ')).toBe('build');
    expect(normalizeRunActionId('RUN')).toBe('run');
  });

  it('throws for empty string', () => {
    expect(() => normalizeRunActionId('')).toThrow('Run action id cannot be empty.');
    expect(() => normalizeRunActionId('   ')).toThrow('Run action id cannot be empty.');
  });

  it('throws for IDs starting or ending with special chars', () => {
    expect(() => normalizeRunActionId('-build')).toThrow('Invalid run action id');
    expect(() => normalizeRunActionId('build-')).toThrow('Invalid run action id');
    expect(() => normalizeRunActionId('.build')).toThrow('Invalid run action id');
    expect(() => normalizeRunActionId('build.')).toThrow('Invalid run action id');
  });

  it('throws for IDs containing path separators', () => {
    expect(() => normalizeRunActionId('a/b')).toThrow('Invalid run action id');
    expect(() => normalizeRunActionId('a\\b')).toThrow('Invalid run action id');
  });

  it('throws for IDs containing disallowed characters', () => {
    expect(() => normalizeRunActionId('build script')).toThrow('Invalid run action id');
    expect(() => normalizeRunActionId('build!')).toThrow('Invalid run action id');
    expect(() => normalizeRunActionId('build@prod')).toThrow('Invalid run action id');
  });
});

describe('tryNormalizeRunActionId', () => {
  it('returns normalized ID for valid input', () => {
    expect(tryNormalizeRunActionId('build')).toBe('build');
    expect(tryNormalizeRunActionId('  BUILD  ')).toBe('build');
  });

  it('returns undefined for invalid input', () => {
    expect(tryNormalizeRunActionId('')).toBeUndefined();
    expect(tryNormalizeRunActionId('-bad')).toBeUndefined();
    expect(tryNormalizeRunActionId('a/b')).toBeUndefined();
  });
});

describe('isValidRunActionId', () => {
  it('returns true for valid IDs', () => {
    expect(isValidRunActionId('build')).toBe(true);
    expect(isValidRunActionId('run-tests')).toBe(true);
  });

  it('returns false for invalid IDs', () => {
    expect(isValidRunActionId('')).toBe(false);
    expect(isValidRunActionId('a/b')).toBe(false);
    expect(isValidRunActionId('-bad')).toBe(false);
  });
});

describe('getRepoRunActionsMetadata', () => {
  const validProviderData = {
    sniptail: {
      run: {
        actionIds: ['build', 'test'],
        syncedAt: '2024-01-01T00:00:00Z',
        sourceRef: 'main',
      },
    },
  };

  it('returns metadata for valid providerData', () => {
    const result = getRepoRunActionsMetadata(validProviderData);
    expect(result).toEqual({
      actionIds: ['build', 'test'],
      syncedAt: '2024-01-01T00:00:00Z',
      sourceRef: 'main',
    });
  });

  it('sorts and deduplicates actionIds', () => {
    const data = {
      sniptail: {
        run: {
          actionIds: ['test', 'build', 'build', 'TEST'],
          syncedAt: '2024-01-01T00:00:00Z',
          sourceRef: 'main',
        },
      },
    };
    const result = getRepoRunActionsMetadata(data);
    expect(result?.actionIds).toEqual(['build', 'test']);
  });

  it('filters out invalid action IDs silently', () => {
    const data = {
      sniptail: {
        run: {
          actionIds: ['build', '-invalid', 'test'],
          syncedAt: '2024-01-01T00:00:00Z',
          sourceRef: 'main',
        },
      },
    };
    const result = getRepoRunActionsMetadata(data);
    expect(result?.actionIds).toEqual(['build', 'test']);
  });

  it('returns undefined when providerData is undefined', () => {
    expect(getRepoRunActionsMetadata(undefined)).toBeUndefined();
  });

  it('returns undefined when sniptail.run is missing', () => {
    expect(getRepoRunActionsMetadata({})).toBeUndefined();
    expect(getRepoRunActionsMetadata({ sniptail: {} })).toBeUndefined();
  });

  it('returns undefined when actionIds is not an array', () => {
    const data = {
      sniptail: { run: { actionIds: 'build', syncedAt: '2024-01-01T00:00:00Z', sourceRef: 'main' } },
    };
    expect(getRepoRunActionsMetadata(data)).toBeUndefined();
  });

  it('returns undefined when actionIds array is empty or all invalid', () => {
    const makeData = (actionIds: unknown[]) => ({
      sniptail: { run: { actionIds, syncedAt: '2024-01-01T00:00:00Z', sourceRef: 'main' } },
    });
    expect(getRepoRunActionsMetadata(makeData([]))).toBeUndefined();
    expect(getRepoRunActionsMetadata(makeData(['-bad', '']))).toBeUndefined();
  });

  it('returns undefined when syncedAt or sourceRef is missing', () => {
    const makeData = (syncedAt: unknown, sourceRef: unknown) => ({
      sniptail: { run: { actionIds: ['build'], syncedAt, sourceRef } },
    });
    expect(getRepoRunActionsMetadata(makeData('', 'main'))).toBeUndefined();
    expect(getRepoRunActionsMetadata(makeData('2024-01-01T00:00:00Z', ''))).toBeUndefined();
    expect(getRepoRunActionsMetadata(makeData(undefined, 'main'))).toBeUndefined();
  });

  it('ignores non-string entries in actionIds array', () => {
    const data = {
      sniptail: {
        run: {
          actionIds: ['build', 42, null, 'test'],
          syncedAt: '2024-01-01T00:00:00Z',
          sourceRef: 'main',
        },
      },
    };
    const result = getRepoRunActionsMetadata(data);
    expect(result?.actionIds).toEqual(['build', 'test']);
  });
});

describe('listRunActionIds', () => {
  it('returns action IDs from valid providerData', () => {
    const data = {
      sniptail: {
        run: {
          actionIds: ['build', 'test'],
          syncedAt: '2024-01-01T00:00:00Z',
          sourceRef: 'main',
        },
      },
    };
    expect(listRunActionIds(data)).toEqual(['build', 'test']);
  });

  it('returns empty array when providerData is undefined or invalid', () => {
    expect(listRunActionIds(undefined)).toEqual([]);
    expect(listRunActionIds({})).toEqual([]);
  });
});

describe('withRepoRunActionsMetadata', () => {
  it('sets run metadata on empty providerData', () => {
    const result = withRepoRunActionsMetadata(undefined, {
      actionIds: ['build', 'test'],
      syncedAt: '2024-01-01T00:00:00Z',
      sourceRef: 'main',
    });
    expect(result).toEqual({
      sniptail: {
        run: {
          actionIds: ['build', 'test'],
          syncedAt: '2024-01-01T00:00:00Z',
          sourceRef: 'main',
        },
      },
    });
  });

  it('preserves existing providerData fields', () => {
    const existing = { other: 'value', sniptail: { custom: 'data' } };
    const result = withRepoRunActionsMetadata(existing, {
      actionIds: ['deploy'],
      syncedAt: '2024-01-01T00:00:00Z',
      sourceRef: 'main',
    });
    expect(result.other).toBe('value');
    expect((result.sniptail as Record<string, unknown>).custom).toBe('data');
    expect((result.sniptail as Record<string, unknown>).run).toEqual({
      actionIds: ['deploy'],
      syncedAt: '2024-01-01T00:00:00Z',
      sourceRef: 'main',
    });
  });

  it('normalizes and sorts action IDs', () => {
    const result = withRepoRunActionsMetadata(undefined, {
      actionIds: ['TEST', 'build', 'BUILD'],
      syncedAt: '2024-01-01T00:00:00Z',
      sourceRef: 'main',
    });
    expect((result.sniptail as Record<string, unknown>).run).toMatchObject({
      actionIds: ['build', 'test'],
    });
  });

  it('round-trips through getRepoRunActionsMetadata', () => {
    const metadata = {
      actionIds: ['build', 'test'],
      syncedAt: '2024-01-01T00:00:00Z',
      sourceRef: 'main',
    };
    const stored = withRepoRunActionsMetadata(undefined, metadata);
    expect(getRepoRunActionsMetadata(stored)).toEqual(metadata);
  });
});

describe('intersectRunActionIds', () => {
  it('returns empty array when repoActionSets is empty', () => {
    expect(intersectRunActionIds([], ['build', 'test'])).toEqual([]);
  });

  it('returns actions present in all repo sets and in availableActionIds', () => {
    const result = intersectRunActionIds(
      [['build', 'test', 'deploy'], ['build', 'deploy']],
      ['build', 'deploy', 'test'],
    );
    expect(result).toEqual(['build', 'deploy']);
  });

  it('filters out actions not in availableActionIds', () => {
    const result = intersectRunActionIds(
      [['build', 'test']],
      ['build'],
    );
    expect(result).toEqual(['build']);
  });

  it('returns empty array when intersection is empty', () => {
    expect(intersectRunActionIds([['build'], ['test']], ['build', 'test'])).toEqual([]);
  });

  it('returns sorted results', () => {
    const result = intersectRunActionIds(
      [['zebra', 'alpha', 'middle']],
      ['alpha', 'middle', 'zebra'],
    );
    expect(result).toEqual(['alpha', 'middle', 'zebra']);
  });

  it('normalizes IDs before intersecting', () => {
    const result = intersectRunActionIds(
      [['BUILD', 'Test']],
      ['build', 'test'],
    );
    expect(result).toEqual(['build', 'test']);
  });

  it('silently ignores invalid action IDs in inputs', () => {
    const result = intersectRunActionIds(
      [['build', '-invalid', 'test']],
      ['build', 'test', '-invalid'],
    );
    expect(result).toEqual(['build', 'test']);
  });
});
