import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerEvent } from '@sniptail/core/types/worker-event.js';
import { handleSlackAgentThreadMessage } from './agentThreadMention.js';

const hoisted = vi.hoisted(() => ({
  findAgentSessionByThread: vi.fn(),
  authorizeSlackOperationAndRespond: vi.fn(),
  enqueueWorkerEvent: vi.fn(),
  postMessage: vi.fn(),
}));

vi.mock('@sniptail/core/agent-sessions/registry.js', () => ({
  findAgentSessionByThread: hoisted.findAgentSessionByThread,
}));

vi.mock('@sniptail/core/queue/queue.js', () => ({
  enqueueWorkerEvent: hoisted.enqueueWorkerEvent,
}));

vi.mock('../../permissions/slackPermissionGuards.js', () => ({
  authorizeSlackOperationAndRespond: hoisted.authorizeSlackOperationAndRespond,
}));

vi.mock('../../helpers.js', () => ({
  postMessage: hoisted.postMessage,
}));

function createContext() {
  return {
    app: {
      client: {},
    },
    config: { botName: 'Sniptail' },
    workerEventQueue: {},
    permissions: {},
    slackIds: {
      actions: {
        agentFollowUpQueue: 'queue',
        agentFollowUpSteer: 'steer',
      },
    },
  } as never;
}

describe('handleSlackAgentThreadMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.authorizeSlackOperationAndRespond.mockResolvedValue(true);
    hoisted.enqueueWorkerEvent.mockResolvedValue(undefined);
    hoisted.postMessage.mockResolvedValue({ ts: 'M2' });
  });

  it('ignores non-agent threads', async () => {
    hoisted.findAgentSessionByThread.mockResolvedValue(undefined);

    const handled = await handleSlackAgentThreadMessage(createContext(), {
      channelId: 'C1',
      threadId: 'T1',
      text: 'follow up',
      eventTs: '111.222',
      userId: 'U1',
      workspaceId: 'W1',
    });

    expect(handled).toBe(false);
    expect(hoisted.enqueueWorkerEvent).not.toHaveBeenCalled();
  });

  it('enqueues completed-thread follow-ups', async () => {
    hoisted.findAgentSessionByThread.mockResolvedValue({
      sessionId: 'session-1',
      provider: 'slack',
      channelId: 'C1',
      threadId: 'T1',
      workspaceId: 'W1',
      userId: 'U_REQUESTER',
      workspaceKey: 'snatch',
      agentProfileKey: 'build',
      status: 'completed',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const handled = await handleSlackAgentThreadMessage(createContext(), {
      channelId: 'C1',
      threadId: 'T1',
      text: 'follow up',
      eventTs: '111.222',
      userId: 'U1',
      workspaceId: 'W1',
    });

    expect(handled).toBe(true);
    const authInput = hoisted.authorizeSlackOperationAndRespond.mock.calls[0]?.[0] as
      | { action: string; operation: { event: WorkerEvent } }
      | undefined;
    expect(authInput?.action).toBe('agent.message');
    expect(authInput?.operation.event.type).toBe('agent.session.message');
    expect(authInput?.operation.event.payload).toMatchObject({
      sessionId: 'session-1',
      message: 'follow up',
      messageId: '111.222',
      mode: 'run',
    });
    expect(hoisted.enqueueWorkerEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'agent.session.message' }),
    );
  });

  it('offers queue and steer controls while active', async () => {
    hoisted.findAgentSessionByThread.mockResolvedValue({
      sessionId: 'session-1',
      provider: 'slack',
      channelId: 'C1',
      threadId: 'T1',
      workspaceId: 'W1',
      userId: 'U_REQUESTER',
      workspaceKey: 'snatch',
      agentProfileKey: 'build',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const handled = await handleSlackAgentThreadMessage(createContext(), {
      channelId: 'C1',
      threadId: 'T1',
      text: 'follow up',
      eventTs: '111.222',
      userId: 'U1',
      workspaceId: 'W1',
    });

    expect(handled).toBe(true);
    const postInput = hoisted.postMessage.mock.calls[0]?.[1] as
      | { text: string; blocks: Array<{ elements: Array<{ text?: { text?: string } }> }> }
      | undefined;
    expect(postInput?.text).toContain('busy');
    expect(postInput?.blocks[0]?.elements.map((element) => element.text?.text)).toEqual([
      'Queue',
      'Steer',
    ]);
    expect(hoisted.enqueueWorkerEvent).not.toHaveBeenCalled();
  });

  it('reports pending and terminal states without enqueueing', async () => {
    hoisted.findAgentSessionByThread.mockResolvedValueOnce({
      sessionId: 'session-1',
      provider: 'slack',
      channelId: 'C1',
      threadId: 'T1',
      userId: 'U_REQUESTER',
      workspaceKey: 'snatch',
      agentProfileKey: 'build',
      status: 'pending',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    hoisted.findAgentSessionByThread.mockResolvedValueOnce({
      sessionId: 'session-1',
      provider: 'slack',
      channelId: 'C1',
      threadId: 'T1',
      userId: 'U_REQUESTER',
      workspaceKey: 'snatch',
      agentProfileKey: 'build',
      status: 'failed',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await handleSlackAgentThreadMessage(createContext(), {
      channelId: 'C1',
      threadId: 'T1',
      text: 'follow up',
      eventTs: '111.222',
      userId: 'U1',
    });
    await handleSlackAgentThreadMessage(createContext(), {
      channelId: 'C1',
      threadId: 'T1',
      text: 'follow up',
      eventTs: '111.223',
      userId: 'U1',
    });

    expect(hoisted.postMessage.mock.calls[0]?.[1]).toMatchObject({
      text: 'This agent session is still waiting to start.',
    });
    expect(hoisted.postMessage.mock.calls[1]?.[1]).toMatchObject({
      text: 'This agent session is failed.',
    });
    expect(hoisted.enqueueWorkerEvent).not.toHaveBeenCalled();
  });

  it('dedupes repeated completed-thread message events', async () => {
    hoisted.findAgentSessionByThread.mockResolvedValue({
      sessionId: 'session-1',
      provider: 'slack',
      channelId: 'C1',
      threadId: 'T1',
      workspaceId: 'W1',
      userId: 'U_REQUESTER',
      workspaceKey: 'snatch',
      agentProfileKey: 'build',
      status: 'completed',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await handleSlackAgentThreadMessage(createContext(), {
      channelId: 'C1',
      threadId: 'T1',
      text: 'follow up',
      eventTs: '111.999',
      userId: 'U1',
      workspaceId: 'W1',
    });
    await handleSlackAgentThreadMessage(createContext(), {
      channelId: 'C1',
      threadId: 'T1',
      text: 'follow up',
      eventTs: '111.999',
      userId: 'U1',
      workspaceId: 'W1',
    });

    expect(hoisted.enqueueWorkerEvent).toHaveBeenCalledTimes(1);
  });
});
