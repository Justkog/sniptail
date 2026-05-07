import { describe, expect, it } from 'vitest';
import {
  buildAgentInteractionResolveWorkerEvent,
  buildAgentPromptStopWorkerEvent,
  buildAgentReplyTarget,
  buildAgentSessionMessageWorkerEvent,
  buildAgentSessionStartWorkerEvent,
  resolveAgentFollowUpMode,
  validateAgentSessionForThread,
} from './agentCommandShared.js';

describe('agentCommandShared', () => {
  const discordSession = {
    sessionId: 'session-discord',
    provider: 'discord' as const,
    channelId: 'channel-1',
    threadId: 'thread-1',
    userId: 'user-1',
    guildId: 'guild-1',
    workspaceKey: 'snatch',
    agentProfileKey: 'build',
    status: 'active' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const slackSession = {
    sessionId: 'session-slack',
    provider: 'slack' as const,
    channelId: 'channel-2',
    threadId: 'thread-2',
    userId: 'user-2',
    workspaceId: 'workspace-1',
    workspaceKey: 'snatch',
    agentProfileKey: 'build',
    status: 'active' as const,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('builds provider-aware reply targets', () => {
    expect(
      buildAgentReplyTarget(discordSession, { userId: 'actor-1', guildId: 'guild-2' }),
    ).toEqual({
      provider: 'discord',
      channelId: 'thread-1',
      threadId: 'thread-1',
      userId: 'actor-1',
      workspaceId: 'snatch',
      guildId: 'guild-2',
    });

    expect(
      buildAgentReplyTarget(slackSession, { userId: 'actor-2', workspaceId: 'workspace-2' }),
    ).toEqual({
      provider: 'slack',
      channelId: 'channel-2',
      threadId: 'thread-2',
      userId: 'actor-2',
      workspaceId: 'workspace-2',
    });
  });

  it('builds agent start events for both providers', () => {
    const discordEvent = buildAgentSessionStartWorkerEvent({
      session: {
        sessionId: discordSession.sessionId,
        provider: 'discord',
        channelId: discordSession.channelId,
        threadId: discordSession.threadId,
        userId: discordSession.userId,
        guildId: discordSession.guildId,
        workspaceKey: discordSession.workspaceKey,
        agentProfileKey: discordSession.agentProfileKey,
      },
      prompt: 'do work',
    });
    expect(discordEvent.payload).toMatchObject({
      sessionId: 'session-discord',
      response: {
        provider: 'discord',
        channelId: 'thread-1',
        threadId: 'thread-1',
        userId: 'user-1',
        workspaceId: 'snatch',
        guildId: 'guild-1',
      },
      prompt: 'do work',
    });

    const slackEvent = buildAgentSessionStartWorkerEvent({
      session: {
        sessionId: slackSession.sessionId,
        provider: 'slack',
        channelId: slackSession.channelId,
        threadId: slackSession.threadId,
        userId: slackSession.userId,
        workspaceId: slackSession.workspaceId,
        workspaceKey: slackSession.workspaceKey,
        agentProfileKey: slackSession.agentProfileKey,
        cwd: 'apps/bot',
      },
      prompt: 'do work',
    });
    expect(slackEvent.payload).toMatchObject({
      sessionId: 'session-slack',
      response: {
        provider: 'slack',
        channelId: 'channel-2',
        threadId: 'thread-2',
        userId: 'user-2',
        workspaceId: 'workspace-1',
      },
      prompt: 'do work',
      cwd: 'apps/bot',
    });
  });

  it('builds shared message, stop, and interaction events', () => {
    expect(
      buildAgentSessionMessageWorkerEvent({
        session: slackSession,
        actor: { userId: 'actor-1', workspaceId: 'workspace-9' },
        message: 'follow up',
        messageId: 'msg-1',
        mode: 'queue',
      }).payload,
    ).toMatchObject({
      sessionId: 'session-slack',
      message: 'follow up',
      messageId: 'msg-1',
      mode: 'queue',
      response: {
        channelId: 'channel-2',
        threadId: 'thread-2',
        userId: 'actor-1',
        workspaceId: 'workspace-9',
      },
    });

    expect(
      buildAgentPromptStopWorkerEvent({
        session: discordSession,
        actor: { userId: 'actor-2', guildId: 'guild-9' },
        reason: 'stop',
        messageId: 'msg-2',
      }).payload,
    ).toMatchObject({
      sessionId: 'session-discord',
      reason: 'stop',
      messageId: 'msg-2',
      response: {
        channelId: 'thread-1',
        threadId: 'thread-1',
        userId: 'actor-2',
        guildId: 'guild-9',
      },
    });

    expect(
      buildAgentInteractionResolveWorkerEvent({
        session: slackSession,
        actor: { userId: 'actor-3' },
        interactionId: 'interaction-1',
        resolution: {
          kind: 'permission',
          decision: 'always',
        },
      }).payload,
    ).toMatchObject({
      sessionId: 'session-slack',
      interactionId: 'interaction-1',
      resolution: {
        kind: 'permission',
        decision: 'always',
      },
    });
  });

  it('validates sessions and resolves follow-up mode', () => {
    expect(
      validateAgentSessionForThread({
        session: undefined,
        threadId: 'thread-1',
        allowedStatuses: ['active'],
        wrongThreadMessage: 'wrong',
      }),
    ).toBe('Agent session not found.');
    expect(
      validateAgentSessionForThread({
        session: discordSession,
        threadId: 'other-thread',
        allowedStatuses: ['active'],
        wrongThreadMessage: 'wrong',
      }),
    ).toBe('wrong');
    expect(
      validateAgentSessionForThread({
        session: { ...discordSession, status: 'completed' },
        threadId: 'thread-1',
        allowedStatuses: ['active'],
        wrongThreadMessage: 'wrong',
      }),
    ).toBe('This agent session is completed.');
    expect(
      validateAgentSessionForThread({
        session: discordSession,
        threadId: 'thread-1',
        allowedStatuses: ['active'],
        wrongThreadMessage: 'wrong',
      }),
    ).toBeUndefined();

    expect(resolveAgentFollowUpMode('active', 'steer')).toBe('steer');
    expect(resolveAgentFollowUpMode('completed', 'queue')).toBe('run');
  });
});
