import { describe, expect, it } from 'vitest';
import { BOT_EVENT_SCHEMA_VERSION, type BotEvent } from './bot-event.js';
import { WORKER_EVENT_SCHEMA_VERSION, type WorkerEvent } from './worker-event.js';

describe('bot event schema', () => {
  it('accepts schema-versioned bot events', () => {
    const event: BotEvent = {
      schemaVersion: BOT_EVENT_SCHEMA_VERSION,
      provider: 'discord',
      type: 'interaction.reply.edit',
      payload: {
        interactionApplicationId: 'app-1',
        interactionToken: 'token-1',
        text: 'updated',
      },
    };

    expect(event.schemaVersion).toBe(BOT_EVENT_SCHEMA_VERSION);
    expect(event.type).toBe('interaction.reply.edit');
  });

  it('accepts minimal agent session listed bot events', () => {
    const event: BotEvent = {
      schemaVersion: BOT_EVENT_SCHEMA_VERSION,
      provider: 'slack',
      requestId: 'request-1',
      type: 'agent.sessions.listed',
      payload: {
        channelId: 'channel-1',
        userId: 'user-1',
        workerId: 'worker-a',
        sessions: [],
      },
    };

    expect(event.requestId).toBe('request-1');
    expect(event.type).toBe('agent.sessions.listed');
  });

  it('accepts paginated agent session listed bot events with summaries', () => {
    const event: BotEvent = {
      schemaVersion: BOT_EVENT_SCHEMA_VERSION,
      provider: 'discord',
      requestId: 'request-2',
      type: 'agent.sessions.listed',
      payload: {
        channelId: 'channel-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        guildId: 'guild-1',
        agentProfileKey: 'acp-opencode',
        workerId: 'worker-a',
        filters: {
          workspaceKey: 'snatch',
          cwd: 'apps/worker',
          roots: ['docs', 'packages/core'],
        },
        sessions: [
          {
            id: 'session-1',
            provider: 'acp',
            agentProfileKey: 'acp-opencode',
            workspaceKey: 'snatch',
            title: 'Worker session',
            createdAt: '2026-05-21T10:00:00.000Z',
            updatedAt: '2026-05-21T10:05:00.000Z',
            cwd: 'apps/worker',
            roots: ['packages/core', 'docs'],
            project: 'snatch',
            description: 'Previously attached session',
          },
        ],
        previousCursor: 'cursor-0',
        nextCursor: 'cursor-2',
        cursorHistory: ['cursor-0', 'cursor-1'],
      },
    };

    expect(event.payload.sessions).toHaveLength(1);
    expect(event.payload.sessions[0]?.provider).toBe('acp');
  });

  it('accepts error agent session listed bot events', () => {
    const event: BotEvent = {
      schemaVersion: BOT_EVENT_SCHEMA_VERSION,
      provider: 'discord',
      requestId: 'request-3',
      type: 'agent.sessions.listed',
      payload: {
        channelId: 'channel-1',
        userId: 'user-1',
        workerId: 'worker-a',
        sessions: [],
        errorMessage: 'Session listing is not supported for Codex profiles.',
      },
    };

    expect(event.payload.errorMessage).toContain('Codex');
  });

  it('accepts agent session previewed bot events', () => {
    const event: BotEvent = {
      schemaVersion: BOT_EVENT_SCHEMA_VERSION,
      provider: 'discord',
      requestId: 'request-4',
      type: 'agent.session.previewed',
      payload: {
        channelId: 'channel-1',
        threadId: 'thread-1',
        userId: 'user-1',
        guildId: 'guild-1',
        sessionId: 'sniptail-session-1',
        workerId: 'worker-a',
        agentProfileKey: 'opencode-build',
        provider: 'opencode',
        providerSessionId: 'provider-session-1',
        workspaceKey: 'snatch',
        cwd: 'apps/worker',
        message: {
          role: 'agent',
          text: 'Last assistant response',
          createdAt: '2026-05-21T10:05:00.000Z',
        },
      },
    };

    expect(event.type).toBe('agent.session.previewed');
    expect(event.payload.message?.role).toBe('agent');
  });
});

describe('worker event schema', () => {
  it('accepts minimal agent session list worker events', () => {
    const event: WorkerEvent = {
      schemaVersion: WORKER_EVENT_SCHEMA_VERSION,
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
    };

    expect(event.requestId).toBe('request-1');
    expect(event.type).toBe('agent.sessions.list');
  });

  it('accepts filtered and paginated agent session list worker events', () => {
    const event: WorkerEvent = {
      schemaVersion: WORKER_EVENT_SCHEMA_VERSION,
      requestId: 'request-2',
      type: 'agent.sessions.list',
      payload: {
        response: {
          provider: 'discord',
          channelId: 'channel-1',
          threadId: 'thread-1',
          userId: 'user-1',
          workspaceId: 'workspace-1',
          guildId: 'guild-1',
        },
        workerId: 'worker-a',
        agentProfileKey: 'acp-opencode',
        pageSize: 4,
        cursor: 'cursor-1',
        filters: {
          workspaceKey: 'snatch',
          cwd: 'apps/worker',
          gitRoot: '/repo',
          repository: 'org/snatch',
          branch: 'main',
          roots: ['/repo', '/repo/packages/core'],
          search: 'attach',
          start: '2026-05-21T10:00:00.000Z',
        },
      },
    };

    expect(event.payload.pageSize).toBe(4);
    expect(event.payload.filters?.workspaceKey).toBe('snatch');
  });

  it('accepts agent session preview worker events', () => {
    const event: WorkerEvent = {
      schemaVersion: WORKER_EVENT_SCHEMA_VERSION,
      requestId: 'request-3',
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
        agentProfileKey: 'opencode-build',
        provider: 'opencode',
        providerSessionId: 'provider-session-1',
        workspaceKey: 'snatch',
        cwd: 'apps/worker',
      },
    };

    expect(event.type).toBe('agent.session.preview');
    expect(event.payload.providerSessionId).toBe('provider-session-1');
  });
});
