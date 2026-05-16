import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { loadDiscordContextFiles } from '../../lib/discordContextFiles.js';
import { handleAgentAutocomplete, handleAgentStart } from './agent.js';

const hoisted = vi.hoisted(() => ({
  loadDiscordAgentDefaults: vi.fn(),
  upsertDiscordAgentDefaults: vi.fn(),
  createAgentSession: vi.fn(),
  updateAgentSessionStatus: vi.fn(),
  enqueueWorkerMailboxEvent: vi.fn(),
  authorizeDiscordPrecheckAndRespond: vi.fn(),
  authorizeDiscordOperationAndRespond: vi.fn(),
  loadAgentCommandMetadata: vi.fn(),
  findAgentWorkspaceMetadata: vi.fn(),
  findAgentProfileMetadata: vi.fn(),
  buildCwdAutocompleteChoices: vi.fn(),
  buildProfileAutocompleteChoices: vi.fn(),
  buildWorkspaceAutocompleteChoices: vi.fn(),
  buildAgentWorkerChoices: vi.fn(),
  buildAgentWorkerSelectionError: vi.fn(),
  resolveAgentStartWorker: vi.fn(),
  postDiscordMessage: vi.fn(),
  loadDiscordContextFiles: vi.fn(),
  auditAgentSessionStart: vi.fn(),
}));

vi.mock('@sniptail/core/agent-defaults/registry.js', () => ({
  loadDiscordAgentDefaults: hoisted.loadDiscordAgentDefaults,
  upsertDiscordAgentDefaults: hoisted.upsertDiscordAgentDefaults,
}));

vi.mock('@sniptail/core/agent-sessions/registry.js', () => ({
  createAgentSession: hoisted.createAgentSession,
  updateAgentSessionStatus: hoisted.updateAgentSessionStatus,
}));

vi.mock('@sniptail/core/queue/queue.js', () => ({
  enqueueWorkerMailboxEvent: hoisted.enqueueWorkerMailboxEvent,
}));

vi.mock('@sniptail/core/logger.js', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@sniptail/core/discord/components.js', () => ({
  buildDiscordAgentStopComponents: vi.fn(() => []),
}));

vi.mock('../../permissions/discordPermissionGuards.js', () => ({
  authorizeDiscordPrecheckAndRespond: hoisted.authorizeDiscordPrecheckAndRespond,
  authorizeDiscordOperationAndRespond: hoisted.authorizeDiscordOperationAndRespond,
}));

vi.mock('../../../agentCommandMetadataCache.js', () => ({
  buildCwdAutocompleteChoices: hoisted.buildCwdAutocompleteChoices,
  buildProfileAutocompleteChoices: hoisted.buildProfileAutocompleteChoices,
  buildWorkspaceAutocompleteChoices: hoisted.buildWorkspaceAutocompleteChoices,
  loadAgentCommandMetadata: hoisted.loadAgentCommandMetadata,
  findAgentWorkspaceMetadata: hoisted.findAgentWorkspaceMetadata,
  findAgentProfileMetadata: hoisted.findAgentProfileMetadata,
  listSelectableAgentProfiles: vi.fn(),
}));

vi.mock('../../../agentCommandWorkerRouting.js', () => ({
  buildAgentWorkerChoices: hoisted.buildAgentWorkerChoices,
  buildAgentWorkerSelectionError: hoisted.buildAgentWorkerSelectionError,
  resolveAgentStartWorker: hoisted.resolveAgentStartWorker,
}));

vi.mock('../../../agentCommandShared.js', () => ({
  buildAgentSessionStartWorkerEvent: vi.fn(
    (input: {
      session: {
        sessionId: string;
        workspaceKey: string;
        agentProfileKey: string;
        cwd?: string;
      };
      prompt: string;
      contextFiles?: unknown[];
    }) => ({
      type: 'agent.session.start',
      payload: {
        sessionId: input.session.sessionId,
        prompt: input.prompt,
        workspaceKey: input.session.workspaceKey,
        agentProfileKey: input.session.agentProfileKey,
        ...(input.session.cwd ? { cwd: input.session.cwd } : {}),
        ...(input.contextFiles ? { contextFiles: input.contextFiles } : {}),
      },
    }),
  ),
}));

vi.mock('../../helpers.js', () => ({
  isSendableTextChannel: vi.fn(() => true),
  postDiscordMessage: hoisted.postDiscordMessage,
}));

