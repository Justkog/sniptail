import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreBotEvent } from '@sniptail/core/types/bot-event.js';

const hoisted = vi.hoisted(() => ({
  postDiscordMessage: vi.fn().mockResolvedValue({ id: 'message-1' }),
  fetchDiscordMessage: vi.fn(),
  editDiscordMessage: vi.fn().mockResolvedValue(undefined),
  editDiscordInteractionReply: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./helpers.js', () => ({
  postDiscordMessage: hoisted.postDiscordMessage,
  postDiscordEphemeral: vi.fn(),
  editDiscordInteractionReply: hoisted.editDiscordInteractionReply,
  addDiscordReaction: vi.fn(),
  uploadDiscordFile: vi.fn(),
  fetchDiscordMessage: hoisted.fetchDiscordMessage,
  editDiscordMessage: hoisted.editDiscordMessage,
}));

vi.mock('@sniptail/core/logger.js', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@sniptail/core/config/config.js', () => ({
  loadBotConfig: vi.fn(() => ({ discord: { commandPrefix: 'sniptail' } })),
}));

vi.mock('@sniptail/core/utils/slack.js', () => ({
  toSlackCommandPrefix: vi.fn((prefix: string) => prefix),
}));

vi.mock('@sniptail/core/discord/components.js', () => ({
  buildDiscordAgentPermissionComponents: vi.fn(() => []),
  buildDiscordAgentQuestionComponents: vi.fn(() => []),
}));

vi.mock('./features/actions/discordAgentSessionButtons.js', () => ({
  buildDiscordAgentSessionsCustomId: vi.fn(
    (action: string, token: string) => `sniptail:agent-sessions:${action}:${token}`,
  ),
}));

vi.mock('./features/actions/agentQuestion.js', () => ({
  clearPendingDiscordAgentQuestion: vi.fn(),
  setPendingDiscordAgentQuestion: vi.fn(),
}));

import { DiscordBotChannelAdapter } from './discordBotChannelAdapter.js';
import {
  clearPendingDiscordAgentSessionBrowserRequest,
  setPendingDiscordAgentSessionBrowserRequest,
} from './state.js';

type DiscordInteractionReplyUpdate = {
  interactionApplicationId: string;
  interactionToken: string;
  text: string;
  components?: Array<{
    components?: Array<{
      label?: string;
    }>;
  }>;
};

function buildQuestionEvent(
  questions: CoreBotEvent<'agent.question.requested'>['payload']['questions'],
): CoreBotEvent<'agent.question.requested'> {
  return {
    schemaVersion: 1,
    provider: 'discord',
    type: 'agent.question.requested',
    payload: {
      channelId: 'thread-1',
      threadId: 'thread-1',
      sessionId: 'session-1',
      interactionId: 'interaction-1',
      workspaceKey: 'snatch',
      expiresAt: '2026-01-01T00:30:00.000Z',
      questions,
    },
  };
}

function buildPermissionRequestedEvent(): CoreBotEvent<'agent.permission.requested'> {
  return {
    schemaVersion: 1,
    provider: 'discord',
    type: 'agent.permission.requested',
    payload: {
      channelId: 'thread-1',
      threadId: 'thread-1',
      sessionId: 'session-1',
      interactionId: 'interaction-1',
      workspaceKey: 'snatch',
      cwd: 'apps/bot',
      toolName: 'bash',
      action: 'run command',
      details: ['pnpm run check'],
      allowAlways: true,
      expiresAt: '2026-01-01T00:30:00.000Z',
    },
  };
}

function buildPermissionUpdatedEvent(): CoreBotEvent<'agent.permission.updated'> {
  return {
    schemaVersion: 1,
    provider: 'discord',
    type: 'agent.permission.updated',
    payload: {
      channelId: 'thread-1',
      threadId: 'thread-1',
      sessionId: 'session-1',
      interactionId: 'interaction-1',
      status: 'approved_always',
      actorUserId: 'user-1',
    },
  };
}

