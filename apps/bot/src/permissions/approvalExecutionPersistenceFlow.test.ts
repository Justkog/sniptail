import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalRequest } from '@sniptail/core/permissions/permissionsApprovalTypes.js';
import { PermissionsRuntimeService } from './permissionsRuntimeService.js';

const saveJobQueuedMock = vi.hoisted(() => vi.fn());
const enqueueJobMock = vi.hoisted(() => vi.fn());
const enqueueBootstrapMock = vi.hoisted(() => vi.fn());
const enqueueWorkerEventMock = vi.hoisted(() => vi.fn());
const enqueueWorkerMailboxEventMock = vi.hoisted(() => vi.fn());
const loadAgentSessionMock = vi.hoisted(() => vi.fn());
const updateAgentSessionStatusMock = vi.hoisted(() => vi.fn());
const loadApprovalRequestMock = vi.hoisted(() => vi.fn());
const approveIfPendingMock = vi.hoisted(() => vi.fn());
const denyIfPendingMock = vi.hoisted(() => vi.fn());
const cancelIfPendingMock = vi.hoisted(() => vi.fn());
const expireIfPendingMock = vi.hoisted(() => vi.fn());
const evaluatePermissionDecisionMock = vi.hoisted(() => vi.fn());
const enqueueAgentSessionOwnerMailboxEventMock = vi.hoisted(() => vi.fn());
const isOwnerRoutedAgentEventMock = vi.hoisted(() => vi.fn());

vi.mock('@sniptail/core/jobs/registry.js', () => ({
  saveJobQueued: saveJobQueuedMock,
}));

vi.mock('@sniptail/core/queue/queue.js', () => ({
  enqueueJob: enqueueJobMock,
  enqueueBootstrap: enqueueBootstrapMock,
  enqueueWorkerEvent: enqueueWorkerEventMock,
  enqueueWorkerMailboxEvent: enqueueWorkerMailboxEventMock,
}));

vi.mock('@sniptail/core/logger.js', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@sniptail/core/agent-sessions/registry.js', () => ({
  loadAgentSession: loadAgentSessionMock,
  updateAgentSessionStatus: updateAgentSessionStatusMock,
}));

vi.mock('@sniptail/core/permissions/permissionsApprovalStore.js', () => ({
  loadApprovalRequest: loadApprovalRequestMock,
  approveIfPending: approveIfPendingMock,
  denyIfPending: denyIfPendingMock,
  cancelIfPending: cancelIfPendingMock,
  expireIfPending: expireIfPendingMock,
  createApprovalRequest: vi.fn(),
  assignThreadIdIfPending: vi.fn(),
  assignApprovalContextIfPending: vi.fn(),
}));

vi.mock('@sniptail/core/permissions/permissionsPolicyEngine.js', () => ({
  evaluatePermissionDecision: evaluatePermissionDecisionMock,
}));

vi.mock('../agentCommandShared.js', () => ({
  enqueueAgentSessionOwnerMailboxEvent: enqueueAgentSessionOwnerMailboxEventMock,
  getAgentSessionIdFromWorkerEvent: (event: { payload?: { sessionId?: string } }) =>
    event.payload?.sessionId,
  isOwnerRoutedAgentEvent: isOwnerRoutedAgentEventMock,
}));

function createService() {
  return new PermissionsRuntimeService({
    config: {
      permissions: {
        groupCacheTtlSeconds: 30,
        rules: [
          {
            id: 'approval-grant-allow',
            actions: ['approval.grant'],
            effect: 'allow',
            subjects: [{ kind: 'user', userId: 'U_APP' }],
          },
          {
            id: 'approval-deny-allow',
            actions: ['approval.deny'],
            effect: 'allow',
            subjects: [{ kind: 'user', userId: 'U_APP' }],
          },
          {
            id: 'approval-cancel-allow',
            actions: ['approval.cancel'],
            effect: 'allow',
            subjects: [{ kind: 'user', userId: 'U_REQ' }],
          },
        ],
        defaultEffect: 'deny',
        defaultApproverSubjects: [],
        defaultNotifySubjects: [],
        approvalTtlSeconds: 86_400,
      },
    } as never,
    queue: { add: vi.fn() } as never,
    bootstrapQueue: { add: vi.fn() } as never,
    workerEventQueue: { add: vi.fn() } as never,
    queueRuntime: {
      publishWorkerEventToMailbox: vi.fn(),
    } as never,
  });
}

