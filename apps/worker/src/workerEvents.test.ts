import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  config: {
    repoAllowlistPath: undefined,
    agent: {
      enabled: true,
      defaultWorkspace: 'snatch',
      defaultAgentProfile: 'build',
      workspaces: {
        snatch: { label: 'Snatch' },
      },
      profiles: {
        build: { provider: 'opencode', name: 'build', label: 'Build' },
      },
    },
  },
}));

vi.mock('@sniptail/core/config/config.js', () => ({
  loadWorkerConfig: () => hoisted.config,
}));

vi.mock('@sniptail/core/codex/status.js', () => ({
  fetchCodexUsageMessage: vi.fn(),
}));

vi.mock('@sniptail/core/logger.js', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('./agent-command/agentSessionRunner.js', () => ({
  runAgentSessionMessage: vi.fn(),
  runAgentSessionStart: vi.fn(),
}));

vi.mock('./agent-command/resolveAgentInteraction.js', () => ({
  resolveAgentInteraction: vi.fn(),
}));

vi.mock('./agent-command/stopAgentPrompt.js', () => ({
  stopAgentPrompt: vi.fn(),
}));

vi.mock('./channels/createNotifier.js', () => ({
  createNotifier: vi.fn(() => ({
    postMessage: vi.fn(),
  })),
}));

vi.mock('./channels/workerChannelAdapters.js', () => ({
  resolveWorkerChannelAdapter: vi.fn(() => ({
    buildCodexUsageReplyEvent: vi.fn(),
  })),
}));

vi.mock('./repos/repoCatalogMutationService.js', () => ({
  addRepoCatalogEntryFromInput: vi.fn(),
  removeRepoCatalogEntryFromInput: vi.fn(),
}));

import { handleWorkerEvent } from './workerEvents.js';

describe('handleWorkerEvent agent metadata routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishes a Discord metadata update only for a Discord request', async () => {
    const publish = vi.fn(() => Promise.resolve(undefined));
    await handleWorkerEvent(
      {
        schemaVersion: 1,
        type: 'agent.metadata.request',
        payload: { provider: 'discord' },
      },
      {} as never,
      { publish },
    );

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'discord',
        type: 'agent.metadata.update',
      }),
    );
  });

  it('publishes a Slack metadata update only for a Slack request', async () => {
    const publish = vi.fn(() => Promise.resolve(undefined));
    await handleWorkerEvent(
      {
        schemaVersion: 1,
        type: 'agent.metadata.request',
        payload: { provider: 'slack' },
      },
      {} as never,
      { publish },
    );

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'slack',
        type: 'agent.metadata.update',
      }),
    );
  });
});
