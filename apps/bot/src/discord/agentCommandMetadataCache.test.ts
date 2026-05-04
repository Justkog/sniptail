import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCwdAutocompleteChoices,
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

  it('ranks preferred workspace and profile first', () => {
    setDiscordAgentCommandMetadata({
      enabled: true,
      workspaces: [
        { key: 'tools', label: 'Tools' },
        { key: 'snatch', label: 'Snatch' },
      ],
      profiles: [
        { key: 'plan', provider: 'opencode', name: 'plan', label: 'Plan' },
        { key: 'build', provider: 'opencode', name: 'build', label: 'Build' },
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