function createPendingRequest(overrides?: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    id: 'approval-1',
    status: 'pending',
    action: 'jobs.explore',
    provider: 'discord',
    context: {
      provider: 'discord',
      channelId: 'thread-1',
      threadId: 'thread-1',
      guildId: 'G1',
    },
    requestedBy: {
      userId: 'U_REQ',
    },
    approverSubjects: [{ kind: 'user', userId: 'U_APP' }],
    notifySubjects: [],
    operation: {
      kind: 'enqueueJob',
      job: {
        jobId: 'explore-1',
        type: 'EXPLORE',
        repoKeys: ['repo-1'],
        gitRef: 'main',
        requestText: 'Explore this',
        channel: {
          provider: 'discord',
          channelId: 'thread-1',
          threadId: 'thread-1',
          guildId: 'G1',
          userId: 'U_REQ',
        },
      },
    },
    summary: 'Queue explore job explore-1',
    createdAt: '2025-01-01T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function createPendingAgentStartRequest(overrides?: Partial<ApprovalRequest>): ApprovalRequest {
  return createPendingRequest({
    action: 'agent.start',
    operation: {
      kind: 'enqueueWorkerEvent',
      targetWorkerId: 'worker-a',
      event: {
        schemaVersion: 1,
        type: 'agent.session.start',
        payload: {
          sessionId: 'session-1',
          response: {
            provider: 'slack',
            channelId: 'C1',
            threadId: 'T1',
            userId: 'U_REQ',
            workspaceId: 'W1',
          },
          prompt: 'hello',
          workspaceKey: 'snatch',
          agentProfileKey: 'build',
        },
      },
    },
    summary: 'Start agent session session-1',
    ...overrides,
  });
}

function createPendingAgentQuestionRequest(overrides?: Partial<ApprovalRequest>): ApprovalRequest {
  return createPendingRequest({
    action: 'agent.interaction.resolve',
    operation: {
      kind: 'enqueueWorkerEvent',
      targetWorkerId: 'worker-a',
      event: {
        schemaVersion: 1,
        type: 'agent.interaction.resolve',
        payload: {
          sessionId: 'session-1',
          response: {
            provider: 'slack',
            channelId: 'C1',
            threadId: 'T1',
            userId: 'U_REQ',
            workspaceId: 'W1',
          },
          interactionId: 'interaction-1',
          resolution: {
            kind: 'question',
            answers: [['yes']],
          },
        },
      },
    },
    summary: 'Resolve agent interaction session-1',
    ...overrides,
  });
}

