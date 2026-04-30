import { afterEach, describe, expect, it } from 'vitest';
import {
  buildProfileAutocompleteChoices,
  buildWorkspaceAutocompleteChoices,
  clearDiscordAgentCommandMetadata,
  resolveAgentProfileSelection,
  resolveAgentWorkspaceSelection,
  setDiscordAgentCommandMetadata,
} from './agentCommandMetadataCache.js';

describe('agentCommandMetadataCache', () => {
  afterEach(() => {
    clearDiscordAgentCommandMetadata();
  });

  it('returns no autocomplete choices when metadata is unavailable', () => {
    expect(buildWorkspaceAutocompleteChoices('sn')).toEqual([]);
    expect(buildProfileAutocompleteChoices('bu')).toEqual([]);
  });

  it('builds autocomplete choices when metadata is enabled', () => {
    setDiscordAgentCommandMetadata({
      enabled: true,
      defaultWorkspace: 'snatch',
      defaultAgentProfile: 'build',
      workspaces: [
        { key: 'snatch', label: 'Snatch' },
        { key: 'tools', label: 'Tools' },
      ],
      profiles: [
        { key: 'build', provider: 'opencode', name: 'build', label: 'Build' },
        { key: 'plan', provider: 'opencode', name: 'plan', label: 'Plan' },
      ],
      receivedAt: new Date().toISOString(),
    });

    expect(buildWorkspaceAutocompleteChoices('sn')).toEqual([
      { name: 'Snatch (snatch)', value: 'snatch' },
    ]);
    expect(buildProfileAutocompleteChoices('pl')).toEqual([{ name: 'Plan (plan)', value: 'plan' }]);
  });

  it('resolves explicit and default selections', () => {
    setDiscordAgentCommandMetadata({
      enabled: true,
      defaultWorkspace: 'snatch',
      defaultAgentProfile: 'build',
      workspaces: [{ key: 'snatch' }],
      profiles: [{ key: 'build', provider: 'opencode', name: 'build' }],
      receivedAt: new Date().toISOString(),
    });

    expect(resolveAgentWorkspaceSelection()).toBe('snatch');
    expect(resolveAgentProfileSelection()).toBe('build');
    expect(resolveAgentWorkspaceSelection('snatch')).toBe('snatch');
    expect(resolveAgentProfileSelection('build')).toBe('build');
    expect(resolveAgentWorkspaceSelection('missing')).toBeUndefined();
    expect(resolveAgentProfileSelection('missing')).toBeUndefined();
  });
});
