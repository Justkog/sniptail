import { describe, expect, it } from 'vitest';
import type { ApprovalRequest } from '@sniptail/core/permissions/permissionsApprovalTypes.js';
import { PermissionsRuntimeService } from './permissionsRuntimeService.js';

function createService() {
  return new PermissionsRuntimeService({
    config: {
      permissions: {
        groupCacheTtlSeconds: 30,
      },
    } as never,
    queue: {} as never,
    bootstrapQueue: {} as never,
    workerEventQueue: {} as never,
  });
}

function createRequest(overrides?: Partial<ApprovalRequest>): ApprovalRequest {
  return {
    id: 'approval-1',
    status: 'approved',
    action: 'jobs.ask',
    provider: 'slack',
    context: {
      provider: 'slack',
      channelId: 'C1',
    },
    requestedBy: {
      userId: 'U_REQ',
    },
    approverSubjects: [],
    notifySubjects: [],
    operation: {
      kind: 'enqueueWorkerEvent',
      event: {
        schemaVersion: 1,
        type: 'jobs.clearBefore',
        payload: {
          cutoffIso: '2025-01-01T00:00:00.000Z',
        },
      },
    },
    summary: 'Queue ask job ask-1',
    createdAt: '2025-01-01T00:00:00.000Z',
    expiresAt: '2025-01-02T00:00:00.000Z',
    resolvedBy: {
      userId: 'U_APP',
    },
    resolvedAt: '2025-01-01T01:00:00.000Z',
    resolution: 'approved',
    ...overrides,
  };
}

describe('approval resolution message formatting', () => {
  it('includes required fields with status-specific resolver labels', () => {
    const service = createService();
    const request = createRequest();

    const approved = service.buildApprovalResolutionMessage({
      provider: 'slack',
      request,
      status: 'approved',
      message: 'Request approved and executed.',
    });
    expect(approved).toContain('Job type: jobs.ask');
    expect(approved).toContain('Requester: <@U_REQ>');
    expect(approved).toContain('Summary: Queue ask job ask-1');
    expect(approved).toContain('Approved by: <@U_APP>');

    const denied = service.buildApprovalResolutionMessage({
      provider: 'slack',
      request,
      status: 'denied',
      message: 'Approval request denied.',
    });
    expect(denied).toContain('Denied by: <@U_APP>');

    const cancelled = service.buildApprovalResolutionMessage({
      provider: 'slack',
      request,
      status: 'cancelled',
      message: 'Approval request cancelled.',
    });
    expect(cancelled).toContain('Cancelled by: <@U_APP>');
  });
});