function buildSessionsListedEvent(
  overrides: Partial<CoreBotEvent<'agent.sessions.listed'>['payload']> = {},
): CoreBotEvent<'agent.sessions.listed'> {
  return {
    schemaVersion: 1,
    requestId: 'request-1',
    provider: 'discord',
    type: 'agent.sessions.listed',
    payload: {
      channelId: 'channel-1',
      userId: 'user-1',
      guildId: 'guild-1',
      workerId: 'worker-a',
      filters: {
        workspaceKey: 'snatch',
        roots: ['docs', 'packages/core'],
      },
      sessions: [
        {
          id: 'provider-session-1',
          provider: 'acp',
          agentProfileKey: 'build',
          workspaceKey: 'snatch',
          cwd: 'apps/worker',
          title: 'ACP session',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
      previousCursor: 'cursor-0',
      nextCursor: 'cursor-2',
      ...overrides,
    },
  };
}

function buildSessionPreviewedEvent(
  overrides: Partial<CoreBotEvent<'agent.session.previewed'>['payload']> = {},
  options: { includeMessage?: boolean } = {},
): CoreBotEvent<'agent.session.previewed'> {
  const includeMessage = options.includeMessage ?? true;
  return {
    schemaVersion: 1,
    requestId: 'request-preview-1',
    provider: 'discord',
    type: 'agent.session.previewed',
    payload: {
      channelId: 'channel-1',
      threadId: 'thread-1',
      userId: 'user-1',
      guildId: 'guild-1',
      sessionId: 'sniptail-session-1',
      workerId: 'worker-a',
      agentProfileKey: 'build',
      provider: 'opencode',
      providerSessionId: 'provider-session-1',
      workspaceKey: 'snatch',
      cwd: 'apps/worker',
      ...(includeMessage
        ? {
            message: {
              role: 'agent' as const,
              text: 'Latest assistant response',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          }
        : {}),
      ...overrides,
    },
  };
}

describe('DiscordBotChannelAdapter question formatting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.postDiscordMessage.mockResolvedValue({ id: 'message-1' });
    hoisted.fetchDiscordMessage.mockResolvedValue({
      content: '**Permission requested** Tool: `bash`',
    });
    hoisted.editDiscordMessage.mockResolvedValue(undefined);
    hoisted.editDiscordInteractionReply.mockResolvedValue(undefined);
    clearPendingDiscordAgentSessionBrowserRequest('request-1');
  });

  it('omits numbering and header text for a single question without a header', async () => {
    const adapter = new DiscordBotChannelAdapter();

    await adapter.handleEvent(
      buildQuestionEvent([
        {
          question: 'Pick one number for this test:',
          options: [{ label: 'One' }, { label: 'Two' }, { label: 'Three' }],
          multiple: false,
          custom: true,
        },
      ]),
      { discordClient: {} as never },
    );

    expect(hoisted.postDiscordMessage).toHaveBeenCalledWith(
      {} as never,
      expect.objectContaining({
        text: [
          '**Question requested**',
          '',
          'Workspace: `snatch`',
          'Expires: <t:1767227400:R>',
          '',
          'Pick one number for this test:',
          '- One',
          '- Two',
          '- Three',
          '_Custom answer allowed._',
        ].join('\n'),
      }),
    );
  });

  it('preserves the original permission request text when updating the message status', async () => {
    const adapter = new DiscordBotChannelAdapter();

    await adapter.handleEvent(buildPermissionRequestedEvent(), { discordClient: {} as never });
    await adapter.handleEvent(buildPermissionUpdatedEvent(), { discordClient: {} as never });

    expect(hoisted.editDiscordMessage).toHaveBeenCalledWith(
      {} as never,
      expect.objectContaining({
        channelId: 'thread-1',
        threadId: 'thread-1',
        messageId: 'message-1',
        text: [
          '**Permission requested**',
          '',
          'Tool: `bash`',
          'Action: `run command`',
          'Workspace: `snatch / apps/bot`',
          'Expires: <t:1767227400:R>',
          '',
          'Details:',
          '`pnpm run check`',
          '',
          'Permission always allowed by <@user-1>.',
        ].join('\n'),
        components: [],
      }),
    );
  });

  it('renders listed sessions into the pending ephemeral interaction reply', async () => {
    const adapter = new DiscordBotChannelAdapter();
    setPendingDiscordAgentSessionBrowserRequest({
      requestId: 'request-1',
      channelId: 'channel-1',
      userId: 'user-1',
      guildId: 'guild-1',
      interactionApplicationId: 'app-1',
      interactionToken: 'token-1',
      workerId: 'worker-a',
      filters: {
        workspaceKey: ' snatch ',
        roots: ['packages/core', 'docs', 'docs'],
      },
      cursorHistory: [],
      requestedAt: Date.now(),
    });

    await adapter.handleEvent(buildSessionsListedEvent(), { discordClient: {} as never });

    const editCalls = hoisted.editDiscordInteractionReply.mock.calls as Array<
      [unknown, DiscordInteractionReplyUpdate]
    >;
    const [, reply] = editCalls[0] ?? [];
    const buttonLabels =
      reply.components?.flatMap(
        (row) =>
          row.components
            ?.map((component) => component.label)
            .filter((label) => label !== undefined) ?? [],
      ) ?? [];

    expect(reply.interactionApplicationId).toBe('app-1');
    expect(reply.interactionToken).toBe('token-1');
    expect(reply.text).toContain('ACP session');
    expect(buttonLabels).toContain('Attach 1');
    expect(buttonLabels).toContain('Previous');
    expect(buttonLabels).toContain('Next');
  });

  it('ignores listed sessions whose filters do not match pending scope', async () => {
    const adapter = new DiscordBotChannelAdapter();
    setPendingDiscordAgentSessionBrowserRequest({
      requestId: 'request-1',
      channelId: 'channel-1',
      userId: 'user-1',
      guildId: 'guild-1',
      interactionApplicationId: 'app-1',
      interactionToken: 'token-1',
      workerId: 'worker-a',
      filters: {
        workspaceKey: 'snatch',
        cwd: 'apps/worker',
      },
      cursorHistory: [],
      requestedAt: Date.now(),
    });

    await adapter.handleEvent(
      buildSessionsListedEvent({
        filters: {
          workspaceKey: 'snatch',
          cwd: 'apps/bot',
        },
      }),
      { discordClient: {} as never },
    );

    expect(hoisted.editDiscordInteractionReply).not.toHaveBeenCalled();
  });

  it('renders attached session previews into the Discord thread', async () => {
    const adapter = new DiscordBotChannelAdapter();

    await adapter.handleEvent(buildSessionPreviewedEvent(), { discordClient: {} as never });

    expect(hoisted.postDiscordMessage).toHaveBeenCalledWith(
      {} as never,
      expect.objectContaining({
        channelId: 'channel-1',
        threadId: 'thread-1',
        text: expect.stringContaining('Latest assistant response') as unknown,
      }),
    );
  });

  it('renders attached session preview errors safely', async () => {
    const adapter = new DiscordBotChannelAdapter();

    await adapter.handleEvent(
      buildSessionPreviewedEvent(
        {
          errorMessage: 'Sniptail attached the session, but no preview is available.',
        },
        { includeMessage: false },
      ),
      { discordClient: {} as never },
    );

    expect(hoisted.postDiscordMessage).toHaveBeenCalledWith(
      {} as never,
      expect.objectContaining({
        channelId: 'channel-1',
        threadId: 'thread-1',
        text: expect.stringContaining('no preview is available') as unknown,
      }),
    );
  });

  it('ignores attached session preview events for other channel providers', async () => {
    const adapter = new DiscordBotChannelAdapter();
    const event = {
      ...buildSessionPreviewedEvent(),
      provider: 'slack',
    } as CoreBotEvent<'agent.session.previewed'>;

    await adapter.handleEvent(event, { discordClient: {} as never });

    expect(hoisted.postDiscordMessage).not.toHaveBeenCalled();
  });
});