vi.mock('../../../lib/requestAudit.js', () => ({
  auditAgentSessionStart: hoisted.auditAgentSessionStart,
}));

type DiscordContextFilesModule = Record<string, unknown> & {
  loadDiscordContextFiles: typeof loadDiscordContextFiles;
};

vi.mock('../../lib/discordContextFiles.js', async () => {
  const actual = await vi.importActual<DiscordContextFilesModule>(
    '../../lib/discordContextFiles.js',
  );
  return {
    ...actual,
    loadDiscordContextFiles: hoisted.loadDiscordContextFiles,
  };
});

function buildInteraction(overrides: Record<string, unknown> = {}) {
  const channel = {
    isTextBased: () => true,
    isThread: () => false,
  };
  return {
    channelId: 'channel-1',
    guildId: 'guild-1',
    user: { id: 'user-1' },
    member: {},
    client: {
      user: { username: 'Sniptail' },
    },
    channel,
    options: {
      getString: vi.fn((name: string) => {
        if (name === 'prompt') return 'inspect the failing tests';
        if (name === 'workspace') return null;
        if (name === 'agent_profile') return null;
        if (name === 'cwd') return 'apps/bot';
        return null;
      }),
      getAttachment: vi.fn(() => null),
    },
    reply: vi.fn(),
    deferReply: vi.fn(),
    editReply: vi.fn(),
    ...overrides,
  };
}

const config = {
  botName: 'Sniptail',
  agentCommand: {
    defaultWorkspace: 'snatch',
    defaultAgentProfile: 'build',
  },
};
const queueRuntime = {};
const permissions = {};

