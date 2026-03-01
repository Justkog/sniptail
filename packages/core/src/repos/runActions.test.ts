import { describe, expect, it } from 'vitest';

import {
  getRepoRunActionMetadata,
  getRepoRunActionsMetadata,
  intersectRunActionIds,
  isValidRunActionId,
  listRunActionIds,
  normalizeRunActionParams,
  normalizeRunActionId,
  resolveRunActionMetadataForRepos,
  tryNormalizeRunActionId,
  type RepoRunActionMetadata,
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
        actions: {
          build: {
            parameters: [
              {
                id: 'target_env',
                label: 'Target env',
                type: 'string',
                ui_mode: 'select',
                required: true,
                options: ['staging', 'prod'],
              },
            ],
            steps: [{ id: 'main', fields: ['target_env'] }],
          },
          test: {
            parameters: [],
            steps: [],
          },
        },
        syncedAt: '2024-01-01T00:00:00Z',
        sourceRef: 'main',
      },
    },
  };

  it('returns metadata for valid providerData', () => {
    const result = getRepoRunActionsMetadata(validProviderData);
    expect(result?.syncedAt).toBe('2024-01-01T00:00:00Z');
    expect(result?.sourceRef).toBe('main');
    expect(Object.keys(result?.actions ?? {})).toEqual(['build', 'test']);
  });

  it('returns undefined when providerData is undefined', () => {
    expect(getRepoRunActionsMetadata(undefined)).toBeUndefined();
  });

  it('returns undefined when sniptail.run is missing', () => {
    expect(getRepoRunActionsMetadata({})).toBeUndefined();
    expect(getRepoRunActionsMetadata({ sniptail: {} })).toBeUndefined();
  });

  it('returns undefined when actions is not a table', () => {
    const data = {
      sniptail: {
        run: { actions: 'build', syncedAt: '2024-01-01T00:00:00Z', sourceRef: 'main' },
      },
    };
    expect(getRepoRunActionsMetadata(data)).toBeUndefined();
  });

  it('returns undefined when actions table is empty', () => {
    const data = {
      sniptail: { run: { actions: {}, syncedAt: '2024-01-01T00:00:00Z', sourceRef: 'main' } },
    };
    expect(getRepoRunActionsMetadata(data)).toBeUndefined();
  });

  it('returns undefined for invalid action schemas', () => {
    const data = {
      sniptail: {
        run: {
          actions: {
            build: {
              parameters: [
                {
                  id: 'Bad Id',
                  label: 'Bad id',
                  type: 'string',
                  ui_mode: 'text',
                },
              ],
            },
          },
          syncedAt: '2024-01-01T00:00:00Z',
          sourceRef: 'main',
        },
      },
    };
    expect(getRepoRunActionsMetadata(data)).toBeUndefined();
  });

  it('returns undefined when syncedAt or sourceRef is missing', () => {
    const makeData = (syncedAt: unknown, sourceRef: unknown) => ({
      sniptail: {
        run: {
          actions: {
            build: {
              parameters: [],
              steps: [],
            },
          },
          syncedAt,
          sourceRef,
        },
      },
    });
    expect(getRepoRunActionsMetadata(makeData('', 'main'))).toBeUndefined();
    expect(getRepoRunActionsMetadata(makeData('2024-01-01T00:00:00Z', ''))).toBeUndefined();
    expect(getRepoRunActionsMetadata(makeData(undefined, 'main'))).toBeUndefined();
  });
});

