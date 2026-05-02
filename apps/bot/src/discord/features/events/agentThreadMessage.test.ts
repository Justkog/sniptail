import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerEvent } from '@sniptail/core/types/worker-event.js';
import { handleAgentThreadMessage } from './agentThreadMessage.js';

const hoisted = vi.hoisted(() => ({
  findDiscordAgentSessionByThread: vi.fn(),
  authorizeDiscordOperationAndRespond: vi.fn(),
  enqueueWorkerEvent: vi.fn(),
}));

vi.mock('@sniptail/core/agent-sessions/registry.js', () => ({
  findDiscordAgentSessionByThread: hoisted.findDiscordAgentSessionByThread,
}));

vi.mock('@sniptail/core/queue/queue.js', () => ({
  enqueueWorkerEvent: hoisted.enqueueWorkerEvent,
}));

vi.mock('../../permissions/discordPermissionGuards.js', () => ({
  authorizeDiscordOperationAndRespond: hoisted.authorizeDiscordOperationAndRespond,
}));

function buildMessage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'M1',
    channelId: 'T1',
    guildId: 'G1',
    content: 'follow up',
    author: { id: 'U1' },
    member: {},
    client: {},
    reply: vi.fn(),
    channel: {
      isThread: () => true,
    },
    ...overrides,
  };
}

const config = { botName: 'Sniptail' };
const queue = {};
const permissions = {};

describe('handleAgentThreadMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.authorizeDiscordOperationAndRespond.mockResolvedValue(true);
    hoisted.enqueueWorkerEvent.mockResolvedValue(undefined);
  });

  it('ignores non-agent threads', async () => {
    hoisted.findDiscordAgentSessionByThread.mockResolvedValue(undefined);

    const handled = await handleAgentThreadMessage(
      buildMessage() as never,
      config as never,
      queue as never,
      permissions as never,
    );

    expect(handled).toBe(false);
    expect(hoisted.enqueueWorkerEvent).not.toHaveBeenCalled();
  });

  it('enqueues follow-up messages for completed agent threads', async () => {
    hoisted.findDiscordAgentSessionByThread.mockResolvedValue({
      sessionId: 'session-1',
      provider: 'discord',
      channelId: 'C1',
      threadId: 'T1',
      userId: 'U_REQUESTER',
      workspaceKey: 'snatch',
      agentProfileKey: 'build',
      status: 'completed',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const handled = await handleAgentThreadMessage(
      buildMessage() as never,
      config as never,
      queue as never,
      permissions as never,
    );

    expect(handled).toBe(true);
    const authInput = hoisted.authorizeDiscordOperationAndRespond.mock.calls[0]?.[0] as
      | { action: string; operation: { event: WorkerEvent } }
      | undefined;
    expect(authInput?.action).toBe('agent.message');
    expect(authInput?.operation.event.type).toBe('agent.session.message');
    expect(authInput?.operation.event.payload).toMatchObject({
      sessionId: 'session-1',
      message: 'follow up',
      messageId: 'M1',
      mode: 'run',
    });
    expect(hoisted.enqueueWorkerEvent).toHaveBeenCalledWith(
      queue,
      expect.objectContaining({ type: 'agent.session.message' }),
    );
  });

  it('offers queue and steer controls while an agent thread is active', async () => {
    hoisted.findDiscordAgentSessionByThread.mockResolvedValue({
      sessionId: 'session-1',
      provider: 'discord',
      channelId: 'C1',
      threadId: 'T1',
      userId: 'U_REQUESTER',
      workspaceKey: 'snatch',
      agentProfileKey: 'build',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const message = buildMessage();

    const handled = await handleAgentThreadMessage(
      message as never,
      config as never,
      queue as never,
      permissions as never,
    );

    expect(handled).toBe(true);
    const replyInput = message.reply.mock.calls[0]?.[0] as
      | {
          content: string;
          components: Array<{ components: Array<{ label: string }> }>;
        }
      | undefined;
    expect(replyInput?.content).toContain('busy');
    expect(replyInput?.components[0]?.components.map((component) => component.label)).toEqual([
      'Queue',
      'Steer',
    ]);
    expect(hoisted.enqueueWorkerEvent).not.toHaveBeenCalled();
  });

  it('does not enqueue messages while the session is pending', async () => {
    hoisted.findDiscordAgentSessionByThread.mockResolvedValue({
      sessionId: 'session-1',
      provider: 'discord',
      channelId: 'C1',
      threadId: 'T1',
      userId: 'U_REQUESTER',
      workspaceKey: 'snatch',
      agentProfileKey: 'build',
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const message = buildMessage();

    const handled = await handleAgentThreadMessage(
      message as never,
      config as never,
      queue as never,
      permissions as never,
    );

    expect(handled).toBe(true);
    expect(message.reply).toHaveBeenCalledWith('This agent session is still waiting to start.');
    expect(hoisted.enqueueWorkerEvent).not.toHaveBeenCalled();
  });
});
