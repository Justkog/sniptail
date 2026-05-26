import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleDiscordAgentSessionsAutocomplete,
  handleDiscordAgentSessionsCommand,
} from './discordAgentSessionsCommand.js';
import { getPendingDiscordAgentSessionBrowserRequest } from '../../state.js';

type AuthorizedAgentSessionsOperation = {
  action: 'agent.start';
  operation: {
    targetWorkerId: string;
    event: {
      requestId: string;
      type: 'agent.sessions.list';
      payload: {
        workerId: string;
        agentProfileKey?: string;
        pageSize: number;
        filters?: {
          workspaceKey?: string;
          cwd?: string;
        };
      };
    };
  };
};

const hoisted = vi.hoisted(() => ({
  loadAgentCommandMetadata: vi.fn(),
  enqueueWorkerMailboxEvent: vi.fn(),
  authorizeDiscordOperationAndRespond: vi.fn(),
  createJobId: vi.fn(() => 'request-1'),
  buildWorkspaceAutocompleteChoices: vi.fn(),
  buildProfileAutocompleteChoices: vi.fn(),
  buildCwdAutocompleteChoices: vi.fn(),
  buildAgentWorkerChoices: vi.fn(),
}));

vi.mock('../../../agentCommandMetadataCache.js', () => ({
  loadAgentCommandMetadata: hoisted.loadAgentCommandMetadata,
  buildWorkspaceAutocompleteChoices: hoisted.buildWorkspaceAutocompleteChoices,
  buildProfileAutocompleteChoices: hoisted.buildProfileAutocompleteChoices,
  buildCwdAutocompleteChoices: hoisted.buildCwdAutocompleteChoices,
}));

vi.mock('../../../agentCommandWorkerRouting.js', () => ({
  buildAgentWorkerChoices: hoisted.buildAgentWorkerChoices,
}));

vi.mock('@sniptail/core/queue/queue.js', () => ({
  enqueueWorkerMailboxEvent: hoisted.enqueueWorkerMailboxEvent,
}));

vi.mock('../../../lib/jobs.js', () => ({
  createJobId: hoisted.createJobId,
}));

vi.mock('../../permissions/discordPermissionGuards.js', () => ({
  authorizeDiscordOperationAndRespond: hoisted.authorizeDiscordOperationAndRespond,
}));