describe('handleAgentStart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.loadAgentCommandMetadata.mockResolvedValue({
      enabled: true,
      workspaces: [{ key: 'snatch' }],
      profiles: [{ key: 'build', status: 'available', provider: 'opencode', profile: 'build' }],
      receivedAt: '2026-01-01T00:00:00.000Z',
    });
    hoisted.findAgentWorkspaceMetadata.mockReturnValue({ key: 'snatch', status: 'available' });
    hoisted.findAgentProfileMetadata.mockReturnValue({
      key: 'build',
      status: 'available',
      provider: 'opencode',
      profile: 'build',
    });
    hoisted.buildAgentWorkerSelectionError.mockReturnValue(undefined);
    hoisted.resolveAgentStartWorker.mockReturnValue({
      workerId: 'worker-a',
      workerLabel: 'Worker A',
    });
    hoisted.buildAgentWorkerChoices.mockReturnValue([]);
    hoisted.authorizeDiscordPrecheckAndRespond.mockResolvedValue(true);
    hoisted.authorizeDiscordOperationAndRespond.mockResolvedValue(true);
    hoisted.buildCwdAutocompleteChoices.mockReturnValue([]);
    hoisted.buildProfileAutocompleteChoices.mockReturnValue([]);
    hoisted.buildWorkspaceAutocompleteChoices.mockReturnValue([]);
    hoisted.loadDiscordAgentDefaults.mockResolvedValue(undefined);
    hoisted.upsertDiscordAgentDefaults.mockResolvedValue(undefined);
    hoisted.createAgentSession.mockResolvedValue(undefined);
    hoisted.updateAgentSessionStatus.mockResolvedValue(undefined);
    hoisted.enqueueWorkerMailboxEvent.mockResolvedValue(undefined);
    hoisted.loadDiscordContextFiles.mockResolvedValue([]);
    hoisted.auditAgentSessionStart.mockReset();
  });

  it('uses the thread starter message as the agent control surface', async () => {
    const startThread = vi.fn().mockResolvedValue({ id: 'thread-1' });
    hoisted.postDiscordMessage.mockResolvedValue({ id: 'message-1', startThread });
    const interaction = buildInteraction();

    await handleAgentStart(
      interaction as never,
      config as never,
      queueRuntime as never,
      permissions as never,
    );

    expect(hoisted.postDiscordMessage).toHaveBeenCalledTimes(1);
    expect(hoisted.postDiscordMessage).toHaveBeenCalledWith(
      interaction.client,
      expect.objectContaining({
        channelId: 'channel-1',
        text: expect.stringContaining('inspect the failing tests') as unknown,
        components: expect.any(Array) as unknown,
      }),
    );
    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({ autoArchiveDuration: 1440 }),
    );
    expect(hoisted.enqueueWorkerMailboxEvent).toHaveBeenCalledWith(
      queueRuntime,
      'worker-a',
      expect.objectContaining({ type: 'agent.session.start' }),
    );
    expect(hoisted.upsertDiscordAgentDefaults).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        guildId: 'guild-1',
        workspaceKey: 'snatch',
        agentProfileKey: 'build',
        cwd: 'apps/bot',
      }),
    );
    expect(hoisted.auditAgentSessionStart).toHaveBeenCalledWith(
      config,
      expect.objectContaining({
        provider: 'discord',
        channelId: 'channel-1',
        threadId: 'thread-1',
        userId: 'user-1',
        requestText: 'inspect the failing tests',
        contextFileCount: 0,
        guildId: 'guild-1',
        workspaceKey: 'snatch',
        agentProfileKey: 'build',
        cwd: 'apps/bot',
      }),
      'accepted',
    );
    const auditCall = hoisted.auditAgentSessionStart.mock.calls[0];
    expect(auditCall?.[1]).toEqual(
      expect.objectContaining({
        sessionId: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        ) as unknown,
      }),
    );
    expect(interaction.editReply).toHaveBeenCalledWith(
      'Agent session started in <#thread-1> on worker `worker-a`.',
    );
  });

  it('includes validated command attachment files in the session start event', async () => {
    const startThread = vi.fn().mockResolvedValue({ id: 'thread-1' });
    hoisted.postDiscordMessage.mockResolvedValue({ id: 'message-1', startThread });
    hoisted.loadDiscordContextFiles.mockResolvedValue([
      {
        originalName: 'diagram.png',
        mediaType: 'image/png',
        byteSize: 7,
        contentBase64: Buffer.from('pngdata').toString('base64'),
        source: {
          provider: 'discord',
          externalId: 'A1',
          metadata: { mediaType: 'image/png' },
        },
      },
    ]);
    const interaction = buildInteraction({
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'prompt') return 'inspect the failing tests';
          if (name === 'workspace') return null;
          if (name === 'agent_profile') return null;
          if (name === 'cwd') return 'apps/bot';
          return null;
        }),
        getAttachment: vi.fn((name: string) => {
          if (name !== 'context_file_1') return null;
          return {
            id: 'A1',
            name: 'diagram.png',
            url: 'https://example.test/A1',
            contentType: 'image/png',
            size: 7,
          };
        }),
      },
    });

    await handleAgentStart(
      interaction as never,
      config as never,
      queueRuntime as never,
      permissions as never,
    );

    expect(hoisted.loadDiscordContextFiles).toHaveBeenCalledWith([
      {
        id: 'A1',
        name: 'diagram.png',
        url: 'https://example.test/A1',
        mediaType: 'image/png',
        byteSize: 7,
      },
    ]);
    expect(hoisted.enqueueWorkerMailboxEvent).toHaveBeenCalledWith(
      queueRuntime,
      'worker-a',
      expect.objectContaining({
        type: 'agent.session.start',
        payload: expect.objectContaining({
          contextFiles: [
            expect.objectContaining({
              originalName: 'diagram.png',
              mediaType: 'image/png',
            }),
          ],
        }) as unknown,
      }),
    );
  });

  it('allows non-image attachments for Codex profiles and enqueues the session', async () => {
    hoisted.loadAgentCommandMetadata.mockResolvedValue({
      enabled: true,
      workspaces: [{ key: 'snatch' }],
      profiles: [{ key: 'build', status: 'available', provider: 'codex', profile: 'deep-review' }],
      receivedAt: '2026-01-01T00:00:00.000Z',
    });
    hoisted.findAgentProfileMetadata.mockReturnValue({
      key: 'build',
      status: 'available',
      provider: 'codex',
      profile: 'deep-review',
    });
    hoisted.loadDiscordContextFiles.mockResolvedValue([
      {
        originalName: 'notes.md',
        mediaType: 'text/markdown',
        byteSize: 7,
        contentBase64: Buffer.from('notes').toString('base64'),
        source: {
          provider: 'discord',
          externalId: 'A2',
          metadata: { mediaType: 'text/markdown' },
        },
      },
    ]);
    const interaction = buildInteraction({
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'prompt') return 'inspect the failing tests';
          if (name === 'workspace') return null;
          if (name === 'agent_profile') return null;
          if (name === 'cwd') return null;
          return null;
        }),
        getAttachment: vi.fn((name: string) => {
          if (name !== 'context_file_1') return null;
          return {
            id: 'A2',
            name: 'notes.md',
            url: 'https://example.test/A2',
            contentType: 'text/markdown',
            size: 7,
          };
        }),
      },
    });

    await handleAgentStart(
      interaction as never,
      config as never,
      queueRuntime as never,
      permissions as never,
    );

    expect(hoisted.postDiscordMessage).toHaveBeenCalled();
    expect(hoisted.createAgentSession).toHaveBeenCalled();
    expect(hoisted.enqueueWorkerMailboxEvent).toHaveBeenCalledWith(
      queueRuntime,
      'worker-a',
      expect.objectContaining({
        type: 'agent.session.start',
        payload: expect.objectContaining({
          contextFiles: [
            expect.objectContaining({
              originalName: 'notes.md',
              mediaType: 'text/markdown',
            }),
          ],
        }) as unknown,
      }),
    );
  });

  it('posts one control message when started inside an existing thread', async () => {
    const interaction = buildInteraction({
      channelId: 'thread-1',
      channel: {
        id: 'thread-1',
        parentId: 'channel-1',
        isTextBased: () => true,
        isThread: () => true,
      },
    });
    hoisted.postDiscordMessage.mockResolvedValue({ id: 'message-1' });

    await handleAgentStart(
      interaction as never,
      config as never,
      queueRuntime as never,
      permissions as never,
    );

    expect(hoisted.postDiscordMessage).toHaveBeenCalledTimes(1);
    expect(hoisted.postDiscordMessage).toHaveBeenCalledWith(
      interaction.client,
      expect.objectContaining({
        channelId: 'channel-1',
        threadId: 'thread-1',
        text: expect.stringContaining('inspect the failing tests') as unknown,
        components: expect.any(Array) as unknown,
      }),
    );
    expect(interaction.editReply).toHaveBeenCalledWith(
      'Agent session started in <#thread-1> on worker `worker-a`.',
    );
  });

  it('audits pending approval separately from denied starts', async () => {
    const startThread = vi.fn().mockResolvedValue({ id: 'thread-1' });
    hoisted.postDiscordMessage.mockResolvedValue({ id: 'message-1', startThread });
    hoisted.authorizeDiscordOperationAndRespond.mockResolvedValue(false);
    const interaction = buildInteraction();

    await handleAgentStart(
      interaction as never,
      config as never,
      queueRuntime as never,
      permissions as never,
    );

    expect(hoisted.auditAgentSessionStart).toHaveBeenCalledWith(
      config,
      expect.objectContaining({
        provider: 'discord',
        channelId: 'channel-1',
        threadId: 'thread-1',
        userId: 'user-1',
      }),
      'pending',
    );
    expect(interaction.editReply).toHaveBeenCalledWith(
      'Session request is pending approval in <#thread-1>.',
    );
  });

  it('audits denied starts as stopped', async () => {
    const startThread = vi.fn().mockResolvedValue({ id: 'thread-1' });
    hoisted.postDiscordMessage.mockResolvedValue({ id: 'message-1', startThread });
    hoisted.authorizeDiscordOperationAndRespond.mockImplementationOnce(
      async (input: { onDeny: () => Promise<void> }) => {
        await input.onDeny();
        return false;
      },
    );
    const interaction = buildInteraction();

    await handleAgentStart(
      interaction as never,
      config as never,
      queueRuntime as never,
      permissions as never,
    );

    expect(hoisted.auditAgentSessionStart).toHaveBeenCalledWith(
      config,
      expect.objectContaining({
        provider: 'discord',
        channelId: 'channel-1',
        threadId: 'thread-1',
        userId: 'user-1',
      }),
      'stopped',
    );
  });

  it('uses persisted defaults when command options are omitted', async () => {
    const startThread = vi.fn().mockResolvedValue({ id: 'thread-1' });
    hoisted.postDiscordMessage.mockResolvedValue({ id: 'message-1', startThread });
    hoisted.loadDiscordAgentDefaults.mockResolvedValue({
      workspaceKey: 'tools',
      agentProfileKey: 'plan',
      cwd: 'apps/worker',
    });
    hoisted.loadAgentCommandMetadata.mockResolvedValue({
      enabled: true,
      workspaces: [{ key: 'snatch' }, { key: 'tools' }],
      profiles: [
        { key: 'build', status: 'available', provider: 'opencode', profile: 'build' },
        { key: 'plan', status: 'available', provider: 'opencode', profile: 'plan' },
      ],
      receivedAt: '2026-01-01T00:00:00.000Z',
    });
    hoisted.findAgentWorkspaceMetadata.mockImplementation((_metadata: unknown, key: string) => ({
      key,
      status: 'available',
    }));
    hoisted.findAgentProfileMetadata.mockImplementation((_metadata: unknown, key: string) => ({
      key,
      status: 'available',
      provider: 'opencode',
      profile: key,
    }));
    const interaction = buildInteraction({
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'prompt') return 'inspect the failing tests';
          return null;
        }),
        getAttachment: vi.fn(() => null),
      },
    });

    await handleAgentStart(
      interaction as never,
      config as never,
      queueRuntime as never,
      permissions as never,
    );

    expect(hoisted.createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceKey: 'tools',
        agentProfileKey: 'plan',
        cwd: 'apps/worker',
      }),
    );
  });

  it('ignores stale persisted workspace defaults and falls back to worker defaults', async () => {
    const startThread = vi.fn().mockResolvedValue({ id: 'thread-1' });
    hoisted.postDiscordMessage.mockResolvedValue({ id: 'message-1', startThread });
    hoisted.loadDiscordAgentDefaults.mockResolvedValue({
      workspaceKey: 'missing',
      agentProfileKey: 'build',
      cwd: 'apps/worker',
    });
    const interaction = buildInteraction({
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'prompt') return 'inspect the failing tests';
          if (name === 'cwd') return null;
          return null;
        }),
        getAttachment: vi.fn(() => null),
      },
    });

    await handleAgentStart(
      interaction as never,
      config as never,
      queueRuntime as never,
      permissions as never,
    );

    expect(hoisted.createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceKey: 'snatch',
        agentProfileKey: 'build',
      }),
    );
    expect(hoisted.createAgentSession).toHaveBeenCalledWith(
      expect.not.objectContaining({
        cwd: 'apps/worker',
      }),
    );
  });

  it('rejects conflicted profiles before session creation', async () => {
    hoisted.findAgentProfileMetadata.mockReturnValue({
      key: 'build',
      status: 'conflicted',
    });
    const interaction = buildInteraction({
      options: {
        getString: vi.fn((name: string) => {
          if (name === 'prompt') return 'inspect the failing tests';
          if (name === 'agent_profile') return 'build';
          if (name === 'workspace') return 'snatch';
          if (name === 'cwd') return 'apps/bot';
          return null;
        }),
        getAttachment: vi.fn(() => null),
      },
    });

    await handleAgentStart(
      interaction as never,
      config as never,
      queueRuntime as never,
      permissions as never,
    );

    expect(interaction.reply).toHaveBeenCalledWith({
      content:
        'Agent profile key: `build` is currently conflicted across live workers. Please ask an operator to fix worker configuration.',
      ephemeral: true,
    });
    expect(hoisted.createAgentSession).not.toHaveBeenCalled();
  });

  it('uses persisted defaults to bias autocomplete choices', async () => {
    hoisted.loadDiscordAgentDefaults.mockResolvedValue({
      workspaceKey: 'snatch',
      agentProfileKey: 'build',
      cwd: 'apps/worker',
    });
    hoisted.buildWorkspaceAutocompleteChoices.mockReturnValue([
      { name: 'snatch', value: 'snatch' },
    ]);
    const interaction = {
      user: { id: 'user-1' },
      guildId: 'guild-1',
      options: {
        getFocused: vi.fn(() => ({ name: 'workspace', value: '' })),
        getString: vi.fn(() => null),
      },
      respond: vi.fn(),
    };

    await handleAgentAutocomplete(interaction as never);

    expect(hoisted.buildWorkspaceAutocompleteChoices).toHaveBeenCalledWith('', 'snatch');
    expect(interaction.respond).toHaveBeenCalledWith([{ name: 'snatch', value: 'snatch' }]);
  });

  it('suppresses sticky cwd autocomplete when another workspace is selected', async () => {
    hoisted.loadDiscordAgentDefaults.mockResolvedValue({
      workspaceKey: 'snatch',
      agentProfileKey: 'build',
      cwd: 'apps/worker',
    });
    const interaction = {
      user: { id: 'user-1' },
      guildId: 'guild-1',
      options: {
        getFocused: vi.fn(() => ({ name: 'cwd', value: '' })),
        getString: vi.fn((name: string) => (name === 'workspace' ? 'tools' : null)),
      },
      respond: vi.fn(),
    };

    await handleAgentAutocomplete(interaction as never);

    expect(hoisted.buildCwdAutocompleteChoices).toHaveBeenCalledWith('', undefined);
  });
});
