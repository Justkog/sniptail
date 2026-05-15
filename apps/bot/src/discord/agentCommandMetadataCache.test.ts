import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCwdAutocompleteChoices,
  buildProfileAutocompleteChoices,
  buildWorkspaceAutocompleteChoices,
  clearAgentCommandMetadata,
  loadAgentCommandMetadata,
} from '../agentCommandMetadataCache.js';

const hoisted = vi.hoisted(() => ({
  loadAggregatedAgentCapabilitySnapshot: vi.fn(),
}));

vi.mock('@sniptail/core/registry/registryCapabilities.js', () => ({
  loadAggregatedAgentCapabilitySnapshot: hoisted.loadAggregatedAgentCapabilitySnapshot,
}));

describe('agentCommandMetadataCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.loadAggregatedAgentCapabilitySnapshot.mockResolvedValue({
      aggregated: {
        generatedAt: '2026-01-01T00:00:00.000Z',
        staleAfterMs: 30_000,
        workers: [],
        liveWorkers: [{ workerId: 'worker-a' }],
        staleWorkers: [],
        disabledWorkers: [],
        workspaces: [
          { key: 'snatch', status: 'available', label: 'Snatch', workerIds: ['worker-a'], workers: [] },
          { key: 'tools', status: 'available', label: 'Tools', workerIds: ['worker-a'], workers: [] },
        ],
        profiles: [
          {
            key: 'build',
            status: 'available',
            provider: 'opencode',
            profile: 'build',
            label: 'Build',
            workerIds: ['worker-a'],
            workers: [],
          },
          {
            key: 'plan',
            status: 'available',
            provider: 'opencode',
            profile: 'plan',
            label: 'Plan',
            workerIds: ['worker-a'],
            workers: [],
          },
        ],
      },
      activeSessionCounts: { 'worker-a': 1 },
    });
  });

  afterEach(() => {
    clearAgentCommandMetadata();
  });

  it('returns no autocomplete choices when metadata is unavailable', async () => {
    hoisted.loadAggregatedAgentCapabilitySnapshot.mockResolvedValueOnce({
      aggregated: {
        generatedAt: '2026-01-01T00:00:00.000Z',
        staleAfterMs: 30_000,
        workers: [],
        liveWorkers: [],
        staleWorkers: [],
        disabledWorkers: [],
        workspaces: [],
        profiles: [],
      },
      activeSessionCounts: {},
    });
    expect(await buildWorkspaceAutocompleteChoices('sn')).toEqual([]);
    expect(await buildProfileAutocompleteChoices('bu')).toEqual([]);
  });

  it('builds autocomplete choices when metadata is enabled', async () => {
    expect(await buildWorkspaceAutocompleteChoices('sn')).toEqual([
      { name: 'Snatch (snatch)', value: 'snatch' },
    ]);
    expect(await buildProfileAutocompleteChoices('pl')).toEqual([
      { name: 'Plan (plan)', value: 'plan' },
    ]);
  });

  it('ranks preferred workspace and profile first', async () => {
    expect(await buildWorkspaceAutocompleteChoices('', 'snatch')).toEqual([
      { name: 'Snatch (snatch)', value: 'snatch' },
      { name: 'Tools (tools)', value: 'tools' },
    ]);
    expect(await buildProfileAutocompleteChoices('', 'build')).toEqual([
      { name: 'Build (build)', value: 'build' },
      { name: 'Plan (plan)', value: 'plan' },
    ]);
  });

  it('filters conflicted profiles out of autocomplete results', async () => {
    hoisted.loadAggregatedAgentCapabilitySnapshot.mockResolvedValueOnce({
      aggregated: {
        generatedAt: '2026-01-01T00:00:00.000Z',
        staleAfterMs: 30_000,
        workers: [],
        liveWorkers: [{ workerId: 'worker-a' }],
        staleWorkers: [],
        disabledWorkers: [],
        workspaces: [{ key: 'snatch', status: 'available', workerIds: ['worker-a'], workers: [] }],
        profiles: [
          { key: 'build', status: 'conflicted', workerIds: ['worker-a'], workers: [] },
          { key: 'plan', status: 'available', provider: 'opencode', profile: 'plan', label: 'Plan', workerIds: ['worker-a'], workers: [] },
        ],
      },
      activeSessionCounts: {},
    });

    expect(await buildProfileAutocompleteChoices('')).toEqual([
      { name: 'Plan (plan)', value: 'plan' },
    ]);
  });

  it('reuses the cached registry snapshot within the ttl window', async () => {
    await loadAgentCommandMetadata();
    await loadAgentCommandMetadata();

    expect(hoisted.loadAggregatedAgentCapabilitySnapshot).toHaveBeenCalledTimes(1);
  });

  it('returns the sticky cwd when it matches the query', () => {
    expect(buildCwdAutocompleteChoices('', 'apps/worker')).toEqual([
      { name: 'apps/worker', value: 'apps/worker' },
    ]);
    expect(buildCwdAutocompleteChoices('worker', 'apps/worker')).toEqual([
      { name: 'apps/worker', value: 'apps/worker' },
    ]);
    expect(buildCwdAutocompleteChoices('bot', 'apps/worker')).toEqual([]);
  });
});
