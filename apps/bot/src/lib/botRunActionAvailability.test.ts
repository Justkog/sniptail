import { describe, expect, it } from 'vitest';
import { withRepoRunActionsMetadata } from '@sniptail/core/repos/runActions.js';
import type { BotConfig } from '@sniptail/core/config/config.js';
import { computeAvailableRunActions } from './botRunActionAvailability.js';

function makeConfig(): BotConfig {
  return {
    repoAllowlistPath: '/tmp/allowlist.json',
    repoAllowlist: {
      repoA: {
        providerData: withRepoRunActionsMetadata(undefined, {
          actionIds: ['refresh-docs', 'lint-all'],
          syncedAt: '2026-01-01T00:00:00.000Z',
          sourceRef: 'main',
        }),
        sshUrl: 'git@example.com/org/repo-a.git',
      },
      repoB: {
        providerData: withRepoRunActionsMetadata(undefined, {
          actionIds: ['refresh-docs', 'test-all'],
          syncedAt: '2026-01-01T00:00:00.000Z',
          sourceRef: 'main',
        }),
        sshUrl: 'git@example.com/org/repo-b.git',
      },
    },
    jobWorkRoot: '/tmp/jobs',
    queueDriver: 'inproc',
    jobRegistryDriver: 'sqlite',
    jobRegistryPath: '/tmp/registry',
    botName: 'Sniptail',
    debugJobSpecMessages: false,
    primaryAgent: 'codex',
    bootstrapServices: [],
    enabledChannels: ['slack'],
    channels: {
      slack: { enabled: true },
      discord: { enabled: false },
    },
    slackEnabled: true,
    discordEnabled: false,
    permissions: {
      defaultEffect: 'allow',
      approvalTtlSeconds: 86400,
      groupCacheTtlSeconds: 60,
      rules: [],
    },
    run: {
      actions: {
        'refresh-docs': { label: 'Refresh docs' },
        'lint-all': { label: 'Lint all repos' },
      },
    },
  } as BotConfig;
}

describe('run action availability helper', () => {
  it('returns only common configured run actions across selected repos', () => {
    const config = makeConfig();

    const actions = computeAvailableRunActions(config, ['repoA', 'repoB']);

    expect(actions).toEqual([
      {
        id: 'refresh-docs',
        label: 'Refresh docs',
      },
    ]);
  });

  it('returns configured actions that exist in repo metadata for selected repos', () => {
    const config = makeConfig();

    const actions = computeAvailableRunActions(config, ['repoA']);

    expect(actions).toEqual([
      {
        id: 'lint-all',
        label: 'Lint all repos',
      },
      {
        id: 'refresh-docs',
        label: 'Refresh docs',
      },
    ]);
  });
});