vi.mock('@sniptail/core/logger.js', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

function createMetadata() {
  return {
    enabled: true,
    aggregated: {
      liveWorkers: [
        {
          workerId: 'worker-a',
          workerLabel: 'Worker A',
          workspaces: [{ key: 'snatch' }],
          profiles: [{ key: 'build', provider: 'acp' }],
        },
      ],
    },
  } as never;
}

function buildInteraction(overrides: Record<string, unknown> = {}) {
  return {
    applicationId: 'app-1',
    token: 'token-1',
    channelId: 'channel-1',
    guildId: 'guild-1',
    user: { id: 'user-1' },
    member: {},
    client: {},
    channel: { isThread: () => false },
    options: {
      getString: vi.fn((name: string) => {
        if (name === 'worker') return 'worker-a';
        if (name === 'agent_profile') return 'build';
        if (name === 'workspace') return 'snatch';
        if (name === 'cwd') return 'apps/worker';
        return null;
      }),
    },
    reply: vi.fn(),
    deferReply: vi.fn(),
    editReply: vi.fn(),
    ...overrides,
  };
}

describe('handleDiscordAgentSessionsCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.loadAgentCommandMetadata.mockResolvedValue(createMetadata());
    hoisted.enqueueWorkerMailboxEvent.mockResolvedValue(undefined);
    hoisted.authorizeDiscordOperationAndRespond.mockResolvedValue(true);
    hoisted.buildWorkspaceAutocompleteChoices.mockResolvedValue([]);
    hoisted.buildProfileAutocompleteChoices.mockResolvedValue([]);
    hoisted.buildCwdAutocompleteChoices.mockReturnValue([]);
    hoisted.buildAgentWorkerChoices.mockReturnValue([
      { name: 'Worker A (worker-a)', value: 'worker-a' },
    ]);
  });

  it('enqueues a session list request for the selected worker', async () => {
    const interaction = buildInteraction();

    await handleDiscordAgentSessionsCommand(
      interaction as never,
      { botName: 'Sniptail' } as never,
      {} as never,
      {} as never,
    );

    expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(interaction.editReply).toHaveBeenCalledWith('Loading agent sessions...');
    const authorizeCalls = hoisted.authorizeDiscordOperationAndRespond.mock.calls as Array<
      [AuthorizedAgentSessionsOperation]
    >;
    const [authorization] = authorizeCalls[0] ?? [];

    expect(authorization).toMatchObject({
      action: 'agent.start',
      operation: {
        targetWorkerId: 'worker-a',
        event: {
          requestId: 'request-1',
          type: 'agent.sessions.list',
          payload: {
            workerId: 'worker-a',
            agentProfileKey: 'build',
            pageSize: 4,
            filters: {
              workspaceKey: 'snatch',
              cwd: 'apps/worker',
            },
          },
        },
      },
    });
    expect(hoisted.enqueueWorkerMailboxEvent).toHaveBeenCalledWith(
      {},
      'worker-a',
      expect.objectContaining({ type: 'agent.sessions.list' }),
    );
  });

  it('clears pending browser state when enqueue fails after storing it', async () => {
    hoisted.enqueueWorkerMailboxEvent.mockRejectedValueOnce(new Error('queue down'));
    const interaction = buildInteraction();

    await handleDiscordAgentSessionsCommand(
      interaction as never,
      { botName: 'Sniptail' } as never,
      {} as never,
      {} as never,
    );

    expect(interaction.editReply).toHaveBeenCalledWith(
      'Failed to request the session list. Please try again shortly.',
    );
    expect(getPendingDiscordAgentSessionBrowserRequest('request-1')).toBeUndefined();
  });

  it('rejects cwd without workspace', async () => {
    const interaction = buildInteraction({
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'worker') return 'worker-a';
          if (name === 'cwd') return 'apps/worker';
          return null;
        }),
      },
    });

    await handleDiscordAgentSessionsCommand(
      interaction as never,
      { botName: 'Sniptail' } as never,
      {} as never,
      {} as never,
    );

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'A workspace selector is required when cwd is provided.',
      ephemeral: true,
    });
    expect(hoisted.enqueueWorkerMailboxEvent).not.toHaveBeenCalled();
  });

  it('rejects unknown worker selections', async () => {
    const interaction = buildInteraction({
      options: {
        getString: vi.fn((name: string) => (name === 'worker' ? 'worker-missing' : null)),
      },
    });

    await handleDiscordAgentSessionsCommand(
      interaction as never,
      { botName: 'Sniptail' } as never,
      {} as never,
      {} as never,
    );

    expect(interaction.reply).toHaveBeenCalledWith({
      content: 'Worker `worker-missing` is not live. Refresh the worker list and try again.',
      ephemeral: true,
    });
  });

  it('autocompletes live workers', async () => {
    const interaction = {
      options: {
        getFocused: vi.fn(() => ({ name: 'worker', value: 'worker' })),
        getString: vi.fn((name: string) => {
          if (name === 'workspace') return 'snatch';
          if (name === 'agent_profile') return 'build';
          return null;
        }),
      },
      respond: vi.fn(),
    };

    await handleDiscordAgentSessionsAutocomplete(interaction as never);

    expect(hoisted.buildAgentWorkerChoices).toHaveBeenCalledWith(
      createMetadata(),
      'snatch',
      'build',
    );
    expect(interaction.respond).toHaveBeenCalledWith([
      { name: 'Worker A (worker-a)', value: 'worker-a' },
    ]);
  });

  it('filters worker autocomplete choices after profile and workspace scoping', async () => {
    hoisted.buildAgentWorkerChoices.mockReturnValue([
      { name: 'Worker A (worker-a)', value: 'worker-a' },
      { name: 'Worker B (worker-b)', value: 'worker-b' },
    ]);
    const interaction = {
      options: {
        getFocused: vi.fn(() => ({ name: 'worker', value: 'worker-b' })),
        getString: vi.fn((name: string) => {
          if (name === 'workspace') return 'snatch';
          if (name === 'agent_profile') return 'build';
          return null;
        }),
      },
      respond: vi.fn(),
    };

    await handleDiscordAgentSessionsAutocomplete(interaction as never);

    expect(interaction.respond).toHaveBeenCalledWith([
      { name: 'Worker B (worker-b)', value: 'worker-b' },
    ]);
  });
});
