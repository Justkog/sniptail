import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCwdAutocompleteChoices,
  buildProfileAutocompleteChoices,
  buildWorkspaceAutocompleteChoices,
  clearAgentCommandMetadata,
  setAgentCommandMetadata,
} from '../agentCommandMetadataCache.js';

describe('agentCommandMetadataCache', () => {
  afterEach(() => {
    clearAgentCommandMetadata();
  });

  it('returns no autocomplete choices when metadata is unavailable', () => {
    expect(buildWorkspaceAutocompleteChoices('sn')).toEqual([]);
    expect(buildProfileAutocompleteChoices('bu')).toEqual([]);
  });

  it('builds autocomplete choices when metadata is enabled', () => {
    setAgentCommandMetadata({
      enabled: true,
      workspaces: [
        { key: 'snatch', label: 'Snatch' },
        { key: 'tools', label: 'Tools' },
      ],
      profiles: [
        { key: 'build', provider: 'opencode', profile: 'build', label: 'Build' },
        { key: 'plan', provider: 'opencode', profile: 'plan', label: 'Plan' },
      ],
      receivedAt: new Date().toISOString(),
    });

    expect(buildWorkspaceAutocompleteChoices('sn')).toEqual([
      { name: 'Snatch (snatch)', value: 'snatch' },
    ]);
    expect(buildProfileAutocompleteChoices('pl')).toEqual([{ name: 'Plan (plan)', value: 'plan' }]);
  });

  it('ranks preferred workspace and profile first', () => {
    setAgentCommandMetadata({
      enabled: true,
      workspaces: [
        { key: 'tools', label: 'Tools' },
        { key: 'snatch', label: 'Snatch' },
      ],
      profiles: [
        { key: 'plan', provider: 'opencode', profile: 'plan', label: 'Plan' },
        { key: 'build', provider: 'opencode', profile: 'build', label: 'Build' },
      ],
      receivedAt: new Date().toISOString(),
    });

    expect(buildWorkspaceAutocompleteChoices('', 'snatch')).toEqual([
      { name: 'Snatch (snatch)', value: 'snatch' },
      { name: 'Tools (tools)', value: 'tools' },
    ]);
    expect(buildProfileAutocompleteChoices('', 'build')).toEqual([
      { name: 'Build (build)', value: 'build' },
      { name: 'Plan (plan)', value: 'plan' },
    ]);
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
