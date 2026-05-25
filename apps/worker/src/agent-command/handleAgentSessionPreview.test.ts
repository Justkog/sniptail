import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreBotEvent } from '@sniptail/core/types/bot-event.js';
import type { CoreWorkerEvent } from '@sniptail/core/types/worker-event.js';
import { handleAgentSessionPreview } from './handleAgentSessionPreview.js';
import type { AgentSessionPreviewAdapterRegistry } from './agentSessionPreviewAdapters.js';

function createConfig() {
  return {
    workerId: 'worker-a',
    repoCacheRoot: '/tmp/sniptail/repos',
    agent: {
      enabled: true,
      workspaces: {
        snatch: {
          path: '/tmp/snatch',
        },
      },
      profiles: {
        build: {
          provider: 'opencode',
          profile: 'build',
        },
        acp: {
          provider: 'acp',
          agent: 'opencode',
          command: ['opencode', 'acp'],
        },
      },
    },
    opencode: {
      executionMode: 'local',
    },
  } as never;
}

function createPreviewEvent(
  overrides: Partial<CoreWorkerEvent<'agent.session.preview'>['payload']> = {},
): CoreWorkerEvent<'agent.session.preview'> {
  return {
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
      workspaceKey: 'snatch',
      cwd: 'apps/worker',
      ...overrides,
    },
  };
}

describe('handleAgentSessionPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishes the latest OpenCode assistant preview', async () => {
    const botEvents = { publish: vi.fn(() => Promise.resolve(undefined)) };
    const previewSession = vi.fn().mockResolvedValue({
      message: {
        role: 'agent',
        text: 'Latest assistant response',
      },
    });
    const adapters: AgentSessionPreviewAdapterRegistry = {
      opencode: {
        provider: 'opencode',
        previewSession,
      },
    };

    await handleAgentSessionPreview({
      event: createPreviewEvent(),
      config: createConfig(),
      botEvents,
      adapters,
    });

    expect(previewSession).toHaveBeenCalledWith(
      expect.objectContaining({
        providerSessionId: 'provider-session-1',
        workspaceKey: 'snatch',
        cwd: 'apps/worker',
      }),
    );
    const publishCalls = botEvents.publish.mock.calls as Array<
      [CoreBotEvent<'agent.session.previewed'>]
    >;
    const [event] = publishCalls[0] ?? [];
    expect(event).toMatchObject({
      provider: 'discord',
      type: 'agent.session.previewed',
      payload: {
        channelId: 'channel-1',
        threadId: 'thread-1',
        provider: 'opencode',
        providerSessionId: 'provider-session-1',
        message: {
          role: 'agent',
          text: 'Latest assistant response',
        },
      },
    });
  });

  it('publishes unavailable previews for unsupported providers', async () => {
    const botEvents = { publish: vi.fn(() => Promise.resolve(undefined)) };

    await handleAgentSessionPreview({
      event: createPreviewEvent({
        agentProfileKey: 'acp',
        provider: 'acp',
      }),
      config: createConfig(),
      botEvents,
      adapters: {},
    });

    const publishCalls = botEvents.publish.mock.calls as Array<
      [CoreBotEvent<'agent.session.previewed'>]
    >;
    const [event] = publishCalls[0] ?? [];
    expect(event.payload.errorMessage).toContain(
      'does not expose previous-session message history',
    );
  });

  it('publishes an error when the selected profile provider no longer matches', async () => {
    const botEvents = { publish: vi.fn(() => Promise.resolve(undefined)) };

    await handleAgentSessionPreview({
      event: createPreviewEvent({
        provider: 'copilot',
      }),
      config: createConfig(),
      botEvents,
      adapters: {},
    });

    const publishCalls = botEvents.publish.mock.calls as Array<
      [CoreBotEvent<'agent.session.previewed'>]
    >;
    const [event] = publishCalls[0] ?? [];
    expect(event.payload.errorMessage).toContain('provider no longer matches');
  });
});