describe('listRunActionIds', () => {
  it('returns action IDs from valid providerData', () => {
    const data = {
      sniptail: {
        run: {
          actions: {
            build: { parameters: [], steps: [] },
            test: { parameters: [], steps: [] },
          },
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
      actions: {
        build: { parameters: [], steps: [] },
        test: { parameters: [], steps: [] },
      },
      syncedAt: '2024-01-01T00:00:00Z',
      sourceRef: 'main',
    });
    expect(result).toEqual({
      sniptail: {
        run: {
          actions: {
            build: { parameters: [], steps: [] },
            test: { parameters: [], steps: [] },
          },
          syncedAt: '2024-01-01T00:00:00Z',
          sourceRef: 'main',
        },
      },
    });
  });

  it('preserves existing providerData fields', () => {
    const existing = { other: 'value', sniptail: { custom: 'data' } };
    const result = withRepoRunActionsMetadata(existing, {
      actions: {
        deploy: { parameters: [], steps: [] },
      },
      syncedAt: '2024-01-01T00:00:00Z',
      sourceRef: 'main',
    });
    expect(result.other).toBe('value');
    expect((result.sniptail as Record<string, unknown>).custom).toBe('data');
    expect((result.sniptail as Record<string, unknown>).run).toEqual({
      actions: {
        deploy: { parameters: [], steps: [] },
      },
      syncedAt: '2024-01-01T00:00:00Z',
      sourceRef: 'main',
    });
  });

  it('normalizes and sorts action IDs', () => {
    const result = withRepoRunActionsMetadata(undefined, {
      actions: {
        TEST: { parameters: [], steps: [] },
        build: { parameters: [], steps: [] },
      },
      syncedAt: '2024-01-01T00:00:00Z',
      sourceRef: 'main',
    });
    expect((result.sniptail as Record<string, unknown>).run).toMatchObject({
      actions: {
        build: { parameters: [], steps: [] },
        test: { parameters: [], steps: [] },
      },
    });
  });

  it('round-trips through getRepoRunActionsMetadata', () => {
    const metadata = {
      actions: {
        build: { parameters: [], steps: [] },
        test: { parameters: [], steps: [] },
      },
      syncedAt: '2024-01-01T00:00:00Z',
      sourceRef: 'main',
    };
    const stored = withRepoRunActionsMetadata(undefined, metadata);
    expect(getRepoRunActionsMetadata(stored)).toEqual(metadata);
  });
});

describe('getRepoRunActionMetadata', () => {
  it('returns metadata for an action', () => {
    const providerData = withRepoRunActionsMetadata(undefined, {
      actions: {
        deploy: {
          parameters: [
            {
              id: 'target_env',
              label: 'Target',
              type: 'string',
              uiMode: 'select',
              required: true,
              options: ['staging', 'prod'],
              sensitive: false,
            },
          ],
          steps: [{ id: 'main', fields: ['target_env'] }],
        },
      },
      syncedAt: '2024-01-01T00:00:00Z',
      sourceRef: 'main',
    });

    const metadata = getRepoRunActionMetadata(providerData, 'DEPLOY');
    expect(metadata).toBeDefined();
    expect(metadata?.parameters[0]?.id).toBe('target_env');
  });
});

describe('intersectRunActionIds', () => {
  it('returns empty array when repoActionSets is empty', () => {
    expect(intersectRunActionIds([], ['build', 'test'])).toEqual([]);
  });

  it('returns actions present in all repo sets and in availableActionIds', () => {
    const result = intersectRunActionIds(
      [
        ['build', 'test', 'deploy'],
        ['build', 'deploy'],
      ],
      ['build', 'deploy', 'test'],
    );
    expect(result).toEqual(['build', 'deploy']);
  });

  it('filters out actions not in availableActionIds', () => {
    const result = intersectRunActionIds([['build', 'test']], ['build']);
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
    const result = intersectRunActionIds([['BUILD', 'Test']], ['build', 'test']);
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

describe('resolveRunActionMetadataForRepos', () => {
  it('resolves a shared schema and intersects options for selected repos', () => {
    const providerDataA = withRepoRunActionsMetadata(undefined, {
      actions: {
        deploy: {
          parameters: [
            {
              id: 'target_env',
              label: 'Target env',
              type: 'string',
              uiMode: 'select',
              required: true,
              options: ['staging', 'prod'],
              sensitive: false,
            },
            {
              id: 'dry_run',
              label: 'Dry run',
              type: 'boolean',
              uiMode: 'boolean',
              required: false,
              default: true,
              sensitive: false,
            },
          ],
          steps: [{ id: 'main', fields: ['target_env', 'dry_run'] }],
        },
      },
      syncedAt: '2024-01-01T00:00:00Z',
      sourceRef: 'main',
    });
    const providerDataB = withRepoRunActionsMetadata(undefined, {
      actions: {
        deploy: {
          parameters: [
            {
              id: 'target_env',
              label: 'Target environment',
              type: 'string',
              uiMode: 'select',
              required: true,
              options: ['prod', 'staging', 'canary'],
              sensitive: false,
            },
            {
              id: 'dry_run',
              label: 'Dry run',
              type: 'boolean',
              uiMode: 'boolean',
              required: false,
              default: true,
              sensitive: false,
            },
          ],
          steps: [{ id: 'step-1', fields: ['target_env', 'dry_run'] }],
        },
      },
      syncedAt: '2024-01-01T00:00:00Z',
      sourceRef: 'main',
    });

    const resolved = resolveRunActionMetadataForRepos('deploy', [providerDataA, providerDataB]);

    const targetEnv = resolved.parameters.find((param) => param.id === 'target_env');
    expect(targetEnv?.options).toEqual(['prod', 'staging']);
    expect(resolved.steps).toEqual([{ id: 'main', fields: ['target_env', 'dry_run'] }]);
  });

  it('preserves configured multi-step layout from canonical metadata', () => {
    const providerDataA = withRepoRunActionsMetadata(undefined, {
      actions: {
        deploy: {
          parameters: [
            {
              id: 'target_env',
              label: 'Target environment',
              type: 'string',
              uiMode: 'select',
              required: true,
              options: ['staging', 'prod'],
              sensitive: false,
            },
            {
              id: 'dry_run',
              label: 'Dry run',
              type: 'boolean',
              uiMode: 'boolean',
              required: false,
              default: true,
              sensitive: false,
            },
            {
              id: 'rollout_percent',
              label: 'Rollout percent',
              type: 'number',
              uiMode: 'number',
              required: false,
              min: 1,
              max: 100,
              sensitive: false,
            },
          ],
          steps: [
            { id: 'basic', fields: ['target_env', 'dry_run'] },
            { id: 'advanced', fields: ['rollout_percent'] },
          ],
        },
      },
      syncedAt: '2024-01-01T00:00:00Z',
      sourceRef: 'main',
    });
    const providerDataB = withRepoRunActionsMetadata(undefined, {
      actions: {
        deploy: {
          parameters: [
            {
              id: 'target_env',
              label: 'Target env',
              type: 'string',
              uiMode: 'select',
              required: true,
              options: ['prod', 'staging', 'canary'],
              sensitive: false,
            },
            {
              id: 'dry_run',
              label: 'Dry run',
              type: 'boolean',
              uiMode: 'boolean',
              required: false,
              default: true,
              sensitive: false,
            },
            {
              id: 'rollout_percent',
              label: 'Rollout percentage',
              type: 'number',
              uiMode: 'number',
              required: false,
              min: 10,
              max: 90,
              sensitive: false,
            },
          ],
          steps: [
            { id: 'first', fields: ['target_env'] },
            { id: 'second', fields: ['dry_run', 'rollout_percent'] },
          ],
        },
      },
      syncedAt: '2024-01-01T00:00:00Z',
      sourceRef: 'main',
    });

    const resolved = resolveRunActionMetadataForRepos('deploy', [providerDataA, providerDataB]);

    expect(resolved.steps).toEqual([
      { id: 'basic', fields: ['target_env', 'dry_run'] },
      { id: 'advanced', fields: ['rollout_percent'] },
    ]);
  });

  it('fails when required params are not shared across repos', () => {
    const providerDataA = withRepoRunActionsMetadata(undefined, {
      actions: {
        deploy: {
          parameters: [
            {
              id: 'required_only_a',
              label: 'A only',
              type: 'string',
              uiMode: 'text',
              required: true,
              sensitive: false,
            },
          ],
          steps: [{ id: 'main', fields: ['required_only_a'] }],
        },
      },
      syncedAt: '2024-01-01T00:00:00Z',
      sourceRef: 'main',
    });
    const providerDataB = withRepoRunActionsMetadata(undefined, {
      actions: {
        deploy: {
          parameters: [],
          steps: [],
        },
      },
      syncedAt: '2024-01-01T00:00:00Z',
      sourceRef: 'main',
    });

    expect(() =>
      resolveRunActionMetadataForRepos('deploy', [providerDataA, providerDataB]),
    ).toThrow('required params not shared');
  });
});

describe('normalizeRunActionParams', () => {
  const metadata: RepoRunActionMetadata = {
    parameters: [
      {
        id: 'target_env',
        label: 'Target env',
        type: 'string',
        uiMode: 'select',
        required: true,
        options: ['staging', 'prod'],
        sensitive: false,
      },
      {
        id: 'dry_run',
        label: 'Dry run',
        type: 'boolean',
        uiMode: 'boolean',
        required: false,
        default: false,
        sensitive: false,
      },
      {
        id: 'token',
        label: 'Token',
        type: 'string',
        uiMode: 'secret',
        required: false,
        sensitive: true,
      },
    ],
    steps: [{ id: 'main', fields: ['target_env', 'dry_run', 'token'] }],
  };

  it('normalizes values and returns sensitive values for redaction', () => {
    const result = normalizeRunActionParams(
      {
        target_env: 'staging',
        dry_run: 'true',
        token: 'shh',
      },
      metadata,
    );

    expect(result.normalized).toEqual({
      target_env: 'staging',
      dry_run: true,
      token: 'shh',
    });
    expect(result.sensitiveValues).toEqual(['shh']);
  });

  it('fails on missing required params or unknown keys', () => {
    expect(() => normalizeRunActionParams({ dry_run: true }, metadata)).toThrow(
      'Missing required run param "target_env"',
    );
    expect(() => normalizeRunActionParams({ target_env: 'prod', unknown: 'x' }, metadata)).toThrow(
      'unknown keys',
    );
  });
});