describe('approval execution persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveJobQueuedMock.mockResolvedValue(undefined);
    enqueueJobMock.mockResolvedValue(undefined);
    enqueueBootstrapMock.mockResolvedValue(undefined);
    enqueueWorkerEventMock.mockResolvedValue(undefined);
    enqueueWorkerMailboxEventMock.mockResolvedValue(undefined);
    enqueueAgentSessionOwnerMailboxEventMock.mockResolvedValue(undefined);
    updateAgentSessionStatusMock.mockResolvedValue(undefined);
    loadAgentSessionMock.mockResolvedValue({
      sessionId: 'session-1',
      provider: 'slack',
      channelId: 'C1',
      threadId: 'T1',
      userId: 'U_REQ',
      workspaceKey: 'snatch',
      agentProfileKey: 'build',
      ownerWorkerId: 'worker-a',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    isOwnerRoutedAgentEventMock.mockImplementation(
      (event: { type?: string }) =>
        event.type === 'agent.session.message' ||
        event.type === 'agent.prompt.stop' ||
        event.type === 'agent.interaction.resolve',
    );
    expireIfPendingMock.mockResolvedValue({ changed: false, reason: 'not_pending' });
    denyIfPendingMock.mockResolvedValue({ changed: true, reason: 'updated' });
    cancelIfPendingMock.mockResolvedValue({ changed: true, reason: 'updated' });
    evaluatePermissionDecisionMock.mockReturnValue({
      effect: 'allow',
      action: 'approval.grant',
      approverSubjects: [],
      notifySubjects: [],
    });
  });

  it('approved enqueueJob persists queue record before enqueue', async () => {
    const service = createService();
    const pendingRequest = createPendingRequest();
    const approvedRequest = {
      ...pendingRequest,
      status: 'approved' as const,
      resolution: 'approved' as const,
      resolvedBy: { userId: 'U_APP' },
      resolvedAt: '2025-01-01T00:01:00.000Z',
    };

    loadApprovalRequestMock.mockResolvedValue(pendingRequest);
    approveIfPendingMock.mockResolvedValue({
      changed: true,
      reason: 'updated',
      request: approvedRequest,
    });

    const result = await service.resolveApprovalInteraction({
      action: 'approval.grant',
      resolutionAction: 'approval.grant',
      approvalId: pendingRequest.id,
      provider: 'discord',
      userId: 'U_APP',
      channelId: 'thread-1',
      threadId: 'thread-1',
      guildId: 'G1',
    });

    expect(result.status).toBe('approved');
    if (result.status !== 'approved') {
      throw new Error('Expected approved status');
    }
    expect(result.executed).toBe(true);
    expect(saveJobQueuedMock).toHaveBeenCalledTimes(1);
    expect(enqueueJobMock).toHaveBeenCalledTimes(1);
    expect(saveJobQueuedMock).toHaveBeenCalledWith(approvedRequest.operation.job);
    expect(enqueueJobMock).toHaveBeenCalledWith(expect.anything(), approvedRequest.operation.job);
    expect(
      saveJobQueuedMock.mock.invocationCallOrder[0] < enqueueJobMock.mock.invocationCallOrder[0],
    ).toBe(true);
  });

  it('approved owner-routed live agent events revalidate the session before mailbox enqueue', async () => {
    const service = createService();
    const pendingRequest = createPendingAgentQuestionRequest();
    const approvedRequest = {
      ...pendingRequest,
      status: 'approved' as const,
      resolution: 'approved' as const,
      resolvedBy: { userId: 'U_APP' },
      resolvedAt: '2025-01-01T00:01:00.000Z',
    };

    loadApprovalRequestMock.mockResolvedValue(pendingRequest);
    approveIfPendingMock.mockResolvedValue({
      changed: true,
      reason: 'updated',
      request: approvedRequest,
    });

    const result = await service.resolveApprovalInteraction({
      action: 'approval.grant',
      resolutionAction: 'approval.grant',
      approvalId: pendingRequest.id,
      provider: 'discord',
      userId: 'U_APP',
      channelId: 'thread-1',
      threadId: 'thread-1',
      guildId: 'G1',
    });

    expect(result.status).toBe('approved');
    if (result.status !== 'approved') {
      throw new Error('Expected approved status');
    }
    expect(result.executed).toBe(true);
    expect(loadAgentSessionMock).toHaveBeenCalledWith('session-1');
    const enqueueArgs = enqueueAgentSessionOwnerMailboxEventMock.mock.calls[0]?.[0] as
      | {
          session: {
            sessionId: string;
            ownerWorkerId?: string;
          };
          queueRuntime: {
            publishWorkerEventToMailbox: () => Promise<void>;
          };
          event: typeof approvedRequest.operation.event;
        }
      | undefined;
    expect(enqueueArgs).toMatchObject({
      session: {
        sessionId: 'session-1',
        ownerWorkerId: 'worker-a',
      },
    });
    expect(enqueueArgs?.event).toMatchObject({
      schemaVersion: 1,
      type: 'agent.interaction.resolve',
      payload: {
        sessionId: 'session-1',
      },
    });
    expect(typeof enqueueArgs?.queueRuntime.publishWorkerEventToMailbox).toBe('function');
    expect(enqueueWorkerMailboxEventMock).not.toHaveBeenCalled();
  });

  it('approved enqueueJob save failure reports execution failure and does not enqueue', async () => {
    const service = createService();
    const pendingRequest = createPendingRequest();
    const approvedRequest = {
      ...pendingRequest,
      status: 'approved' as const,
      resolution: 'approved' as const,
      resolvedBy: { userId: 'U_APP' },
      resolvedAt: '2025-01-01T00:01:00.000Z',
    };
    loadApprovalRequestMock.mockResolvedValue(pendingRequest);
    approveIfPendingMock.mockResolvedValue({
      changed: true,
      reason: 'updated',
      request: approvedRequest,
    });
    saveJobQueuedMock.mockRejectedValue(new Error('persist failed'));

    const result = await service.resolveApprovalInteraction({
      action: 'approval.grant',
      resolutionAction: 'approval.grant',
      approvalId: pendingRequest.id,
      provider: 'discord',
      userId: 'U_APP',
      channelId: 'thread-1',
      threadId: 'thread-1',
      guildId: 'G1',
    });

    expect(result.status).toBe('approved');
    if (result.status !== 'approved') {
      throw new Error('Expected approved status');
    }
    expect(result.executed).toBe(false);
    expect(result.message).toBe('Request approved, but execution failed. Please check logs.');
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });

  it('approved enqueueJob enqueue failure reports execution failure after persistence', async () => {
    const service = createService();
    const pendingRequest = createPendingRequest();
    const approvedRequest = {
      ...pendingRequest,
      status: 'approved' as const,
      resolution: 'approved' as const,
      resolvedBy: { userId: 'U_APP' },
      resolvedAt: '2025-01-01T00:01:00.000Z',
    };
    loadApprovalRequestMock.mockResolvedValue(pendingRequest);
    approveIfPendingMock.mockResolvedValue({
      changed: true,
      reason: 'updated',
      request: approvedRequest,
    });
    enqueueJobMock.mockRejectedValue(new Error('enqueue failed'));

    const result = await service.resolveApprovalInteraction({
      action: 'approval.grant',
      resolutionAction: 'approval.grant',
      approvalId: pendingRequest.id,
      provider: 'discord',
      userId: 'U_APP',
      channelId: 'thread-1',
      threadId: 'thread-1',
      guildId: 'G1',
    });

    expect(result.status).toBe('approved');
    if (result.status !== 'approved') {
      throw new Error('Expected approved status');
    }
    expect(result.executed).toBe(false);
    expect(result.message).toBe('Request approved, but execution failed. Please check logs.');
    expect(saveJobQueuedMock).toHaveBeenCalledTimes(1);
    expect(enqueueJobMock).toHaveBeenCalledTimes(1);
  });

  it('denied and cancelled resolutions do not persist or enqueue jobs', async () => {
    const service = createService();
    const pendingRequest = createPendingRequest();
    const deniedRequest = {
      ...pendingRequest,
      status: 'denied' as const,
      resolution: 'denied' as const,
      resolvedBy: { userId: 'U_APP' },
      resolvedAt: '2025-01-01T00:01:00.000Z',
    };
    const cancelledRequest = {
      ...pendingRequest,
      status: 'cancelled' as const,
      resolution: 'cancelled' as const,
      resolvedBy: { userId: 'U_REQ' },
      resolvedAt: '2025-01-01T00:01:00.000Z',
    };

    loadApprovalRequestMock.mockResolvedValueOnce(pendingRequest);
    denyIfPendingMock.mockResolvedValueOnce({
      changed: true,
      reason: 'updated',
      request: deniedRequest,
    });
    const deniedResult = await service.resolveApprovalInteraction({
      action: 'approval.deny',
      resolutionAction: 'approval.deny',
      approvalId: pendingRequest.id,
      provider: 'discord',
      userId: 'U_APP',
      channelId: 'thread-1',
      threadId: 'thread-1',
      guildId: 'G1',
    });
    expect(deniedResult.status).toBe('denied');

    loadApprovalRequestMock.mockResolvedValueOnce(pendingRequest);
    cancelIfPendingMock.mockResolvedValueOnce({
      changed: true,
      reason: 'updated',
      request: cancelledRequest,
    });
    const cancelledResult = await service.resolveApprovalInteraction({
      action: 'approval.cancel',
      resolutionAction: 'approval.cancel',
      approvalId: pendingRequest.id,
      provider: 'discord',
      userId: 'U_REQ',
      channelId: 'thread-1',
      threadId: 'thread-1',
      guildId: 'G1',
    });
    expect(cancelledResult.status).toBe('cancelled');

    expect(saveJobQueuedMock).not.toHaveBeenCalled();
    expect(enqueueJobMock).not.toHaveBeenCalled();
    expect(enqueueBootstrapMock).not.toHaveBeenCalled();
    expect(enqueueWorkerEventMock).not.toHaveBeenCalled();
    expect(enqueueWorkerMailboxEventMock).not.toHaveBeenCalled();
  });

  it('marks pending agent sessions failed when agent start approvals are denied, cancelled, or expired', async () => {
    const service = createService();
    const pendingRequest = createPendingAgentStartRequest();
    const deniedRequest = {
      ...pendingRequest,
      status: 'denied' as const,
      resolution: 'denied' as const,
      resolvedBy: { userId: 'U_APP' },
      resolvedAt: '2025-01-01T00:01:00.000Z',
    };
    const cancelledRequest = {
      ...pendingRequest,
      status: 'cancelled' as const,
      resolution: 'cancelled' as const,
      resolvedBy: { userId: 'U_REQ' },
      resolvedAt: '2025-01-01T00:01:00.000Z',
    };
    const expiredRequest = {
      ...pendingRequest,
      status: 'expired' as const,
      resolution: 'expired' as const,
      resolvedAt: '2025-01-01T00:01:00.000Z',
    };

    loadApprovalRequestMock.mockResolvedValueOnce(pendingRequest);
    denyIfPendingMock.mockResolvedValueOnce({
      changed: true,
      reason: 'updated',
      request: deniedRequest,
    });
    await service.resolveApprovalInteraction({
      action: 'approval.deny',
      resolutionAction: 'approval.deny',
      approvalId: pendingRequest.id,
      provider: 'discord',
      userId: 'U_APP',
      channelId: 'thread-1',
      threadId: 'thread-1',
      guildId: 'G1',
    });

    loadApprovalRequestMock.mockResolvedValueOnce(pendingRequest);
    cancelIfPendingMock.mockResolvedValueOnce({
      changed: true,
      reason: 'updated',
      request: cancelledRequest,
    });
    await service.resolveApprovalInteraction({
      action: 'approval.cancel',
      resolutionAction: 'approval.cancel',
      approvalId: pendingRequest.id,
      provider: 'discord',
      userId: 'U_REQ',
      channelId: 'thread-1',
      threadId: 'thread-1',
      guildId: 'G1',
    });

    loadApprovalRequestMock.mockResolvedValueOnce({
      ...pendingRequest,
      expiresAt: '2020-01-01T00:00:00.000Z',
    });
    expireIfPendingMock.mockResolvedValueOnce({
      changed: true,
      reason: 'updated',
      request: expiredRequest,
    });
    await service.resolveApprovalInteraction({
      action: 'approval.grant',
      resolutionAction: 'approval.grant',
      approvalId: pendingRequest.id,
      provider: 'discord',
      userId: 'U_APP',
      channelId: 'thread-1',
      threadId: 'thread-1',
      guildId: 'G1',
    });

    expect(updateAgentSessionStatusMock).toHaveBeenCalledTimes(3);
    expect(updateAgentSessionStatusMock).toHaveBeenNthCalledWith(1, 'session-1', 'failed');
    expect(updateAgentSessionStatusMock).toHaveBeenNthCalledWith(2, 'session-1', 'failed');
    expect(updateAgentSessionStatusMock).toHaveBeenNthCalledWith(3, 'session-1', 'failed');
  });

  it('marks agent sessions failed when approved agent start execution fails', async () => {
    const service = createService();
    const pendingRequest = createPendingAgentStartRequest();
    const approvedRequest = {
      ...pendingRequest,
      status: 'approved' as const,
      resolution: 'approved' as const,
      resolvedBy: { userId: 'U_APP' },
      resolvedAt: '2025-01-01T00:01:00.000Z',
    };
    loadApprovalRequestMock.mockResolvedValue(pendingRequest);
    approveIfPendingMock.mockResolvedValue({
      changed: true,
      reason: 'updated',
      request: approvedRequest,
    });
    enqueueWorkerMailboxEventMock.mockRejectedValueOnce(new Error('enqueue failed'));

    const result = await service.resolveApprovalInteraction({
      action: 'approval.grant',
      resolutionAction: 'approval.grant',
      approvalId: pendingRequest.id,
      provider: 'discord',
      userId: 'U_APP',
      channelId: 'thread-1',
      threadId: 'thread-1',
      guildId: 'G1',
    });

    expect(result.status).toBe('approved');
    if (result.status !== 'approved') {
      throw new Error('Expected approved status');
    }
    expect(result.executed).toBe(false);
    expect(updateAgentSessionStatusMock).toHaveBeenCalledWith('session-1', 'failed');
  });
});
