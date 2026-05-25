import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  config: {
    workerId: 'worker-a',
    repoAllowlistPath: undefined,
  },
  handleAgentSessionsList: vi.fn(() => Promise.resolve(undefined)),
  handleAgentSessionPreview: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('@sniptail/core/config/config.js', () => ({
  loadWorkerConfig: () => hoisted.config,
}));

vi.mock('@sniptail/core/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@sniptail/core/codex/status.js', () => ({
  fetchCodexUsageMessage: vi.fn(),
}));

vi.mock('./bootstrap.js', () => ({
  runBootstrap: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('./repos/repoCatalogMutationService.js', () => ({
  addRepoCatalogEntryFromInput: vi.fn(),
  removeRepoCatalogEntryFromInput: vi.fn(),
}));

vi.mock('./agent-command/agentSessionRunner.js', () => ({
  runAgentSessionStart: vi.fn(),
  runAgentSessionMessage: vi.fn(),
}));

vi.mock('./agent-command/resolveAgentInteraction.js', () => ({
  resolveAgentInteraction: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('./agent-command/stopAgentPrompt.js', () => ({
  stopAgentPrompt: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('./agent-command/handleAgentSessionsList.js', () => ({
  handleAgentSessionsList: hoisted.handleAgentSessionsList,
}));

vi.mock('./agent-command/handleAgentSessionPreview.js', () => ({
  handleAgentSessionPreview: hoisted.handleAgentSessionPreview,
}));

import { handleWorkerEvent } from './workerEvents.js';

describe('workerEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.handleAgentSessionsList.mockResolvedValue(undefined);
    hoisted.handleAgentSessionPreview.mockResolvedValue(undefined);
  });

  it('routes agent.sessions.list events to the list handler', async () => {
    const botEvents = {
      publish: vi.fn(() => Promise.resolve(undefined)),
    };
    const registry = {
      markJobForDeletion: vi.fn(),
      clearJobsBefore: vi.fn(),
    } as never;
    const event = {
      schemaVersion: 1,
      requestId: 'request-1',
      type: 'agent.sessions.list',
      payload: {
        response: {
          provider: 'slack',
          channelId: 'channel-1',
          userId: 'user-1',
        },
        workerId: 'worker-a',
        pageSize: 5,
      },
    } as const;

    await handleWorkerEvent(event, registry, botEvents);

    expect(hoisted.handleAgentSessionsList).toHaveBeenCalledWith({
      event,
      config: hoisted.config,
      botEvents,
    });
  });

  it('routes agent.session.preview events to the preview handler', async () => {
    const botEvents = {
      publish: vi.fn(() => Promise.resolve(undefined)),
    };
    const registry = {
      markJobForDeletion: vi.fn(),
      clearJobsBefore: vi.fn(),
    } as never;
    const event = {
      schemaVersion: 1,
      requestId: 'request-1',
      type: 'agent.session.preview',
      payload: {
        response: {
          provider: 'discord',
          channelId: 'channel-1',
          threadId: 'thread-1',
          userId: 'user-1',
          guildId: 'guild-1',
        },
        sessionId: 'sniptail-session-1',
        workerId: 'worker-a',
        agentProfileKey: 'build',
        provider: 'opencode',
        providerSessionId: 'provider-session-1',
      },
    } as const;

    await handleWorkerEvent(event, registry, botEvents);

    expect(hoisted.handleAgentSessionPreview).toHaveBeenCalledWith({
      event,
      config: hoisted.config,
      botEvents,
    });
  });
});
