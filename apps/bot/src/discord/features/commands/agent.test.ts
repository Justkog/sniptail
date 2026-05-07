import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { loadDiscordContextFiles } from '../../lib/discordContextFiles.js';
import { handleAgentAutocomplete, handleAgentStart } from './agent.js';

const hoisted = vi.hoisted(() => ({
  loadDiscordAgentDefaults: vi.fn(),
  upsertDiscordAgentDefaults: vi.fn(),
  createAgentSession: vi.fn(),
  updateAgentSessionStatus: vi.fn(),
  enqueueWorkerEvent: vi.fn(),
  authorizeDiscordPrecheckAndRespond: vi.fn(),
  authorizeDiscordOperationAndRespond: vi.fn(),
  getDiscordAgentCommandMetadata: vi.fn(),
  buildCwdAutocompleteChoices: vi.fn(),
  buildProfileAutocompleteChoices: vi.fn(),
  buildWorkspaceAutocompleteChoices: vi.fn(),
  postDiscordMessage: vi.fn(),
  loadDiscordContextFiles: vi.fn(),
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
  enqueueWorkerEvent: hoisted.enqueueWorkerEvent,
}));

vi.mock('../../permissions/discordPermissionGuards.js', () => ({
  authorizeDiscordPrecheckAndRespond: hoisted.authorizeDiscordPrecheckAndRespond,
  authorizeDiscordOperationAndRespond: hoisted.authorizeDiscordOperationAndRespond,
}));

vi.mock('../../../agentCommandMetadataCache.js', () => ({
  buildCwdAutocompleteChoices: hoisted.buildCwdAutocompleteChoices,
  buildProfileAutocompleteChoices: hoisted.buildProfileAutocompleteChoices,
  buildWorkspaceAutocompleteChoices: hoisted.buildWorkspaceAutocompleteChoices,
  getAgentCommandMetadata: hoisted.getDiscordAgentCommandMetadata,
}));

vi.mock('../../helpers.js', () => ({
  isSendableTextChannel: vi.fn(() => true),
  postDiscordMessage: hoisted.postDiscordMessage,
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

const config = { botName: 'Sniptail' };
const queue = {};
const permissions = {};

describe('handleAgentStart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.getDiscordAgentCommandMetadata.mockReturnValue({
      enabled: true,
      defaultWorkspace: 'snatch',
      defaultAgentProfile: 'build',
      workspaces: [{ key: 'snatch' }],
      profiles: [{ key: 'build', provider: 'opencode', name: 'build' }],
      receivedAt: '2026-01-01T00:00:00.000Z',
    });
    hoisted.authorizeDiscordPrecheckAndRespond.mockResolvedValue(true);
    hoisted.authorizeDiscordOperationAndRespond.mockResolvedValue(true);
    hoisted.buildCwdAutocompleteChoices.mockReturnValue([]);
    hoisted.buildProfileAutocompleteChoices.mockReturnValue([]);
    hoisted.buildWorkspaceAutocompleteChoices.mockReturnValue([]);
    hoisted.loadDiscordAgentDefaults.mockResolvedValue(undefined);
    hoisted.upsertDiscordAgentDefaults.mockResolvedValue(undefined);
    hoisted.createAgentSession.mockResolvedValue(undefined);
    hoisted.updateAgentSessionStatus.mockResolvedValue(undefined);
    hoisted.enqueueWorkerEvent.mockResolvedValue(undefined);
    hoisted.loadDiscordContextFiles.mockResolvedValue([]);
  });

  it('uses the thread starter message as the agent control surface', async () => {
    const startThread = vi.fn().mockResolvedValue({ id: 'thread-1' });
    hoisted.postDiscordMessage.mockResolvedValue({ id: 'message-1', startThread });
    const interaction = buildInteraction();

    await handleAgentStart(
      interaction as never,
      config as never,
      queue as never,
      permissions as never,
    );

    expect(hoisted.postDiscordMessage).toHaveBeenCalledTimes(1);
    expect(hoisted.postDiscordMessage).toHaveBeenCalledWith(
      interaction.client,
      expect.objectContaining({
        channelId: 'channel-1',
        text: expect.stringContaining('inspect the failing tests') as unknown,
        components: expect.arrayContaining([
          expect.objectContaining({
            components: expect.arrayContaining([
              expect.objectContaining({ label: 'Stop' }),
            ]) as unknown,
          }),
        ]) as unknown,
      }),
    );
    expect(startThread).toHaveBeenCalledWith(
      expect.objectContaining({ autoArchiveDuration: 1440 }),
    );
    expect(hoisted.enqueueWorkerEvent).toHaveBeenCalledWith(
      queue,
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
    expect(interaction.editReply).toHaveBeenCalledWith('Agent session started in <#thread-1>.');
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
      queue as never,
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
    expect(hoisted.enqueueWorkerEvent).toHaveBeenCalledWith(
      queue,
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
    hoisted.getDiscordAgentCommandMetadata.mockReturnValue({
      enabled: true,
      defaultWorkspace: 'snatch',
      defaultAgentProfile: 'build',
      workspaces: [{ key: 'snatch' }],
      profiles: [{ key: 'build', provider: 'codex', name: 'deep-review' }],
      receivedAt: '2026-01-01T00:00:00.000Z',
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
      queue as never,
      permissions as never,
    );

    expect(hoisted.postDiscordMessage).toHaveBeenCalled();
    expect(hoisted.createAgentSession).toHaveBeenCalled();
    expect(hoisted.enqueueWorkerEvent).toHaveBeenCalledWith(
      queue,
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
      queue as never,
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
    expect(interaction.editReply).toHaveBeenCalledWith('Agent session started in <#thread-1>.');
  });

  it('uses persisted defaults when command options are omitted', async () => {
    const startThread = vi.fn().mockResolvedValue({ id: 'thread-1' });
    hoisted.postDiscordMessage.mockResolvedValue({ id: 'message-1', startThread });
    hoisted.loadDiscordAgentDefaults.mockResolvedValue({
      workspaceKey: 'tools',
      agentProfileKey: 'plan',
      cwd: 'apps/worker',
    });
    hoisted.getDiscordAgentCommandMetadata.mockReturnValue({
      enabled: true,
      defaultWorkspace: 'snatch',
      defaultAgentProfile: 'build',
      workspaces: [{ key: 'snatch' }, { key: 'tools' }],
      profiles: [
        { key: 'build', provider: 'opencode', name: 'build' },
        { key: 'plan', provider: 'opencode', name: 'plan' },
      ],
      receivedAt: '2026-01-01T00:00:00.000Z',
    });
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
      queue as never,
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
      queue as never,
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

  it('uses persisted defaults to bias autocomplete choices', async () => {
    hoisted.loadDiscordAgentDefaults.mockResolvedValue({
      workspaceKey: 'snatch',
      agentProfileKey: 'build',
      cwd: 'apps/worker',
    });
    hoisted.buildWorkspaceAutocompleteChoices.mockReturnValue([
      { name: 'Snatch', value: 'snatch' },
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
    expect(interaction.respond).toHaveBeenCalledWith([{ name: 'Snatch', value: 'snatch' }]);
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
