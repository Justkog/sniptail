import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApprovalRequest } from '@sniptail/core/permissions/permissionsApprovalTypes.js';
import { PermissionsRuntimeService } from './permissionsRuntimeService.js';

const saveJobQueuedMock = vi.hoisted(() => vi.fn());
const enqueueJobMock = vi.hoisted(() => vi.fn());
const enqueueBootstrapMock = vi.hoisted(() => vi.fn());
const enqueueWorkerEventMock = vi.hoisted(() => vi.fn());
const loadApprovalRequestMock = vi.hoisted(() => vi.fn());
const approveIfPendingMock = vi.hoisted(() => vi.fn());
const denyIfPendingMock = vi.hoisted(() => vi.fn());
const cancelIfPendingMock = vi.hoisted(() => vi.fn());
const expireIfPendingMock = vi.hoisted(() => vi.fn());
const evaluatePermissionDecisionMock = vi.hoisted(() => vi.fn());

vi.mock('@sniptail/core/jobs/registry.js', () => ({
  saveJobQueued: saveJobQueuedMock,
}));

vi.mock('@sniptail/core/queue/queue.js', () => ({
  enqueueJob: enqueueJobMock,
  enqueueBootstrap: enqueueBootstrapMock,
  enqueueWorkerEvent: enqueueWorkerEventMock,
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

describe('approval execution persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveJobQueuedMock.mockResolvedValue(undefined);
    enqueueJobMock.mockResolvedValue(undefined);
    enqueueBootstrapMock.mockResolvedValue(undefined);
    enqueueWorkerEventMock.mockResolvedValue(undefined);
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
  });
});
