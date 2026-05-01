import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAgentStart } from './agent.js';

const hoisted = vi.hoisted(() => ({
  createAgentSession: vi.fn(),
  updateAgentSessionStatus: vi.fn(),
  enqueueWorkerEvent: vi.fn(),
  authorizeDiscordPrecheckAndRespond: vi.fn(),
  authorizeDiscordOperationAndRespond: vi.fn(),
  getDiscordAgentCommandMetadata: vi.fn(),
  postDiscordMessage: vi.fn(),
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

vi.mock('../../agentCommandMetadataCache.js', () => ({
  buildProfileAutocompleteChoices: vi.fn(),
  buildWorkspaceAutocompleteChoices: vi.fn(),
  getDiscordAgentCommandMetadata: hoisted.getDiscordAgentCommandMetadata,
}));

vi.mock('../../helpers.js', () => ({
  isSendableTextChannel: vi.fn(() => true),
  postDiscordMessage: hoisted.postDiscordMessage,
}));

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
    hoisted.createAgentSession.mockResolvedValue(undefined);
    hoisted.updateAgentSessionStatus.mockResolvedValue(undefined);
    hoisted.enqueueWorkerEvent.mockResolvedValue(undefined);
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
    expect(interaction.editReply).toHaveBeenCalledWith('Agent session started in <#thread-1>.');
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
});
